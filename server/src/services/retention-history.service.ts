import prisma from '../lib/prisma';
import type { LeadEventType, LeadStatus } from '@prisma/client';
import type { ServiceResult } from '../lib/service-result';

/**
 * Retention History — the lifecycle of every RETENTION lead (creation → closing → charge-back
 * → retention handling), for ADMIN and MANAGER. Built from LeadEvent rows plus the Lead's and
 * ChargeBack's own timestamps; leads that predate LeadEvent fall back to those alone, so
 * their timeline is simply shorter, never wrong. No PKR amount is ever read here — MANAGER
 * may call this and must not see money (see CLAUDE.md).
 */

export type RetentionHistoryState = 'PENDING' | 'ACTIVE' | 'CHARGED_BACK' | 'RETAINED';

export interface RetentionHistoryRow {
  id: string;
  customerName: string;
  status: LeadStatus;
  state: RetentionHistoryState;
  createdAt: Date;
  /** Most recent thing that happened to the lead (event, payment, charge-back) — drives the default sort. */
  lastActivityAt: Date;
  closer: string | null;
  paidAt: Date | null;
  chargedBackAt: Date | null;
  chargeBackCount: number;
  /** Every charge-back date, oldest first — feeds the per-month chart. */
  chargeBackDates: Date[];
  /** Whole months between first paid and first charge-back (or today while still active). */
  monthsOnBook: number | null;
  workedBy: string[];
  reassignedTo: string | null;
  retainedBy: string | null;
}

export type TimelineKind = LeadEventType | 'CHARGED_BACK';

export interface TimelineEntry {
  at: Date;
  kind: TimelineKind;
  actor: string | null;
  target: string | null;
  note: string | null;
  /** Draft number 1–12 for a CHARGED_BACK entry, when recorded. */
  chargeMonth?: number | null;
}

const ROW_SELECT = {
  id: true,
  customerName: true,
  status: true,
  paymentStatus: true,
  createdAt: true,
  closer: { select: { name: true } },
  retention: { select: { name: true } },
  incomePayment: { select: { createdAt: true } },
  chargeBacks: { select: { id: true, createdAt: true, reason: true, chargeMonth: true }, orderBy: { createdAt: 'asc' as const } },
  events: { orderBy: { createdAt: 'asc' as const } },
} as const;

type LeadRecord = {
  id: string;
  customerName: string;
  status: LeadStatus;
  paymentStatus: 'UNPAID' | 'PAID';
  createdAt: Date;
  closer: { name: string } | null;
  retention: { name: string } | null;
  incomePayment: { createdAt: Date } | null;
  chargeBacks: { id: string; createdAt: Date; reason: string; chargeMonth: number | null }[];
  events: {
    type: LeadEventType;
    actorId: string | null;
    targetId: string | null;
    note: string | null;
    createdAt: Date;
  }[];
};

