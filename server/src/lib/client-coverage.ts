// CLIENT-only account fields — see User.states / User.carriers in schema.prisma.
// Centralized here (not hand-checked per call site) the same way lead-fields.ts centralizes
// Lead field validation.

export const US_STATES = [
  "Alabama", "Alaska", "Arizona", "Arkansas", "California", "Colorado", "Connecticut",
  "Delaware", "Florida", "Georgia", "Hawaii", "Idaho", "Illinois", "Indiana", "Iowa",
  "Kansas", "Kentucky", "Louisiana", "Maine", "Maryland", "Massachusetts", "Michigan",
  "Minnesota", "Mississippi", "Missouri", "Montana", "Nebraska", "Nevada", "New Hampshire",
  "New Jersey", "New Mexico", "New York", "North Carolina", "North Dakota", "Ohio",
  "Oklahoma", "Oregon", "Pennsylvania", "Rhode Island", "South Carolina", "South Dakota",
  "Tennessee", "Texas", "Utah", "Vermont", "Virginia", "Washington", "West Virginia",
  "Wisconsin", "Wyoming",
] as const;

const US_STATE_SET = new Set<string>(US_STATES);

export function isValidState(state: string): boolean {
  return US_STATE_SET.has(state);
}

const MAX_CARRIERS = 50;
const MAX_CARRIER_LENGTH = 80;

type ParseResult = { value: string[] } | { error: string };

/** `undefined` means the key was absent from input — caller should leave the field
 * unchanged. Otherwise either a validated, deduped list or an error. */
export function parseStates(raw: unknown): ParseResult | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) return { error: "States must be a list" };

  const states = [...new Set(raw)];
  for (const s of states) {
    if (typeof s !== "string" || !US_STATE_SET.has(s)) return { error: `Invalid state: ${String(s)}` };
  }
  return { value: states };
}

/** Carriers are freehand text (no fixed list) — trimmed, deduped case-insensitively,
 * empty entries dropped. `undefined` means the key was absent from input. */
export function parseCarriers(raw: unknown): ParseResult | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) return { error: "Carriers must be a list" };

  const carriers: string[] = [];
  const seen = new Set<string>();
  for (const c of raw) {
    if (typeof c !== "string") return { error: "Each carrier must be text" };
    const trimmed = c.trim();
    if (!trimmed) continue;
    if (trimmed.length > MAX_CARRIER_LENGTH) return { error: `Carrier name too long: ${trimmed}` };
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    carriers.push(trimmed);
  }
  if (carriers.length > MAX_CARRIERS) return { error: `Too many carriers (max ${MAX_CARRIERS})` };
  return { value: carriers };
}
