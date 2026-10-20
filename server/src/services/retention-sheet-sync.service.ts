import { createHash } from "crypto";
import prisma from "../lib/prisma";
import { env } from "../lib/env";
import { readSheetColumn } from "../lib/google-sheets";
import { parseSheetLead } from "../lib/sheet-lead-parser";
import { emitDataChanged } from "../realtime/chat-gateway";
import * as leadService from "./lead.service";

export interface SheetSyncResult {
  imported: number;
  alreadyImported: number;
  /** Rows that couldn't become a lead — row number + why, never the lead's data. */
  invalid: { row: number; reason: string }[];
}

const DATE_HEADER = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

export function isSheetSyncConfigured(): boolean {
  return !!(env.googleSheetId && env.googleServiceAccountEmail && env.googlePrivateKey);
}

/** Identity of a lead across re-reads: editing a typo elsewhere in the cell must not
 * re-import it, so only name + phone + DOB are hashed. */
function sheetKeyFor(fields: Record<string, string | number>): string {
  const name = String(fields.customerName ?? "").toLowerCase().replace(/[^a-z]/g, "");
  return createHash("sha256").update(`${name}|${fields.phone ?? ""}|${fields.dob ?? ""}`).digest("hex");
}

let running: Promise<SheetSyncResult> | null = null;

/** Reads the sheet and imports every lead not seen before. Concurrent calls (timer + button)
 * share one run instead of racing each other on the unique key. */
export function syncRetentionSheet(): Promise<SheetSyncResult> {
  if (!running) running = runSync().finally(() => (running = null));
  return running;
}

async function runSync(): Promise<SheetSyncResult> {
  const cells = await readSheetColumn();
  const result: SheetSyncResult = { imported: 0, alreadyImported: 0, invalid: [] };

  // Pass 1: walk the column, tracking the black date-header rows, and parse each lead cell.
  const candidates: { row: number; key: string; fields: Record<string, string | number>; date: Date | null }[] = [];
  let date: Date | null = null;
  const importFrom = env.googleSheetImportFrom ? new Date(`${env.googleSheetImportFrom}T00:00:00Z`) : null;

  cells.forEach((raw, i) => {
    const cell = raw.trim();
    if (!cell) return;

    const header = DATE_HEADER.exec(cell);
    if (header) {
      // Noon UTC keeps the calendar day stable in any timezone the admin views it from.
      date = new Date(Date.UTC(+header[3], +header[1] - 1, +header[2], 12));
      return;
    }
    // Leads above the first date header have no day, so a cutoff can't be applied — skip them.
    if (importFrom && (!date || date < importFrom)) return;

    const parsed = parseSheetLead(cell);
    if (!parsed) {
      result.invalid.push({ row: i + 1, reason: "Unreadable" });
      return;
    }
    const missing = (["customerName", "phone", "state"] as const).filter((f) => !parsed.fields[f]);
    if (missing.length) {
      result.invalid.push({ row: i + 1, reason: `Missing ${missing.join(", ")}` });
      return;
    }
    candidates.push({ row: i + 1, key: sheetKeyFor(parsed.fields), fields: parsed.fields, date });
  });

  // Pass 2: drop what's already in the database, import the rest.
  const existing = new Set(
    (await prisma.lead.findMany({ where: { sheetKey: { in: candidates.map((c) => c.key) } }, select: { sheetKey: true } }))
      .map((l) => l.sheetKey)
  );

  for (const c of candidates) {
    if (existing.has(c.key)) {
      result.alreadyImported++;
      continue;
    }
    existing.add(c.key); // the same person listed twice in one read
    const created = await leadService.submitRetentionIntake(c.fields, { sheetKey: c.key, createdAt: c.date ?? new Date() });
    if ("error" in created) result.invalid.push({ row: c.row, reason: created.error });
    else result.imported++;
  }

  if (result.imported > 0) emitDataChanged();
  return result;
}

/** Starts the recurring sync (no-op when the Google env vars aren't set). */
export function startSheetSyncTimer(): void {
  if (!isSheetSyncConfigured()) return;
  const run = () =>
    syncRetentionSheet()
      .then((r) => r.imported && console.log(`[sheet-sync] imported ${r.imported} lead(s)`))
      .catch((err) => console.error("[sheet-sync] failed", err.message));
  setInterval(run, Math.max(1, env.googleSheetSyncMinutes) * 60_000).unref();
  void run();
}