/** Whole calendar months from `from` to `to` (never negative). */
export function wholeMonthsBetween(from: Date, to: Date): number {
  let months = (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
  if (to.getDate() < from.getDate()) months -= 1;
  return Math.max(0, months);
}

async function nameMap(records: LeadRecord[]): Promise<Map<string, string>> {
  const ids = new Set<string>();
  for (const r of records) {
    for (const e of r.events) {
      if (e.actorId) ids.add(e.actorId);
      if (e.targetId) ids.add(e.targetId);
    }
  }
  if (ids.size === 0) return new Map();
  const users = await prisma.user.findMany({ where: { id: { in: [...ids] } }, select: { id: true, name: true } });
  return new Map(users.map((u) => [u.id, u.name]));
}

function unique(values: (string | null)[]): string[] {
  return [...new Set(values.filter((v): v is string => !!v))];
}

function summarize(r: LeadRecord, names: Map<string, string>, now: Date): RetentionHistoryRow {
  const nameOf = (id: string | null) => (id ? names.get(id) ?? null : null);

  const submits = r.events.filter((e) => e.type === 'SUBMITTED');
  const paidAt = r.events.find((e) => e.type === 'PAID')?.createdAt ?? r.incomePayment?.createdAt ?? null;
  const chargedBackAt = r.chargeBacks[0]?.createdAt ?? null;
  const wasChargedBack = r.chargeBacks.length > 0;
  // A charge-back resets paymentStatus to UNPAID, so PAID again means the admin re-collected and
  // the charge-back is settled, even while the client hasn't re-decided yet (status ASSIGNED).
  const closedAgain = r.status === 'ACCEPTED' || r.status === 'ASSIGNED_EXTERNAL' || r.paymentStatus === 'PAID';

  // Once settled again, the book clock restarts from the payment that followed the charge-back.
  const repaidAt =
    wasChargedBack && r.paymentStatus === 'PAID'
      ? [...r.events].reverse().find((e) => e.type === 'PAID' && e.createdAt >= chargedBackAt!)?.createdAt ?? null
      : null;
  const bookStart = repaidAt ?? paidAt;

  const state: RetentionHistoryState = wasChargedBack
    ? closedAgain
      ? 'RETAINED'
      : 'CHARGED_BACK'
    : r.paymentStatus === 'PAID'
      ? 'ACTIVE'
      : 'PENDING';

  // Who the lead went to for rework once it was charged back.
  const handedBack = wasChargedBack
    ? r.events.filter(
        (e) =>
          (e.type === 'ASSIGNED_TO_RETENTION' || e.type === 'RETURNED_TO_RETENTION') &&
          e.createdAt >= chargedBackAt!
      )
    : [];
  const lastHandedBack = handedBack[handedBack.length - 1];

  const closerEvent = submits[0];
  const lastSubmit = submits[submits.length - 1];

  return {
    id: r.id,
    customerName: r.customerName,
    status: r.status,
    state,
    createdAt: r.createdAt,
    lastActivityAt: new Date(
      Math.max(
        r.createdAt.getTime(),
        r.incomePayment?.createdAt.getTime() ?? 0,
        ...r.chargeBacks.map((c) => c.createdAt.getTime()),
        ...r.events.map((e) => e.createdAt.getTime())
      )
    ),
    closer: nameOf(closerEvent?.actorId ?? null) ?? r.closer?.name ?? r.retention?.name ?? null,
    paidAt,
    chargedBackAt,
    chargeBackCount: r.chargeBacks.length,
    chargeBackDates: r.chargeBacks.map((c) => c.createdAt),
    monthsOnBook: bookStart ? wholeMonthsBetween(bookStart, repaidAt ? now : chargedBackAt ?? now) : null,
    workedBy: unique(submits.map((e) => nameOf(e.actorId))).concat(
      submits.length === 0 && r.retention ? [r.retention.name] : []
    ),
    reassignedTo: lastHandedBack ? nameOf(lastHandedBack.targetId) ?? lastHandedBack.note : null,
    retainedBy: state === 'RETAINED' ? nameOf(lastSubmit?.actorId ?? null) ?? r.retention?.name ?? null : null,
  };
}

function buildTimeline(r: LeadRecord, names: Map<string, string>): TimelineEntry[] {
  const nameOf = (id: string | null) => (id ? names.get(id) ?? null : null);
  const entries: TimelineEntry[] = r.events.map((e) => ({
    at: e.createdAt,
    kind: e.type,
    actor: nameOf(e.actorId),
    target: nameOf(e.targetId) ?? (e.type === 'ASSIGNED_TO_CLIENT' || e.type === 'ASSIGNED_EXTERNAL' ? e.note : null),
    // For assignments `note` is only the assignee's name, already shown as the target.
    note: ['RETURNED_TO_RETENTION', 'RETURNED_TO_CLOSER', 'RETURNED_TO_JUNIOR', 'REJECTED', 'STATUS_SET', 'EDITED'].includes(e.type) ? e.note : null,
  }));

  // Leads that predate LeadEvent: fill the two anchors we can still derive.
  if (!r.events.some((e) => e.type === 'CREATED')) {
    entries.push({ at: r.createdAt, kind: 'CREATED', actor: null, target: null, note: null });
  }
  if (!r.events.some((e) => e.type === 'PAID') && r.incomePayment) {
    entries.push({ at: r.incomePayment.createdAt, kind: 'PAID', actor: null, target: null, note: null });
  }
  for (const cb of r.chargeBacks) {
    entries.push({ at: cb.createdAt, kind: 'CHARGED_BACK', actor: null, target: null, note: cb.reason, chargeMonth: cb.chargeMonth });
  }

  return entries.sort((a, b) => a.at.getTime() - b.at.getTime());
}

export async function listRetentionHistory(): Promise<RetentionHistoryRow[]> {
  const records = (await prisma.lead.findMany({
    where: {
      leadType: 'RETENTION',
      // Only leads that have been handed to a client (or external client) at some point.
      OR: [
        { status: { in: ['ASSIGNED', 'ACCEPTED', 'ASSIGNED_EXTERNAL', 'CHARGED_BACK'] } },
        { events: { some: { type: { in: ['ASSIGNED_TO_CLIENT', 'ASSIGNED_EXTERNAL'] } } } },
        { chargeBacks: { some: {} } },
        { incomePayment: { isNot: null } },
      ],
    },
    select: ROW_SELECT,
    orderBy: { createdAt: 'desc' },
  })) as LeadRecord[];
  const names = await nameMap(records);
  const now = new Date();
  return records.map((r) => summarize(r, names, now));
}

export async function getRetentionHistory(
  leadId: string
): Promise<ServiceResult<{ lead: RetentionHistoryRow; timeline: TimelineEntry[] }>> {
  const record = (await prisma.lead.findFirst({
    where: { id: leadId, leadType: 'RETENTION' },
    select: ROW_SELECT,
  })) as LeadRecord | null;
  if (!record) return { error: 'Lead not found', status: 404 };
  const names = await nameMap([record]);
  return { data: { lead: summarize(record, names, new Date()), timeline: buildTimeline(record, names) } };
}

/** Timeline for any lead (CPA / CPL / Retention) — the admin lead popup. Same events, no leadType filter. */
export async function getLeadLifecycle(leadId: string): Promise<ServiceResult<{ timeline: TimelineEntry[] }>> {
  const record = (await prisma.lead.findUnique({ where: { id: leadId }, select: ROW_SELECT })) as LeadRecord | null;
  if (!record) return { error: 'Lead not found', status: 404 };
  const names = await nameMap([record]);
  return { data: { timeline: buildTimeline(record, names) } };
}
