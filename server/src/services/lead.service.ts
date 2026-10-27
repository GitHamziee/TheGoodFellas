import prisma from '../lib/prisma';
import { LeadStatus, Prisma } from '@prisma/client';
import { isNonEmptyString } from '../lib/validation';
import {
  ADMIN_EDIT_FIELDS,
  CLOSER_ENRICHMENT_FIELDS,
  CPL_INTAKE_FIELDS,
  DRAFT_FIELDS,
  FULL_LEAD_DRAFT_FIELDS,
  FULL_LEAD_FIELDS,
  JUNIOR_INTAKE_FIELDS,
  RETENTION_INTAKE_FIELDS,
  sanitizeLeadFields,
} from '../lib/lead-fields';

// Union of both intake allowlists — a lead RETURNED_TO_JUNIOR could be either a CPA or a
// CPL lead, and the junior needs to see/edit whichever field set they originally filled in.
const JUNIOR_EDIT_FIELDS = Array.from(new Set<string>([...JUNIOR_INTAKE_FIELDS, ...CPL_INTAKE_FIELDS]));

import { notifyRoles, notifyUsers } from './notification.service';
import { recordRetentionEvents } from './lead-event.service';
import type { ServiceResult } from '../lib/service-result';

const ADMIN_TEAM = ['ADMIN', 'MANAGER'] as ('ADMIN' | 'MANAGER')[];
const who = (name: string | null | undefined) => (name && name.trim() ? name.trim() : 'a customer');


/** Thrown inside a guarded transaction when the status-guarded update moved fewer rows than expected. */
class StaleTransitionError extends Error {}

const STALE_TRANSITION_ERROR = {
  error: 'Some of these leads were just changed by someone else. Refresh and try again.',
  status: 409,
} as const;

/** Runs fn in an interactive transaction; resolves false (rolled back) on StaleTransitionError. */
async function runGuardedTransaction(fn: (tx: Prisma.TransactionClient) => Promise<void>): Promise<boolean> {
  try {
    await prisma.$transaction(fn);
    return true;
  } catch (err) {
    if (err instanceof StaleTransitionError) return false;
    throw err;
  }
}

// ─── Select fragments ────────────────────────────────────────────
// Full detail — everyone with a legitimate reason to see everything (active work, admin, post-accept client).
const FULL_INCLUDE = {
  juniorCloser: { select: { id: true, name: true, email: true } },
  closer: { select: { id: true, name: true, email: true } },
  client: { select: { id: true, name: true, email: true } },
  externalClient: { select: { id: true, name: true, company: true, email: true, phone: true } },
  retention: { select: { id: true, name: true, email: true } },
  suggestedClient: { select: { id: true, name: true, email: true } },
  // PKR amounts are ADMIN-only — every other role gets the chargeback history without them.
  chargeBacks: {
    orderBy: { createdAt: 'desc' },
    include: { client: { select: { id: true, name: true, email: true } } },
    omit: { pkrAmount: true },
  },
} as const;

// FULL_INCLUDE plus each chargeback's PKR amount — ADMIN reads only.
const ADMIN_FULL_INCLUDE = {
  ...FULL_INCLUDE,
  chargeBacks: {
    orderBy: { createdAt: 'desc' },
    include: { client: { select: { id: true, name: true, email: true } } },
  },
} as const;

/**
 * `suggestedClientId` is a non-binding hint (see schema.prisma) settable by whoever builds
 * or enriches a lead — not part of the generic FIELD_SCHEMA allowlist because, like
 * closerId in submitLead, it needs a real FK existence+role check, not just a type check.
 * Returns a spreadable fragment: `{}` when absent (no-op on create/update), `{
 * suggestedClientId }` when a valid CLIENT id was given, or `{ error }` otherwise.
 */
async function resolveSuggestedClientId(raw: unknown): Promise<{ suggestedClientId?: string } | { error: string }> {
  if (raw === undefined || raw === null || raw === '') return {};
  if (typeof raw !== 'string') return { error: 'Invalid suggestedClientId' };
  const client = await prisma.user.findUnique({ where: { id: raw } });
  if (!client || client.role !== 'CLIENT') return { error: 'Selected client is invalid' };
  return { suggestedClientId: raw };
}

// Junior Closer view — ANY lead, ANY time: only Customer Name + status + date, per explicit
// requirement (risk of the junior closer stealing customer information, phone included — a junior
// or closer history view must never carry the phone number). Includes the assigned closer's name
// since that's workflow metadata, not customer PII.
const JUNIOR_VIEW_SELECT = {
  id: true,
  adminStatus: true,
  customerName: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  leadType: true,
  closer: { select: { id: true, name: true } },
  // Only the verdict — never the reviewer or comment — so the junior can see their own QA pass rate.
  qaReviews: { where: { role: 'QA_JUNIOR_CLOSER' }, select: { outcome: true } },
} as const;

// Closer's OWN history (leads no longer actively theirs to work, i.e. status != NEW) — same masking
// as the Junior Closer view, phone excluded for the same anti-data-theft reason. While a lead is
// NEW and assigned to them, they get full detail (below).
const CLOSER_HISTORY_SELECT = {
  id: true,
  adminStatus: true,
  customerName: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  client: { select: { id: true, name: true } },
} as const;

// Closer's inbox LIST — a closer can browse this without ever committing to work a lead, so it's
// masked the same anti-data-theft way as the history views (no phone, no PII/financial fields).
// Full detail (phone included) only opens up via getLeadById once they click through to actually
// enrich the lead — that's the "theirs to work" moment, not just seeing it listed.
const CLOSER_INBOX_PREVIEW_SELECT = {
  id: true,
  adminStatus: true,
  customerName: true,
  state: true,
  need: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  leadType: true,
  juniorCloser: { select: { id: true, name: true } },
} as const;

// Junior Closer editing a lead the admin sent back. Deliberately wider than
// JUNIOR_VIEW_SELECT: they cannot fix fields they cannot see. Scoped to exactly the
// intake fields they typed in the first place, so it discloses nothing new — and
// pointedly excludes every closer-added field (SSN, bank, routing, beneficiary…),
// which is what the anti-data-theft masking rule actually exists to protect.
const JUNIOR_EDIT_SELECT = {
  id: true,
  adminStatus: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  returnReason: true,
  leadType: true,
  closer: { select: { id: true, name: true } },
  ...Object.fromEntries(JUNIOR_EDIT_FIELDS.map((f) => [f, true])),
} as const;

// Team Lead's view of the admin's SUBMITTED queue — same anti-data-theft masking as the
// Junior/Closer views (no phone, no SSN/bank/beneficiary), plus both parties who worked the
// lead since Team Lead oversees Junior Closer *and* Closer performance.
const TEAM_LEAD_SELECT = {
  id: true,
  adminStatus: true,
  customerName: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  leadType: true,
  dCode: true,
  juniorCloser: { select: { id: true, name: true } },
  closer: { select: { id: true, name: true } },
} as const;

// Manager oversees Closer + Retention leads only; Junior-Closer-originated leads belong to
// Team Lead. The split is by origin: a lead a Junior Closer started always has juniorCloserId
// set, while a Closer's self-/AI-sourced lead and every Retention lead never does.
type AdminViewer = 'ADMIN' | 'MANAGER';
const managerScope = (viewer?: AdminViewer) => (viewer === 'MANAGER' ? { juniorCloserId: null } : {});
const adminInclude = (viewer?: AdminViewer) => (viewer === 'ADMIN' ? ADMIN_FULL_INCLUDE : FULL_INCLUDE);

/** True when every given lead is one a MANAGER may act on (non-existent ids pass; the action 404s). */
export async function leadsInManagerScope(leadIds: string[]): Promise<boolean> {
  const outOfScope = await prisma.lead.count({ where: { id: { in: leadIds }, juniorCloserId: { not: null } } });
  return outOfScope === 0;
}

// Retention team's shared history list — same anti-data-theft shape as CLOSER_HISTORY_SELECT:
// name, outcome, dates and who worked it. No phone/state/carrier once a lead has left the
// queue, and details of a submitted lead are for Clients only.
const RETENTION_HISTORY_SELECT = {
  id: true,
  adminStatus: true,
  customerName: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  retention: { select: { id: true, name: true } },
  client: { select: { id: true, name: true } },
  // Dates only — no PKR amount, no reason. Drives the History page's Charge-backs toggle.
  chargeBacks: { select: { createdAt: true }, orderBy: { createdAt: 'desc' } },
} as const;

// Retention's queue LIST — masked like CLOSER_INBOX_PREVIEW_SELECT (no phone, no carrier, no
// PII/financial fields). Full detail only opens via getLeadById once a lead is actually
// opened to work. The draft/return reasons are workflow notes, not customer data — the list
// shows them so a sent-back lead says what to fix and a draft says why it was parked.
const RETENTION_QUEUE_PREVIEW_SELECT = {
  id: true,
  adminStatus: true,
  customerName: true,
  state: true,
  status: true,
  leadType: true,
  createdAt: true,
  updatedAt: true,
  draftReason: true,
  draftReasonNote: true,
  returnReason: true,
  callbackById: true,
  callbackAt: true,
  retention: { select: { id: true, name: true } },
} as const;

// ─── Junior Closer ──────────────────────────────────────────────
export async function submitLead(
  juniorCloserId: string,
  input: { closerId?: unknown } & Record<string, unknown>
): Promise<ServiceResult<{ lead: unknown }>> {
  if (!isNonEmptyString(input.closerId)) return { error: 'closerId is required', status: 400 };

  const sanitized = sanitizeLeadFields(input, JUNIOR_INTAKE_FIELDS);
  if ('error' in sanitized) return { error: sanitized.error, status: 400 };
  const { data } = sanitized;

  if (!isNonEmptyString(data.customerName)) return { error: "Customer's name is required", status: 400 };
  if (!isNonEmptyString(data.phone)) return { error: 'Phone number is required', status: 400 };
  if (!isNonEmptyString(data.state)) return { error: 'State is required', status: 400 };

  const closer = await prisma.user.findUnique({ where: { id: input.closerId } });
  if (!closer || closer.role !== 'CLOSER') return { error: 'Selected closer is invalid', status: 400 };

  const lead = await prisma.lead.create({
    data: { juniorCloserId, closerId: input.closerId, ...data } as Prisma.LeadUncheckedCreateInput,
    include: FULL_INCLUDE,
  });

  void notifyUsers([input.closerId], {
    kind: 'info',
    title: 'New lead assigned to you',
    message: `${who(lead.customerName)} was sent to you by ${lead.juniorCloser?.name ?? 'a junior closer'}.`,
    page: 'INBOX',
  });

  return { data: { lead } };
}

/**
 * CPL submission — skips the Closer step entirely: no closerId, a deliberately shorter
 * field set (see CPL_INTAKE_FIELDS), and the lead lands straight at SUBMITTED rather than
 * NEW. No race-prevention needed here — it's a create, nothing can race a not-yet-existing row.
 */
export async function submitCplLead(
  juniorCloserId: string,
  input: Record<string, unknown>
): Promise<ServiceResult<{ lead: unknown }>> {
  const sanitized = sanitizeLeadFields(input, CPL_INTAKE_FIELDS);
  if ('error' in sanitized) return { error: sanitized.error, status: 400 };
  const { data } = sanitized;

  if (!isNonEmptyString(data.customerName)) return { error: "Customer's name is required", status: 400 };
  if (!isNonEmptyString(data.phone)) return { error: 'Phone number is required', status: 400 };
  if (!isNonEmptyString(data.state)) return { error: 'State is required', status: 400 };

  const lead = await prisma.lead.create({
    data: { juniorCloserId, leadType: 'CPL', status: 'SUBMITTED', ...data } as Prisma.LeadUncheckedCreateInput,
    include: FULL_INCLUDE,
  });

  void notifyRoles(ADMIN_TEAM, {
    kind: 'info',
    title: 'New CPL lead submitted',
    message: `${who(lead.customerName)} is waiting in the CPL queue.`,
    page: 'ADMIN_CPL',
  });

  return { data: { lead } };
}

/** Junior Closer's history — masked to Customer Name + Phone only, regardless of lead status. */
export async function listLeadsForJuniorCloser(juniorCloserId: string) {
  return prisma.lead.findMany({
    where: { juniorCloserId },
    select: JUNIOR_VIEW_SELECT,
    orderBy: { updatedAt: 'desc' },
  });
}

/** Leads the admin sent back to this junior closer to correct. */
export async function listReturnedForJuniorCloser(juniorCloserId: string) {
  return prisma.lead.findMany({
    where: { juniorCloserId, status: 'RETURNED_TO_JUNIOR' },
    select: JUNIOR_EDIT_SELECT,
    orderBy: { updatedAt: 'desc' },
  });
}

/** Junior closer corrects their intake and sends it back to the admin. */
export async function resubmitByJuniorCloser(
  leadId: string,
  juniorCloserId: string,
  input: Record<string, unknown>
): Promise<ServiceResult<{ lead: unknown }>> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) return { error: 'Lead not found', status: 404 };
  if (lead.juniorCloserId !== juniorCloserId) return { error: 'Lead is not yours', status: 403 };
  if (lead.status !== 'RETURNED_TO_JUNIOR') return { error: 'Lead was not sent back to you', status: 400 };

  const sanitized = sanitizeLeadFields(input, lead.leadType === 'CPL' ? CPL_INTAKE_FIELDS : JUNIOR_INTAKE_FIELDS);
  if ('error' in sanitized) return { error: sanitized.error, status: 400 };
  const { data } = sanitized;

  if (!isNonEmptyString(data.customerName)) return { error: "Customer's name is required", status: 400 };
  if (!isNonEmptyString(data.phone)) return { error: 'Phone number is required', status: 400 };
  if (!isNonEmptyString(data.state)) return { error: 'State is required', status: 400 };

  const updated = await prisma.lead.updateMany({
    where: { id: leadId, status: 'RETURNED_TO_JUNIOR', juniorCloserId },
    data: { ...data, status: 'SUBMITTED', returnReason: null },
  });
  if (updated.count === 0) return { error: 'Lead was already updated', status: 409 };

  void notifyRoles(ADMIN_TEAM, {
    kind: 'success',
    title: 'Lead corrected and resubmitted',
    message: `${who(data.customerName as string)} was fixed by the junior closer and is back in your queue.`,
    page: 'ADMIN_LEADS',
  });

  // Deliberately the masked view — correcting a lead doesn't earn ongoing visibility.
  const result = await prisma.lead.findUnique({ where: { id: leadId }, select: JUNIOR_VIEW_SELECT });
  return { data: { lead: result } };
}

// ─── Closer ─────────────────────────────────────────────────────
/**
 * Leads assigned to this closer to work (status NEW) — masked preview only (name/state/need),
 * so browsing the inbox can't be used to harvest customer PII. Full detail loads via
 * getLeadById once the closer actually opens a lead to enrich it.
 */
export async function listInboxForCloser(closerId: string) {
  return prisma.lead.findMany({
    where: { closerId, status: 'NEW' },
    select: CLOSER_INBOX_PREVIEW_SELECT,
    orderBy: { updatedAt: 'desc' },
  });
}

/**
 * Closer's history — leads they've already submitted onward. Same masking as Junior Closer's view.
 * Excludes RETURNED_TO_CLOSER and DRAFT: those are active work again, and live on their own pages.
 */
export async function listHistoryForCloser(closerId: string) {
  return prisma.lead.findMany({
    where: { closerId, status: { notIn: ['NEW', 'RETURNED_TO_CLOSER', 'DRAFT'] } },
    select: CLOSER_HISTORY_SELECT,
    orderBy: { updatedAt: 'desc' },
  });
}

/** Leads this closer has parked as a draft instead of submitting — full detail, same tier as the inbox. */
export async function listDraftsForCloser(closerId: string) {
  return prisma.lead.findMany({
    where: { closerId, status: 'DRAFT' },
    include: FULL_INCLUDE,
    orderBy: { updatedAt: 'desc' },
  });
}

/** Every closer's parked drafts, not just one — Admin's oversight view. Full detail, same as listAllLeadsForAdmin. */
export async function listDraftsForAdmin(viewer?: AdminViewer) {
  return prisma.lead.findMany({
    where: { status: 'DRAFT', ...managerScope(viewer) },
    include: adminInclude(viewer),
    orderBy: { updatedAt: 'desc' },
  });
}

/**
 * Closer parks a half-baked enrichment instead of submitting — requires a reason. Resumable
 * via getLeadById/enrichAndSubmitLead. A self-sourced lead (no Junior Closer — see
 * createLeadByCloser) has no upstream intake to fall back on, so it accepts the full
 * junior+closer field set instead of just the closer-only fields a junior-originated lead
 * would use here.
 */
export async function saveLeadAsDraft(
  leadId: string,
  closerId: string,
  input: Record<string, unknown>
): Promise<ServiceResult<{ lead: unknown }>> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) return { error: 'Lead not found', status: 404 };
  if (lead.closerId !== closerId) return { error: 'Lead is not assigned to you', status: 403 };
  if (lead.status !== 'NEW' && lead.status !== 'DRAFT') {
    return { error: 'Only a lead you are actively working can be saved as a draft', status: 400 };
  }

  const sanitized = sanitizeLeadFields(input, lead.juniorCloserId ? DRAFT_FIELDS : FULL_LEAD_DRAFT_FIELDS);
  if ('error' in sanitized) return { error: sanitized.error, status: 400 };
  const { data } = sanitized;

  const reasonError = normalizeDraftReason(data);
  if (reasonError) return { error: reasonError, status: 400 };

  const suggested = await resolveSuggestedClientId((input as Record<string, unknown>).suggestedClientId);
  if ('error' in suggested) return { error: suggested.error, status: 400 };

  const updated = await prisma.lead.updateMany({
    where: { id: leadId, status: lead.status, closerId },
    data: { ...data, ...suggested, status: 'DRAFT' },
  });
  if (updated.count === 0) return { error: 'Lead was already updated', status: 409 };

  const result = await prisma.lead.findUnique({ where: { id: leadId }, include: FULL_INCLUDE });
  return { data: { lead: result } };
}

/**
 * A self-sourced lead (juniorCloserId null — see createLeadByCloser) has no upstream
 * intake, so its enrichment/resume form covers the full field set, same reasoning as
 * saveLeadAsDraft above.
 */
export async function enrichAndSubmitLead(
  leadId: string,
  closerId: string,
  input: Record<string, unknown>
): Promise<ServiceResult<{ lead: unknown }>> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) return { error: 'Lead not found', status: 404 };
  if (lead.closerId !== closerId) return { error: 'Lead is not assigned to you', status: 403 };
  if (lead.status !== 'NEW' && lead.status !== 'DRAFT') {
    return { error: 'Lead has already been submitted', status: 400 };
  }

  const sanitized = sanitizeLeadFields(input, lead.juniorCloserId ? CLOSER_ENRICHMENT_FIELDS : FULL_LEAD_FIELDS);
  if ('error' in sanitized) return { error: sanitized.error, status: 400 };

  const suggested = await resolveSuggestedClientId((input as Record<string, unknown>).suggestedClientId);
  if ('error' in suggested) return { error: suggested.error, status: 400 };

  const updated = await prisma.lead.updateMany({
    where: { id: leadId, status: lead.status, closerId },
    data: { ...sanitized.data, ...suggested, status: 'SUBMITTED', draftReason: null, draftReasonNote: null },
  });
  if (updated.count === 0) return { error: 'Lead was already updated', status: 409 };

  void notifyRoles(ADMIN_TEAM, {
    kind: 'info',
    title: 'Lead submitted by a closer',
    message: `${who(lead.customerName)} is ready for you to assign.`,
    page: 'ADMIN_LEADS',
  });

  const result = await prisma.lead.findUnique({ where: { id: leadId }, include: FULL_INCLUDE });
  return { data: { lead: result } };
}

/** Leads the admin sent back to this closer to correct — full detail, as when they worked it. */
export async function listReturnedForCloser(closerId: string) {
  return prisma.lead.findMany({
    where: { closerId, status: 'RETURNED_TO_CLOSER' },
    include: FULL_INCLUDE,
    orderBy: { updatedAt: 'desc' },
  });
}

/** Closer corrects their enrichment and sends it back to the admin. Same juniorCloserId
 * branch as enrichAndSubmitLead above — a self-sourced lead can be sent back too (admin
 * only checks closerId, see returnLeadForEdit), so it needs the full field set here as well. */
export async function resubmitByCloser(
  leadId: string,
  closerId: string,
  input: Record<string, unknown>
): Promise<ServiceResult<{ lead: unknown }>> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) return { error: 'Lead not found', status: 404 };
  if (lead.closerId !== closerId) return { error: 'Lead is not assigned to you', status: 403 };
  if (lead.status !== 'RETURNED_TO_CLOSER') return { error: 'Lead was not sent back to you', status: 400 };

  const sanitized = sanitizeLeadFields(input, lead.juniorCloserId ? CLOSER_ENRICHMENT_FIELDS : FULL_LEAD_FIELDS);
  if ('error' in sanitized) return { error: sanitized.error, status: 400 };

  const suggested = await resolveSuggestedClientId((input as Record<string, unknown>).suggestedClientId);
  if ('error' in suggested) return { error: suggested.error, status: 400 };

  const updated = await prisma.lead.updateMany({
    where: { id: leadId, status: 'RETURNED_TO_CLOSER', closerId },
    data: { ...sanitized.data, ...suggested, status: 'SUBMITTED', returnReason: null },
  });
  if (updated.count === 0) return { error: 'Lead was already updated', status: 409 };

  void notifyRoles(ADMIN_TEAM, {
    kind: 'success',
    title: 'Lead corrected and resubmitted',
    message: `${who(lead.customerName)} was re-written by the closer and is back in your queue.`,
    page: 'ADMIN_LEADS',
  });

  const result = await prisma.lead.findUnique({ where: { id: leadId }, include: FULL_INCLUDE });
  return { data: { lead: result } };
}

/**
 * Closer builds a lead from scratch — self- or AI-sourced calls with no Junior Closer
 * involved. Combines the junior intake + closer enrichment fields in one submission, so
 * (unlike the normal NEW → enrich flow) it lands straight at SUBMITTED, same as a CPL
 * lead skipping the Closer step. juniorCloserId is left unset (null).
 */
export async function createLeadByCloser(
  closerId: string,
  input: Record<string, unknown>
): Promise<ServiceResult<{ lead: unknown }>> {
  const sanitized = sanitizeLeadFields(input, FULL_LEAD_FIELDS);
  if ('error' in sanitized) return { error: sanitized.error, status: 400 };
  const { data } = sanitized;

  if (!isNonEmptyString(data.customerName)) return { error: "Customer's name is required", status: 400 };
  if (!isNonEmptyString(data.phone)) return { error: 'Phone number is required', status: 400 };
  if (!isNonEmptyString(data.state)) return { error: 'State is required', status: 400 };

  const suggested = await resolveSuggestedClientId(input.suggestedClientId);
  if ('error' in suggested) return { error: suggested.error, status: 400 };

  const lead = await prisma.lead.create({
    data: { closerId, status: 'SUBMITTED', ...data, ...suggested } as Prisma.LeadUncheckedCreateInput,
    include: FULL_INCLUDE,
  });

  void notifyRoles(ADMIN_TEAM, {
    kind: 'info',
    title: 'Lead submitted by a closer',
    message: `${who(lead.customerName)} is ready for you to assign.`,
    page: 'ADMIN_LEADS',
  });

  return { data: { lead } };
}

/**
 * Same as createLeadByCloser, but parked as a draft instead of submitted — for a call the
 * closer hasn't finished capturing yet. Reuses the same listDraftsForCloser/listDraftsForAdmin
 * queries and resumes through the normal enrich-lead page (getLeadById/saveLeadAsDraft/
 * enrichAndSubmitLead above already branch on juniorCloserId to accept the full field set).
 */
export async function createDraftByCloser(
  closerId: string,
  input: Record<string, unknown>
): Promise<ServiceResult<{ lead: unknown }>> {
  const sanitized = sanitizeLeadFields(input, FULL_LEAD_DRAFT_FIELDS);
  if ('error' in sanitized) return { error: sanitized.error, status: 400 };
  const { data } = sanitized;

  if (!isNonEmptyString(data.customerName)) return { error: "Customer's name is required", status: 400 };
  if (!isNonEmptyString(data.phone)) return { error: 'Phone number is required', status: 400 };
  if (!isNonEmptyString(data.state)) return { error: 'State is required', status: 400 };
  const reasonError = normalizeDraftReason(data);
  if (reasonError) return { error: reasonError, status: 400 };

  const suggested = await resolveSuggestedClientId(input.suggestedClientId);
  if ('error' in suggested) return { error: suggested.error, status: 400 };

  const lead = await prisma.lead.create({
    data: { closerId, status: 'DRAFT', ...data, ...suggested } as Prisma.LeadUncheckedCreateInput,
    include: FULL_INCLUDE,
  });

  return { data: { lead } };
}

/** A draft needs a reason. "OTHER" means the closer typed it manually, so the note is
 * required then; for any preset reason a stray note is dropped. Mutates `data`. */
function normalizeDraftReason(data: Record<string, unknown>): string | null {
  if (!isNonEmptyString(data.draftReason as string | undefined)) {
    return 'Pick a reason for saving this as a draft';
  }
  if (data.draftReason === 'OTHER') {
    const note = typeof data.draftReasonNote === 'string' ? data.draftReasonNote.trim() : '';
    if (!note) return 'Type a reason for saving this as a draft';
    data.draftReasonNote = note.slice(0, 200);
  } else {
    data.draftReasonNote = null;
  }
  return null;
}

// ─── Admin ──────────────────────────────────────────────────────
const ASSIGNABLE_STATUSES = ['SUBMITTED', 'REJECTED', 'CHARGED_BACK'] as const;

export async function assignLeadToClient(leadId: string, clientId: string, actorId?: string): Promise<ServiceResult<{ lead: unknown }>> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) return { error: 'Lead not found', status: 404 };
  if (!ASSIGNABLE_STATUSES.includes(lead.status as (typeof ASSIGNABLE_STATUSES)[number])) {
    return { error: 'Lead is not available for assignment', status: 400 };
  }

  const client = await prisma.user.findUnique({ where: { id: clientId } });
  if (!client || client.role !== 'CLIENT') return { error: 'Selected client is invalid', status: 400 };

  const updated = await prisma.lead.updateMany({
    where: { id: leadId, status: lead.status },
    data: { clientId, status: 'ASSIGNED', rejectionReason: null },
  });
  if (updated.count === 0) return { error: 'Lead was already updated', status: 409 };

  void recordRetentionEvents([leadId], 'ASSIGNED_TO_CLIENT', { actorId, targetId: clientId, note: client.name });
  void notifyUsers([clientId], {
    kind: 'success',
    title: 'New lead for you',
    message: `${who(lead.customerName)} has been assigned to you — review and accept or reject.`,
    page: lead.leadType === 'CPL' ? 'CLIENT_CPL' : 'CLIENT_CPA',
  });

  const result = await prisma.lead.findUnique({ where: { id: leadId }, include: FULL_INCLUDE });
  return { data: { lead: result } };
}

/** Admin hands a lead to a non-login ExternalClient — no accept/reject step, terminal. */
export async function assignLeadToExternalClient(
  leadId: string,
  externalClientId: string,
  actorId?: string
): Promise<ServiceResult<{ lead: unknown }>> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) return { error: 'Lead not found', status: 404 };
  if (!ASSIGNABLE_STATUSES.includes(lead.status as (typeof ASSIGNABLE_STATUSES)[number])) {
    return { error: 'Lead is not available for assignment', status: 400 };
  }

  const externalClient = await prisma.externalClient.findUnique({ where: { id: externalClientId } });
  if (!externalClient) return { error: 'Selected external client is invalid', status: 400 };

  const updated = await prisma.lead.updateMany({
    where: { id: leadId, status: lead.status },
    data: { externalClientId, clientId: null, status: 'ASSIGNED_EXTERNAL', rejectionReason: null },
  });
  if (updated.count === 0) return { error: 'Lead was already updated', status: 409 };
  void recordRetentionEvents([leadId], 'ASSIGNED_EXTERNAL', { actorId, note: externalClient.name });

  const result = await prisma.lead.findUnique({ where: { id: leadId }, include: FULL_INCLUDE });
  return { data: { lead: result } };
}

/**
 * Public retention intake form submission (no login — see routes/leads.routes.ts's
 * '/retention/intake' route, registered ahead of `authenticate`). Someone working an
 * AI-sourced call types the lead's details in directly, so this is the sole entry point
 * for RETENTION leads. Creates the lead fully unassigned (retentionId: null, status: NEW)
 * for admin to hand out via assignLeadToRetention below — mirrors what the old sheet
 * import used to produce.
 */
export async function submitRetentionIntake(
  input: Record<string, unknown>,
  // Set only by the Google Sheet sync: its dedupe key, and the sheet's date block as createdAt.
  sheet?: { sheetKey: string; createdAt: Date }
): Promise<ServiceResult<{ lead: unknown }>> {
  const sanitized = sanitizeLeadFields(input, RETENTION_INTAKE_FIELDS, { retention: true });
  if ('error' in sanitized) return { error: sanitized.error, status: 400 };
  const { data } = sanitized;

  if (!isNonEmptyString(data.customerName as string | undefined)) return { error: "Customer's name is required", status: 400 };
  if (!isNonEmptyString(data.phone as string | undefined)) return { error: 'Phone number is required', status: 400 };
  if (!isNonEmptyString(data.state as string | undefined)) return { error: 'State is required', status: 400 };

  const lead = await prisma.lead.create({
    data: { leadType: 'RETENTION', status: 'NEW', ...data, ...sheet } as Prisma.LeadUncheckedCreateInput,
    include: FULL_INCLUDE,
  });
  void recordRetentionEvents([lead.id], 'CREATED');
  return { data: { lead } };
}

/** Sheet-imported leads Admin hasn't handed to a Retention person yet. */
export async function listUnassignedRetentionForAdmin() {
  return prisma.lead.findMany({
    where: { leadType: 'RETENTION', retentionId: null },
    include: FULL_INCLUDE,
    orderBy: { updatedAt: 'desc' },
  });
}

/** Every RETENTION lead, any status — the dedicated Admin "Retention Leads" page, same
 * pattern as listCplLeadsForAdmin. Unlike listUnassignedRetentionForAdmin above (the
 * intake triage inbox), this is the full reporting/history view across the whole pipeline. */
export async function listRetentionAllForAdmin() {
  return prisma.lead.findMany({
    where: { leadType: 'RETENTION' },
    include: FULL_INCLUDE,
    orderBy: { updatedAt: 'desc' },
  });
}

/**
 * Admin hands (or re-hands, to correct a misassignment) an unworked RETENTION lead to a
 * Retention person. Doesn't change status — mirrors how a Junior Closer picks a Closer at
 * CPA intake, claimed via a foreign key while the lead stays NEW until actually worked.
 */
export async function assignLeadToRetention(leadId: string, retentionId: string, actorId?: string): Promise<ServiceResult<{ lead: unknown }>> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) return { error: 'Lead not found', status: 404 };
  if (lead.leadType !== 'RETENTION') return { error: 'Not a retention lead', status: 400 };
  if (lead.status !== 'NEW') return { error: 'Lead is no longer available for assignment', status: 400 };

  const person = await prisma.user.findUnique({ where: { id: retentionId } });
  if (!person || person.role !== 'RETENTION') return { error: 'Selected retention person is invalid', status: 400 };

  const updated = await prisma.lead.updateMany({
    where: { id: leadId, status: 'NEW' },
    data: { retentionId, retentionAssignedAt: new Date() },
  });
  if (updated.count === 0) return { error: 'Lead was already updated', status: 409 };

  void recordRetentionEvents([leadId], 'ASSIGNED_TO_RETENTION', { actorId, targetId: retentionId, note: person.name });
  void notifyUsers([retentionId], {
    kind: 'info',
    title: 'New retention lead',
    message: `${who(lead.customerName)} was assigned to the retention team.`,
    page: 'INBOX',
  });

  const result = await prisma.lead.findUnique({ where: { id: leadId }, include: FULL_INCLUDE });
  return { data: { lead: result } };
}

/**
 * Batch form of assignLeadToRetention — admin ticks many unworked RETENTION leads and hands
 * them all to one Retention person. Same eligibility (RETENTION + NEW); ineligible ids are
 * silently skipped, like batchDecideAsAdmin. One summary notification, not one per lead.
 */
export async function batchAssignToRetention(
  leadIds: unknown,
  retentionId: unknown,
  actorId?: string
): Promise<ServiceResult<{ count: number }>> {
  if (!Array.isArray(leadIds) || leadIds.length === 0 || !leadIds.every((id) => typeof id === 'string')) {
    return { error: 'Select at least one lead', status: 400 };
  }
  if (!isNonEmptyString(retentionId)) return { error: 'retentionId is required', status: 400 };

  const person = await prisma.user.findUnique({ where: { id: retentionId } });
  if (!person || person.role !== 'RETENTION') return { error: 'Selected retention person is invalid', status: 400 };

  const updated = await prisma.lead.updateMany({
    where: { id: { in: leadIds }, leadType: 'RETENTION', status: 'NEW' },
    data: { retentionId, retentionAssignedAt: new Date() },
  });
  if (updated.count === 0) return { error: 'None of the selected leads are available for assignment', status: 400 };
  void recordRetentionEvents(leadIds, 'ASSIGNED_TO_RETENTION', { actorId, targetId: retentionId, note: person.name });

  void notifyUsers([retentionId], {
    kind: 'info',
    title: updated.count === 1 ? 'New retention lead' : 'New retention leads',
    message: `${updated.count} ${updated.count === 1 ? 'lead was' : 'leads were'} assigned to you.`,
    page: 'INBOX',
  });

  return { data: { count: updated.count } };
}

const EDITABLE_STATUSES = ['REJECTED', 'CHARGED_BACK'] as const;

/** Admin edits lead fields — only permitted while a lead sits REJECTED or CHARGED_BACK, prior to reassignment. */
export async function editLead(leadId: string, input: Record<string, unknown>): Promise<ServiceResult<{ lead: unknown }>> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) return { error: 'Lead not found', status: 404 };
  if (!EDITABLE_STATUSES.includes(lead.status as (typeof EDITABLE_STATUSES)[number])) {
    return { error: 'Only declined or charged-back leads can be edited', status: 400 };
  }

  // A CPL lead never acquires Closer-only fields — not even Admin fills those in.
  const sanitized = sanitizeLeadFields(input, lead.leadType === 'CPL' ? CPL_INTAKE_FIELDS : ADMIN_EDIT_FIELDS, { retention: lead.leadType === 'RETENTION' });
  if ('error' in sanitized) return { error: sanitized.error, status: 400 };

  // An empty edit is a no-op save, not a conflict — skip the write rather than read its count.
  if (Object.keys(sanitized.data).length > 0) {
    const updated = await prisma.lead.updateMany({
      where: { id: leadId, status: lead.status },
      data: sanitized.data,
    });
    if (updated.count === 0) return { error: 'Lead was already updated', status: 409 };
  }

  const result = await prisma.lead.findUnique({ where: { id: leadId }, include: FULL_INCLUDE });
  return { data: { lead: result } };
}

/**
 * Admin sends a lead back for correction, to whichever role entered the bad data.
 * Only from the admin's own queue (SUBMITTED / REJECTED) or a CHARGED_BACK lead awaiting
 * reassignment — a lead that is out with a client, already accepted, or still being worked
 * isn't the admin's to recall.
 *
 * A RETENTION lead never has a junior closer or closer on it (see schema.prisma), so it can
 * only ever be sent back to RETENTION — never JUNIOR_CLOSER/CLOSER — and conversely a
 * non-RETENTION lead can never be sent back to RETENTION.
 */
export async function returnLeadForEdit(
  leadId: string,
  target: 'JUNIOR_CLOSER' | 'CLOSER' | 'RETENTION',
  reason: string,
  actorId?: string
): Promise<ServiceResult<{ lead: unknown }>> {
  if (!isNonEmptyString(reason)) return { error: 'A reason is required so they know what to fix', status: 400 };

  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) return { error: 'Lead not found', status: 404 };
  if (lead.status !== 'SUBMITTED' && lead.status !== 'REJECTED' && lead.status !== 'CHARGED_BACK') {
    return { error: 'Only leads waiting in the admin queue or charged back can be sent back', status: 400 };
  }

  if (target === 'RETENTION') {
    if (lead.leadType !== 'RETENTION' || !lead.retentionId) {
      return { error: 'This lead has no retention person to send back to', status: 400 };
    }
  } else {
    if (lead.leadType === 'RETENTION') {
      return { error: 'A retention lead can only be sent back to Retention', status: 400 };
    }
    if (target === 'CLOSER' && !lead.closerId) {
      return { error: 'This lead has no closer to send back to', status: 400 };
    }
    if (target === 'JUNIOR_CLOSER' && !lead.juniorCloserId) {
      return { error: 'This lead has no junior closer to send back to', status: 400 };
    }
  }

  const status =
    target === 'JUNIOR_CLOSER' ? 'RETURNED_TO_JUNIOR' : target === 'CLOSER' ? 'RETURNED_TO_CLOSER' : 'RETURNED_TO_RETENTION';

  const updated = await prisma.lead.updateMany({
    where: { id: leadId, status: lead.status },
    data: { status, returnReason: reason.trim(), adminStatus: null },
  });
  if (updated.count === 0) return { error: 'Lead was already updated', status: 409 };

  const returnedTo = target === 'JUNIOR_CLOSER' ? lead.juniorCloserId : target === 'CLOSER' ? lead.closerId : lead.retentionId;
  void recordRetentionEvents(
    [leadId],
    target === 'RETENTION' ? 'RETURNED_TO_RETENTION' : target === 'CLOSER' ? 'RETURNED_TO_CLOSER' : 'RETURNED_TO_JUNIOR',
    { actorId, targetId: returnedTo, note: reason.trim() }
  );
  void notifyUsers([returnedTo], {
    kind: 'warning',
    title: 'Lead sent back for correction',
    message: `${who(lead.customerName)}: ${reason.trim()}`,
    page: 'RETURNED',
  });

  const result = await prisma.lead.findUnique({ where: { id: leadId }, include: FULL_INCLUDE });
  return { data: { lead: result } };
}

/**
 * Reverts an ACCEPTED/ASSIGNED_EXTERNAL lead from PAID back to UNPAID, clearing closedAt.
 * Marking a lead PAID only ever happens through batchMarkPaid below (even for a single
 * lead) so every PAID lead always has a PKR amount recorded against it — this endpoint
 * exists solely to undo a mistaken PAID, never to set one.
 */
export async function setLeadPaymentStatus(leadId: string): Promise<ServiceResult<{ lead: unknown }>> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) return { error: 'Lead not found', status: 404 };
  if (!(MONEY_STATUSES as readonly string[]).includes(lead.status)) {
    return { error: 'Only assigned leads can be marked paid/unpaid', status: 400 };
  }

  const updated = await prisma.lead.updateMany({
    where: { id: leadId, status: lead.status },
    data: { paymentStatus: 'UNPAID', closedAt: null },
  });
  if (updated.count === 0) return { error: 'Lead was already updated', status: 409 };

  const result = await prisma.lead.findUnique({ where: { id: leadId }, include: FULL_INCLUDE });
  return { data: { lead: result } };
}

/** Any lead that has been handed to a client can be marked paid / charged back, whatever its decision status. */
const MONEY_STATUSES = ['ASSIGNED', 'ACCEPTED', 'ASSIGNED_EXTERNAL', 'REJECTED'] as const;

/** Leads the admin can label: the admin queue (incl. charged back) plus everything handed to a client. Not new, draft or sent-back leads. */
const TRACKABLE_STATUSES = [...MONEY_STATUSES, 'SUBMITTED', 'CHARGED_BACK'] as const;

function humanizeAdminStatus(value: string): string {
  return value.toLowerCase().split('_').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

/** Outcomes that can't be set on a paid lead that is Approval Confirmed. */
const PRE_PAYMENT_STATUSES: string[] = ['UNDERWRITING_REVIEW', 'APPROVED', 'DECLINED'];

const ADMIN_STATUS_VALUES = [
  'CLIENT_PAID',
  'CLIENT_UNPAID',
  'APPROVAL_CONFIRMED',
  'UNDERWRITING_REVIEW',
  'APPROVED',
  'DECLINED',
] as const;

/**
 * Sets (or clears, with null) the admin's tracking label on a lead. Deliberately unguarded by
 * lead status or type — it can change at any point in the lifecycle and never touches
 * `status` or `paymentStatus`, so there is no transition race to protect against.
 */
export async function setLeadAdminStatus(
  leadId: string,
  adminStatus: unknown,
  actorId?: string,
  reason?: unknown
): Promise<ServiceResult<{ lead: unknown }>> {
  if (adminStatus !== null && !(ADMIN_STATUS_VALUES as readonly unknown[]).includes(adminStatus)) {
    return { error: `adminStatus must be one of ${ADMIN_STATUS_VALUES.join(', ')} or null`, status: 400 };
  }

  // Sent-back, new and draft leads can't be labelled (clearing is always allowed).
  if (adminStatus !== null) {
    const current = await prisma.lead.findUnique({ where: { id: leadId }, select: { status: true, paymentStatus: true, adminStatus: true } });
    if (!current) return { error: 'Lead not found', status: 404 };
    if (current.paymentStatus === 'PAID' && current.adminStatus === 'APPROVAL_CONFIRMED' && PRE_PAYMENT_STATUSES.includes(adminStatus as string)) {
      return { error: 'Underwriting Review, Approved and Declined no longer apply once a paid lead is Approval Confirmed', status: 400 };
    }
    if (!(TRACKABLE_STATUSES as readonly string[]).includes(current.status)) {
      return { error: 'Tracking status can only be set on leads in the admin queue or assigned to a client', status: 400 };
    }
  }

  // Approval Confirmed / Declined carry the old accept / reject transition for a lead that is
  // still awaiting its client's decision; on any other lead they are just the label.
  if (adminStatus === 'APPROVAL_CONFIRMED' || adminStatus === 'DECLINED') {
    const awaiting = await prisma.lead.findFirst({
      where: { id: leadId, status: { in: ['ASSIGNED', 'ASSIGNED_EXTERNAL'] } },
      select: { id: true },
    });
    if (awaiting) {
      const decided = await batchDecideAsAdmin([leadId], adminStatus === 'APPROVAL_CONFIRMED' ? 'ACCEPT' : 'REJECT', reason, actorId);
      if ('error' in decided) return decided;
      // A declined lead leaves the tracking stage (batchDecideAsAdmin already cleared its label).
      if (adminStatus === 'DECLINED') {
        const result = await prisma.lead.findUnique({ where: { id: leadId }, include: FULL_INCLUDE });
        return { data: { lead: result } };
      }
    }
  }

  const updated = await prisma.lead.updateMany({
    where: { id: leadId },
    data: { adminStatus: adminStatus as (typeof ADMIN_STATUS_VALUES)[number] | null },
  });
  if (updated.count === 0) return { error: 'Lead not found', status: 404 };
  void recordRetentionEvents([leadId], 'STATUS_SET', { actorId, note: adminStatus ? humanizeAdminStatus(adminStatus as string) : 'Cleared' });

  const result = await prisma.lead.findUnique({ where: { id: leadId }, include: FULL_INCLUDE });
  return { data: { lead: result } };
}

/**
 * Marks a batch of leads paid together, recording one PKR amount for however many of
 * the selected leads are actually eligible (ACCEPTED/ASSIGNED_EXTERNAL + still UNPAID —
 * ineligible ids are silently skipped rather than failing the whole batch, since the
 * admin is selecting from a list that may include leads already paid). Wrapped in a
 * transaction: the IncomePayment record and the leads it covers must land together.
 */
export async function batchMarkPaid(
  leadIds: unknown,
  pkrAmount: unknown,
  note: unknown,
  actorId?: string
): Promise<ServiceResult<{ count: number }>> {
  if (!Array.isArray(leadIds) || leadIds.length === 0 || !leadIds.every((id) => typeof id === 'string')) {
    return { error: 'Select at least one lead', status: 400 };
  }

  const amountNum = typeof pkrAmount === 'number' ? pkrAmount : typeof pkrAmount === 'string' ? Number(pkrAmount) : NaN;
  if (!Number.isFinite(amountNum) || amountNum <= 0) return { error: 'Enter the PKR amount received', status: 400 };

  if (note !== undefined && note !== null && typeof note !== 'string') return { error: 'Invalid note', status: 400 };

  const eligible = await prisma.lead.findMany({
    where: { id: { in: leadIds }, status: { in: [...MONEY_STATUSES] }, paymentStatus: 'UNPAID' },
    select: { id: true },
  });
  if (eligible.length === 0) return { error: 'None of the selected leads can be marked paid', status: 400 };

  const eligibleIds = eligible.map((l) => l.id);

  // Guarded update first: if a concurrent batch already paid any of these leads, the row lock
  // makes this updateMany see them as PAID, the count comes up short, and the whole
  // transaction rolls back — so income is never recorded twice for the same lead.
  const applied = await runGuardedTransaction(async (tx) => {
    const updated = await tx.lead.updateMany({
      where: { id: { in: eligibleIds }, status: { in: [...MONEY_STATUSES] }, paymentStatus: 'UNPAID' },
      data: { paymentStatus: 'PAID', closedAt: new Date() },
    });
    if (updated.count !== eligibleIds.length) throw new StaleTransitionError();
    await tx.incomePayment.create({
      data: {
        pkrAmount: Math.trunc(amountNum),
        note: isNonEmptyString(note) ? note.trim() : null,
        leads: { connect: eligibleIds.map((id) => ({ id })) },
      },
    });
  });
  if (!applied) return STALE_TRANSITION_ERROR;

  void recordRetentionEvents(eligibleIds, 'PAID', { actorId });
  return { data: { count: eligibleIds.length } };
}

export async function listQueueForAdmin(viewer?: AdminViewer) {
  return prisma.lead.findMany({
    where: { status: { in: ['SUBMITTED', 'REJECTED'] }, ...managerScope(viewer) },
    include: adminInclude(viewer),
    orderBy: { updatedAt: 'desc' },
  });
}

/**
 * Records a chargeback against an ACCEPTED + PAID lead and frees it up for reassignment.
 * A chargeback is money coming back after it was actually received, so it's only valid
 * once a lead has actually been marked paid — mirrors why batchMarkPaid is the only path
 * to PAID in the first place. Resets paymentStatus/closedAt exactly like
 * setLeadPaymentStatus does when reverting a mistaken PAID; clientId is cleared like a
 * REJECTED lead's, and the ChargeBack row is what remembers which client it was.
 */
/** Draft number 1–12 the charge-back hit; anything else is rejected. */
function parseChargeMonth(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= 12 ? n : null;
}

export async function markLeadChargedBack(
  leadId: string,
  pkrAmount: unknown,
  reason: unknown,
  chargeMonth: unknown
): Promise<ServiceResult<{ lead: unknown }>> {
  const month = parseChargeMonth(chargeMonth);
  if (month === null) return { error: 'Pick the month of the charge-back', status: 400 };
  if (!isNonEmptyString(reason)) return { error: 'A reason is required', status: 400 };

  const amountNum = typeof pkrAmount === 'number' ? pkrAmount : typeof pkrAmount === 'string' ? Number(pkrAmount) : NaN;
  if (!Number.isFinite(amountNum) || amountNum <= 0) return { error: 'Enter the PKR amount charged back', status: 400 };

  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) return { error: 'Lead not found', status: 404 };
  if (!(MONEY_STATUSES as readonly string[]).includes(lead.status) || lead.paymentStatus !== 'PAID') {
    return { error: 'Only an assigned, paid lead can be charged back', status: 400 };
  }
  if (!lead.clientId) return { error: 'Lead has no client on record', status: 400 };

  const pkr = Math.trunc(amountNum);

  const clientId = lead.clientId;
  // Guarded update first, ChargeBack row only if it actually moved the lead — a concurrent
  // charge-back of the same lead rolls back instead of recording the money twice.
  const applied = await runGuardedTransaction(async (tx) => {
    const updated = await tx.lead.updateMany({
      where: { id: leadId, status: lead.status, paymentStatus: 'PAID' },
      data: { status: 'CHARGED_BACK', clientId: null, paymentStatus: 'UNPAID', closedAt: null, adminStatus: null },
    });
    if (updated.count !== 1) throw new StaleTransitionError();
    // Deliberately NOT mirrored into Expenses: a charge-back is made good by a replacement
    // lead, so it doesn't count as money lost.
    await tx.chargeBack.create({
      data: { leadId, clientId, pkrAmount: pkr, reason: reason.trim(), chargeMonth: month },
    });
  });
  if (!applied) return STALE_TRANSITION_ERROR;

  const result = await prisma.lead.findUnique({ where: { id: leadId }, include: FULL_INCLUDE });
  return { data: { lead: result } };
}

/**
 * Batch counterpart of markLeadChargedBack, mirroring batchMarkPaid: one PKR total and
 * one reason for however many selected leads are actually eligible (ACCEPTED + PAID with
 * a client on record — ineligible ids are silently skipped). The total is split evenly
 * across the leads (remainder on the first) so per-lead ChargeBack rows still sum to what
 * the admin entered. Nothing is written to the Expenses ledger (replacements cover it).
 */
export async function batchChargeBack(
  leadIds: unknown,
  pkrAmount: unknown,
  reason: unknown,
  chargeMonth: unknown
): Promise<ServiceResult<{ count: number }>> {
  if (!Array.isArray(leadIds) || leadIds.length === 0 || !leadIds.every((id) => typeof id === 'string')) {
    return { error: 'Select at least one lead', status: 400 };
  }
  const month = parseChargeMonth(chargeMonth);
  if (month === null) return { error: 'Pick the month of the charge-back', status: 400 };
  if (!isNonEmptyString(reason)) return { error: 'A reason is required', status: 400 };

  const amountNum = typeof pkrAmount === 'number' ? pkrAmount : typeof pkrAmount === 'string' ? Number(pkrAmount) : NaN;
  if (!Number.isFinite(amountNum) || amountNum <= 0) return { error: 'Enter the PKR amount charged back', status: 400 };

  const eligible = await prisma.lead.findMany({
    where: { id: { in: leadIds }, status: { in: [...MONEY_STATUSES] }, paymentStatus: 'PAID', clientId: { not: null } },
    select: { id: true, clientId: true, customerName: true },
  });
  if (eligible.length === 0) return { error: 'None of the selected leads can be charged back', status: 400 };

  const total = Math.trunc(amountNum);
  const share = Math.floor(total / eligible.length);
  const remainder = total - share * eligible.length;
  const trimmedReason = reason.trim();

  // Same guard as batchMarkPaid: update first, abort the whole batch if any lead moved.
  const applied = await runGuardedTransaction(async (tx) => {
    const updated = await tx.lead.updateMany({
      where: { id: { in: eligible.map((l) => l.id) }, status: { in: [...MONEY_STATUSES] }, paymentStatus: 'PAID', clientId: { not: null } },
      data: { status: 'CHARGED_BACK', clientId: null, paymentStatus: 'UNPAID', closedAt: null, adminStatus: null },
    });
    if (updated.count !== eligible.length) throw new StaleTransitionError();
    await tx.chargeBack.createMany({
      data: eligible.map((l, i) => ({
        leadId: l.id,
        clientId: l.clientId!,
        pkrAmount: share + (i === 0 ? remainder : 0),
        reason: trimmedReason,
        chargeMonth: month,
      })),
    });
  });
  if (!applied) return STALE_TRANSITION_ERROR;

  return { data: { count: eligible.length } };
}

/** Charged-back leads waiting to be reassigned to a different client/external client. */
export async function listChargeBacksForAdmin(viewer?: AdminViewer) {
  return prisma.lead.findMany({
    where: { status: 'CHARGED_BACK', ...managerScope(viewer) },
    include: adminInclude(viewer),
    orderBy: { updatedAt: 'desc' },
  });
}

export async function listAllLeadsForAdmin(viewer?: AdminViewer) {
  return prisma.lead.findMany({
    where: managerScope(viewer),
    include: adminInclude(viewer),
    orderBy: { updatedAt: 'desc' },
  });
}

/** All CPL leads, any status — the dedicated Admin "CPL Leads" page filters client-side. */
export async function listCplLeadsForAdmin(viewer?: AdminViewer) {
  return prisma.lead.findMany({
    where: { leadType: 'CPL', ...managerScope(viewer) },
    include: adminInclude(viewer),
    orderBy: { updatedAt: 'desc' },
  });
}

// ─── Team Lead ──────────────────────────────────────────────────
/** Every Junior-Closer-originated lead, any status, masked — Team Lead's read-only oversight
 * of Junior Closers' work. Scoped to leads a Junior Closer actually originated
 * (juniorCloserId set) — a Closer's own self-/AI-sourced lead (no Junior Closer involved)
 * falls outside what this role oversees, same cutoff QA_JUNIOR_CLOSER uses in getLeadById. */
export async function listLeadsForTeamLead() {
  return prisma.lead.findMany({
    where: { juniorCloserId: { not: null } },
    select: TEAM_LEAD_SELECT,
    orderBy: { updatedAt: 'desc' },
  });
}

// ─── Retention ──────────────────────────────────────────────────
// Unlike every other role's leads, RETENTION leads are a shared team queue, not an
// individually-owned one — confirmed deliberately: any Retention person can cover a
// teammate's leads, not just view them. So listRetentionQueue() below is NOT scoped to the
// caller, and enrichAndSubmitRetentionLead() below does NOT check requester ownership.
//
// The one exception to the shared queue: for the first RETENTION_EXCLUSIVE_HOURS after Admin
// hands a lead to someone, only that person can see or work it — teammates were calling
// each other's freshly assigned customers. After the window it rejoins the shared queue.
export const RETENTION_EXCLUSIVE_HOURS = 4;

function retentionWindowStart(): Date {
  return new Date(Date.now() - RETENTION_EXCLUSIVE_HOURS * 60 * 60 * 1000);
}

/** True when `requesterId` may not see the lead: someone else marked it as a Callback (only
 * they see it, even over the assignee), or it is still inside its assignee's exclusive window. */
function isHiddenFromRetentionTeammate(
  lead: { retentionId: string | null; retentionAssignedAt: Date | null; callbackById: string | null },
  requesterId: string
): boolean {
  if (lead.callbackById) return lead.callbackById !== requesterId;
  return (
    lead.retentionId !== requesterId &&
    lead.retentionAssignedAt !== null &&
    lead.retentionAssignedAt > retentionWindowStart()
  );
}

const RETENTION_QUEUE_STATUSES: LeadStatus[] = ['NEW', 'DRAFT', 'RETURNED_TO_RETENTION'];

/**
 * A Retention person builds a lead from scratch — same "self-/AI-sourced, no upstream role
 * involved" pattern as createLeadByCloser, just for the Retention pipeline. Combines the
 * full junior-intake + closer-enrichment field set in one submission and lands straight at
 * SUBMITTED, skipping the shared queue entirely since the creator already did the work.
 * retentionId is set to the creator, so it's theirs on record the same way an admin-assigned
 * lead is once a teammate has worked it — which is what makes returnLeadForEdit's RETENTION
 * target valid for it later.
 */
export async function createLeadByRetention(
  retentionId: string,
  input: Record<string, unknown>
): Promise<ServiceResult<{ lead: unknown }>> {
  const sanitized = sanitizeLeadFields(input, FULL_LEAD_FIELDS, { retention: true });
  if ('error' in sanitized) return { error: sanitized.error, status: 400 };
  const { data } = sanitized;

  if (!isNonEmptyString(data.customerName)) return { error: "Customer's name is required", status: 400 };
  if (!isNonEmptyString(data.phone)) return { error: 'Phone number is required', status: 400 };
  if (!isNonEmptyString(data.state)) return { error: 'State is required', status: 400 };

  const suggested = await resolveSuggestedClientId(input.suggestedClientId);
  if ('error' in suggested) return { error: suggested.error, status: 400 };

  const lead = await prisma.lead.create({
    data: { retentionId, leadType: 'RETENTION', status: 'SUBMITTED', ...data, ...suggested } as Prisma.LeadUncheckedCreateInput,
    include: FULL_INCLUDE,
  });
  void recordRetentionEvents([lead.id], 'CREATED', { actorId: retentionId });
  void recordRetentionEvents([lead.id], 'SUBMITTED', { actorId: retentionId });

  void notifyRoles(ADMIN_TEAM, {
    kind: 'info',
    title: 'Retention lead submitted',
    message: `${who(lead.customerName)} is ready for you to assign.`,
    page: 'ADMIN_LEADS',
  });

  return { data: { lead } };
}

/**
 * Same as createLeadByRetention, but parked as a draft instead of submitted. Lands in the
 * same shared queue (listRetentionQueue includes DRAFT) and resumes through the existing
 * lead-edit page — enrichAndSubmitRetentionLead/saveRetentionLeadAsDraft below already
 * handle the full field set for any RETENTION lead, so no separate resume path is needed.
 */
export async function createDraftByRetention(
  retentionId: string,
  input: Record<string, unknown>
): Promise<ServiceResult<{ lead: unknown }>> {
  const sanitized = sanitizeLeadFields(input, FULL_LEAD_DRAFT_FIELDS, { retention: true });
  if ('error' in sanitized) return { error: sanitized.error, status: 400 };
  const { data } = sanitized;

  if (!isNonEmptyString(data.customerName)) return { error: "Customer's name is required", status: 400 };
  if (!isNonEmptyString(data.phone)) return { error: 'Phone number is required', status: 400 };
  if (!isNonEmptyString(data.state)) return { error: 'State is required', status: 400 };
  const reasonError = normalizeDraftReason(data);
  if (reasonError) return { error: reasonError, status: 400 };

  const suggested = await resolveSuggestedClientId(input.suggestedClientId);
  if ('error' in suggested) return { error: suggested.error, status: 400 };

  const lead = await prisma.lead.create({
    data: { retentionId, leadType: 'RETENTION', status: 'DRAFT', ...data, ...suggested } as Prisma.LeadUncheckedCreateInput,
    include: FULL_INCLUDE,
  });
  void recordRetentionEvents([lead.id], 'CREATED', { actorId: retentionId });

  return { data: { lead } };
}

/** The whole team's working queue — every RETENTION lead handed out and not yet submitted,
 * including ones a teammate parked as a draft (still theirs to resume, same queue), or one
 * the admin sent back for correction (RETURNED_TO_RETENTION — resurfaces here rather than a
 * separate "sent back to me" page, same shared-queue model as everything else Retention
 * works). The "filter to Person A" UX is client-side over this one list, same pattern as
 * admin/leads.ts's closerFilter. */
export async function listRetentionQueue(requesterId: string) {
  return prisma.lead.findMany({
    where: {
      leadType: 'RETENTION',
      retentionId: { not: null },
      status: { in: RETENTION_QUEUE_STATUSES },
      OR: [
        { callbackById: requesterId },
        {
          callbackById: null,
          OR: [
            { retentionId: requesterId },
            { retentionAssignedAt: null },
            { retentionAssignedAt: { lte: retentionWindowStart() } },
          ],
        },
      ],
    },
    select: RETENTION_QUEUE_PREVIEW_SELECT,
    orderBy: { updatedAt: 'desc' },
  });
}

/** Any Retention teammate may edit and submit any other's lead — confirmed, no ownership check.
 * Whoever submits becomes the lead's retention person (retentionId), so the admin sees who
 * actually did the work rather than who it was first assigned to.
 * Also the resubmit path once admin sends a lead back (RETURNED_TO_RETENTION) — clears
 * returnReason the same way resubmitByCloser/resubmitByJuniorCloser do. */
export async function enrichAndSubmitRetentionLead(
  leadId: string,
  submitterId: string,
  input: Record<string, unknown>
): Promise<ServiceResult<{ lead: unknown }>> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) return { error: 'Lead not found', status: 404 };
  if (lead.leadType !== 'RETENTION') return { error: 'Not a retention lead', status: 400 };
  if (isHiddenFromRetentionTeammate(lead, submitterId)) return { error: 'Lead not found', status: 404 };
  if (lead.status !== 'NEW' && lead.status !== 'DRAFT' && lead.status !== 'RETURNED_TO_RETENTION') {
    return { error: 'Lead has already been submitted', status: 400 };
  }

  const sanitized = sanitizeLeadFields(input, FULL_LEAD_FIELDS, { retention: true });
  if ('error' in sanitized) return { error: sanitized.error, status: 400 };

  const suggested = await resolveSuggestedClientId((input as Record<string, unknown>).suggestedClientId);
  if ('error' in suggested) return { error: suggested.error, status: 400 };

  const updated = await prisma.lead.updateMany({
    where: { id: leadId, status: lead.status },
    data: { ...sanitized.data, ...suggested, retentionId: submitterId, status: 'SUBMITTED', draftReason: null, draftReasonNote: null, returnReason: null, callbackById: null, callbackAt: null },
  });
  if (updated.count === 0) return { error: 'Lead was already updated', status: 409 };

  void recordRetentionEvents([leadId], 'SUBMITTED', { actorId: submitterId });
  void notifyRoles(ADMIN_TEAM, {
    kind: 'info',
    title: 'Retention lead submitted',
    message: `${who(lead.customerName)} is ready for you to assign.`,
    page: 'ADMIN_LEADS',
  });

  const result = await prisma.lead.findUnique({ where: { id: leadId }, include: FULL_INCLUDE });
  return { data: { lead: result } };
}

/** Parks a Retention lead as a draft instead of submitting it — same "any teammate can
 * cover" rule as the rest of this section, so no ownership check. Requires a reason,
 * mirroring saveLeadAsDraft's Closer-side equivalent. Also reachable from
 * RETURNED_TO_RETENTION, same as enrichAndSubmitRetentionLead above. */
export async function saveRetentionLeadAsDraft(
  leadId: string,
  requesterId: string,
  input: Record<string, unknown>
): Promise<ServiceResult<{ lead: unknown }>> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) return { error: 'Lead not found', status: 404 };
  if (lead.leadType !== 'RETENTION') return { error: 'Not a retention lead', status: 400 };
  if (isHiddenFromRetentionTeammate(lead, requesterId)) return { error: 'Lead not found', status: 404 };
  if (lead.status !== 'NEW' && lead.status !== 'DRAFT' && lead.status !== 'RETURNED_TO_RETENTION') {
    return { error: 'Only a lead still in the queue can be saved as a draft', status: 400 };
  }

  const sanitized = sanitizeLeadFields(input, FULL_LEAD_DRAFT_FIELDS, { retention: true });
  if ('error' in sanitized) return { error: sanitized.error, status: 400 };
  const { data } = sanitized;

  const reasonError = normalizeDraftReason(data);
  if (reasonError) return { error: reasonError, status: 400 };

  const suggested = await resolveSuggestedClientId((input as Record<string, unknown>).suggestedClientId);
  if ('error' in suggested) return { error: suggested.error, status: 400 };

  const updated = await prisma.lead.updateMany({
    where: { id: leadId, status: lead.status },
    data: { ...data, ...suggested, status: 'DRAFT' },
  });
  if (updated.count === 0) return { error: 'Lead was already updated', status: 409 };

  const result = await prisma.lead.findUnique({ where: { id: leadId }, include: FULL_INCLUDE });
  return { data: { lead: result } };
}

/** Marks a queue lead (NEW, DRAFT or RETURNED_TO_RETENTION) as a Callback for the requester —
 * from then on only they see it. Status and assignee are left alone. The callbackById: null
 * guard means a second teammate racing to claim the same lead gets a 409, not a takeover. */
export async function markRetentionCallback(
  leadId: string,
  requesterId: string
): Promise<ServiceResult<{ lead: unknown }>> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) return { error: 'Lead not found', status: 404 };
  if (lead.leadType !== 'RETENTION') return { error: 'Not a retention lead', status: 400 };
  if (isHiddenFromRetentionTeammate(lead, requesterId)) return { error: 'Lead not found', status: 404 };
  if (!RETENTION_QUEUE_STATUSES.includes(lead.status)) {
    return { error: 'Only a lead still in the queue can be marked as a callback', status: 400 };
  }
  if (lead.callbackById) return { error: 'Lead is already marked as a callback', status: 400 };

  const updated = await prisma.lead.updateMany({
    where: { id: leadId, status: { in: RETENTION_QUEUE_STATUSES }, callbackById: null },
    data: { callbackById: requesterId, callbackAt: new Date() },
  });
  if (updated.count === 0) return { error: 'Lead was already updated', status: 409 };

  const result = await prisma.lead.findUnique({ where: { id: leadId }, include: FULL_INCLUDE });
  return { data: { lead: result } };
}

/** Clears the requester's own Callback — the lead reappears wherever its unchanged status
 * and assignee put it. Only the person who marked it can, since nobody else can see it. */
export async function removeRetentionCallback(
  leadId: string,
  requesterId: string
): Promise<ServiceResult<{ lead: unknown }>> {
  const updated = await prisma.lead.updateMany({
    where: { id: leadId, leadType: 'RETENTION', callbackById: requesterId },
    data: { callbackById: null, callbackAt: null },
  });
  if (updated.count === 0) return { error: 'Lead not found', status: 404 };

  const result = await prisma.lead.findUnique({ where: { id: leadId }, include: FULL_INCLUDE });
  return { data: { lead: result } };
}

/**
 * Leads this Retention person has worked past the queue (submitted, assigned, accepted,
 * rejected, etc.) — scoped to the caller: whoever submits a lead becomes its retentionId,
 * so each person sees only their own. Workers never see a submitted lead's details — only
 * the list-row fields in RETENTION_HISTORY_SELECT.
 */
export async function listRetentionHistory(requesterId: string) {
  const leads = await prisma.lead.findMany({
    where: { leadType: 'RETENTION', retentionId: requesterId, status: { notIn: ['NEW', 'DRAFT'] } },
    select: RETENTION_HISTORY_SELECT,
    orderBy: { updatedAt: 'desc' },
  });
  return leads;
}

// ─── QA ─────────────────────────────────────────────────────────
// Neither queue/history function below touches Lead.status or any transition — QA is
// purely an internal metrics side-channel (see LeadReview in schema.prisma). A lead
// with no juniorCloserId (Closer built it from scratch) never has intake to review, and
// a CPL lead never acquires a closer, so both are excluded from their respective queues.
// Both lanes get FULL_INCLUDE (full lead detail, phone and closer-added fields included)
// — the anti-data-theft masking that hides those from a Junior Closer's own views exists
// to stop a junior harvesting customer data, which doesn't apply to a QA reviewer.

/** Leads with intake QA hasn't reviewed yet — any status, as soon as a junior closer submits. */
export async function listQaJuniorQueue() {
  return prisma.lead.findMany({
    where: { juniorCloserId: { not: null }, qaReviews: { none: { role: 'QA_JUNIOR_CLOSER' } } },
    include: FULL_INCLUDE,
    orderBy: { updatedAt: 'desc' },
  });
}

/** Leads QA has already reviewed the intake on, most recent first. */
export async function listQaJuniorHistory(reviewerId: string) {
  const reviews = await prisma.leadReview.findMany({
    where: { role: 'QA_JUNIOR_CLOSER' },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      outcome: true,
      comment: true,
      createdAt: true,
      reviewerId: true,
      lead: { include: FULL_INCLUDE },
    },
  });
  return reviews.map((r) => ({ ...r, mine: r.reviewerId === reviewerId }));
}

/** Leads whose enrichment QA hasn't reviewed yet — once the closer has actually submitted it. */
export async function listQaCloserQueue() {
  return prisma.lead.findMany({
    where: {
      closerId: { not: null },
      status: { notIn: ['NEW', 'DRAFT'] },
      qaReviews: { none: { role: 'QA_CLOSER' } },
    },
    include: FULL_INCLUDE,
    orderBy: { updatedAt: 'desc' },
  });
}

/** Leads QA has already reviewed the enrichment on, most recent first. */
export async function listQaCloserHistory(reviewerId: string) {
  const reviews = await prisma.leadReview.findMany({
    where: { role: 'QA_CLOSER' },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      outcome: true,
      comment: true,
      createdAt: true,
      reviewerId: true,
      lead: { include: FULL_INCLUDE },
    },
  });
  return reviews.map((r) => ({ ...r, mine: r.reviewerId === reviewerId }));
}

/**
 * Records a QA reviewer's pass/fail verdict on one lead. `role` (which lane) comes from
 * the authenticated reviewer, never the request body — a QA_JUNIOR_CLOSER cannot review
 * enrichment and vice versa. Locked once written: the unique (leadId, role) constraint
 * turns a race into a clean 409 rather than a silent overwrite. Never touches Lead.status.
 */
export async function submitQaReview(
  leadId: string,
  reviewer: { id: string; role: 'QA_JUNIOR_CLOSER' | 'QA_CLOSER' },
  input: { outcome?: unknown; comment?: unknown }
): Promise<ServiceResult<{ review: unknown }>> {
  const outcome = input.outcome;
  if (outcome !== 'PASS' && outcome !== 'FAIL') return { error: 'outcome must be PASS or FAIL', status: 400 };
  if (input.comment !== undefined && input.comment !== null && typeof input.comment !== 'string') {
    return { error: 'Invalid comment', status: 400 };
  }

  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) return { error: 'Lead not found', status: 404 };

  if (reviewer.role === 'QA_JUNIOR_CLOSER') {
    if (!lead.juniorCloserId) return { error: 'This lead has no junior closer intake to review', status: 400 };
  } else {
    if (!lead.closerId) return { error: 'This lead has no closer enrichment to review', status: 400 };
    if (lead.status === 'NEW' || lead.status === 'DRAFT') {
      return { error: 'This lead has not been submitted by the closer yet', status: 400 };
    }
  }

  try {
    const review = await prisma.leadReview.create({
      data: {
        leadId,
        reviewerId: reviewer.id,
        role: reviewer.role,
        outcome,
        comment: isNonEmptyString(input.comment as string | undefined) ? (input.comment as string).trim() : null,
      },
    });
    return { data: { review } };
  } catch (err) {
    // Unique (leadId, role) violation — someone on the same QA lane already reviewed this lead.
    // Anything else is a real failure and goes to the error middleware.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return { error: 'This lead has already been reviewed', status: 409 };
    }
    throw err;
  }
}

// ─── Client ─────────────────────────────────────────────────────
/** New Leads page — ASSIGNED leads awaiting a decision. Full detail: the client is paying for the lead. */
export async function listAssignedPreviewsForClient(clientId: string) {
  return prisma.lead.findMany({
    where: { clientId, status: 'ASSIGNED' },
    include: FULL_INCLUDE,
    orderBy: { updatedAt: 'desc' },
  });
}

/** Lead History page — everything this client has already accepted, full detail. */
export async function listHistoryForClient(clientId: string) {
  return prisma.lead.findMany({
    where: { clientId, status: 'ACCEPTED' },
    include: FULL_INCLUDE,
    orderBy: { updatedAt: 'desc' },
  });
}

/**
 * Client corrects an offered lead before deciding on it. Only while it's ASSIGNED to them;
 * status stays ASSIGNED (editing is not a decision). Same per-type allowlists as the admin's
 * edit — a CPL lead never acquires CPA-only fields.
 */
export async function editAssignedLeadByClient(
  leadId: string,
  clientId: string,
  input: Record<string, unknown>
): Promise<ServiceResult<{ lead: unknown }>> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) return { error: 'Lead not found', status: 404 };
  if (lead.clientId !== clientId) return { error: 'Lead is not assigned to you', status: 403 };
  if (lead.status !== 'ASSIGNED') return { error: 'Only leads awaiting your decision can be edited', status: 400 };

  const allowed: readonly string[] = lead.leadType === 'CPL' ? CPL_INTAKE_FIELDS : ADMIN_EDIT_FIELDS;
  const sanitized = sanitizeLeadFields(input, allowed, { retention: lead.leadType === 'RETENTION' });
  if ('error' in sanitized) return { error: sanitized.error, status: 400 };
  const data: Record<string, unknown> = { ...sanitized.data };

  // The client form shows every field, so a field sent blank means "clear it" (the generic
  // sanitizer skips blanks, which would make a wrong value impossible to remove).
  const REQUIRED = ['customerName', 'phone', 'state'];
  for (const key of allowed) {
    if (!(key in data) && key in input && (input[key] === '' || input[key] === null) && !REQUIRED.includes(key)) {
      data[key] = null;
    }
  }

  if (!isNonEmptyString(data.customerName ?? lead.customerName)) return { error: "Customer's name is required", status: 400 };
  if (!isNonEmptyString(data.phone ?? lead.phone)) return { error: 'Phone number is required', status: 400 };
  if (!isNonEmptyString(data.state ?? lead.state)) return { error: 'State is required', status: 400 };

  const updated = await prisma.lead.updateMany({
    where: { id: leadId, status: 'ASSIGNED', clientId },
    data: data,
  });
  if (updated.count === 0) return { error: 'Lead was already updated', status: 409 };

  const result = await prisma.lead.findUnique({ where: { id: leadId }, include: FULL_INCLUDE });
  return { data: { lead: result } };
}

export async function acceptLead(leadId: string, clientId: string): Promise<ServiceResult<{ lead: unknown }>> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) return { error: 'Lead not found', status: 404 };
  if (lead.clientId !== clientId) return { error: 'Lead is not assigned to you', status: 403 };
  if (lead.status !== 'ASSIGNED') return { error: 'Lead is not awaiting a response', status: 400 };

  const updated = await prisma.lead.updateMany({
    where: { id: leadId, status: 'ASSIGNED', clientId },
    data: { status: 'ACCEPTED' },
  });
  if (updated.count === 0) return { error: 'Lead was already updated', status: 409 };

  void recordRetentionEvents([leadId], 'ACCEPTED', { actorId: clientId });
  void notifyRoles(ADMIN_TEAM, {
    kind: 'success',
    title: 'Lead accepted',
    message: `A client accepted ${who(lead.customerName)}.`,
    page: 'ADMIN_LEADS',
  });
  void notifyUsers([lead.closerId, lead.juniorCloserId], {
    kind: 'success',
    title: 'Your lead was accepted',
    message: `${who(lead.customerName)} was accepted by the client.`,
    page: 'HISTORY',
  });

  const result = await prisma.lead.findUnique({ where: { id: leadId }, include: FULL_INCLUDE });
  return { data: { lead: result } };
}

export async function rejectLead(leadId: string, clientId: string, reason?: string): Promise<ServiceResult<{ lead: unknown }>> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) return { error: 'Lead not found', status: 404 };
  if (lead.clientId !== clientId) return { error: 'Lead is not assigned to you', status: 403 };
  if (lead.status !== 'ASSIGNED') return { error: 'Lead is not awaiting a response', status: 400 };

  // A CPA lead with a closer goes straight back to them for a re-write, carrying the reason.
  // A CPL lead (no closer) goes back to its junior closer the same way.
  const toCloser = lead.leadType === 'CPA' && !!lead.closerId;
  const toJunior = lead.leadType === 'CPL' && !!lead.juniorCloserId;
  // A RETENTION lead goes back to the shared Retention queue (RETURNED_TO_RETENTION).
  const toRetention = lead.leadType === 'RETENTION' && !!lead.retentionId;
  const trimmed = isNonEmptyString(reason) ? reason.trim() : null;

  const updated = await prisma.lead.updateMany({
    where: { id: leadId, status: 'ASSIGNED', clientId },
    data: toCloser
      ? { status: 'RETURNED_TO_CLOSER', clientId: null, rejectionReason: trimmed, adminStatus: null, returnReason: trimmed ?? 'Rejected by client' }
      : toJunior
      ? { status: 'RETURNED_TO_JUNIOR', clientId: null, rejectionReason: trimmed, adminStatus: null, returnReason: trimmed ?? 'Rejected by client' }
      : toRetention
      ? { status: 'RETURNED_TO_RETENTION', clientId: null, rejectionReason: trimmed, adminStatus: null, returnReason: trimmed ?? 'Rejected by client' }
      : { status: 'REJECTED', clientId: null, rejectionReason: reason ?? null, adminStatus: null },
  });
  if (updated.count === 0) return { error: 'Lead was already updated', status: 409 };

  const why = trimmed ? ` Reason: ${trimmed}` : '';
  void recordRetentionEvents([leadId], 'REJECTED', { actorId: clientId, note: trimmed });
  if (toCloser) {
    void notifyUsers([lead.closerId], {
      kind: 'warning',
      title: 'Client rejected your lead',
      message: `${who(lead.customerName)} needs a re-write.${why}`,
      page: 'RETURNED',
    });
  }
  if (toJunior) {
    void notifyUsers([lead.juniorCloserId], {
      kind: 'warning',
      title: 'Client rejected your lead',
      message: `${who(lead.customerName)} needs a re-write.${why}`,
      page: 'RETURNED',
    });
  }
  if (toRetention) {
    void notifyUsers([lead.retentionId], {
      kind: 'warning',
      title: 'Client rejected your lead',
      message: `${who(lead.customerName)} needs a re-write.${why}`,
      page: 'RETURNED',
    });
  }
  void notifyRoles(ADMIN_TEAM, {
    kind: 'danger',
    title: 'Lead rejected by client',
    message: `${who(lead.customerName)} was rejected.${why}`,
    page: 'ADMIN_LEADS',
  });

  const result = await prisma.lead.findUnique({ where: { id: leadId }, include: FULL_INCLUDE });
  return { data: { lead: result } };
}

// ─── Admin override of the client's own accept step ──────────────
// The client normally accepts/rejects a lead themselves through their own portal, but in
// practice the decision is often made over a phone call — the admin needs to record it
// without waiting for the client to log in. No ownership check (unlike acceptLead above):
// the admin isn't the client, they're recording the client's decision on their behalf.
//
// Batch, like batchMarkPaid: the admin ticks leads and picks Accept or Reject. Covers both
// ASSIGNED (a CLIENT account) and ASSIGNED_EXTERNAL (an ExternalClient, who has no login and
// so can only ever be decided for by the admin). Accept → ACCEPTED, keeping whichever
// client/externalClient it was assigned to. Reject → REJECTED, clearing both so it lands
// back in the admin queue for reassignment. Ineligible ids are silently skipped.
export async function batchDecideAsAdmin(
  leadIds: unknown,
  decision: unknown,
  reason: unknown,
  actorId?: string
): Promise<ServiceResult<{ count: number }>> {
  if (!Array.isArray(leadIds) || leadIds.length === 0 || !leadIds.every((id) => typeof id === 'string')) {
    return { error: 'Select at least one lead', status: 400 };
  }
  if (decision !== 'ACCEPT' && decision !== 'REJECT') return { error: 'decision must be ACCEPT or REJECT', status: 400 };
  if (reason !== undefined && reason !== null && typeof reason !== 'string') return { error: 'Invalid reason', status: 400 };

  const eligible = await prisma.lead.findMany({
    where: {
      id: { in: leadIds },
      OR: [
        { status: 'ASSIGNED', clientId: { not: null } },
        { status: 'ASSIGNED_EXTERNAL', externalClientId: { not: null } },
      ],
      // A paid lead has income recorded against it — declining it would send it back still PAID.
      ...(decision === 'REJECT' ? { paymentStatus: 'UNPAID' as const } : {}),
    },
    select: { id: true, leadType: true, closerId: true, juniorCloserId: true, retentionId: true, customerName: true },
  });
  if (eligible.length === 0) {
    return {
      error: decision === 'REJECT' ? 'Paid leads cannot be declined — mark them unpaid first' : 'None of the selected leads are awaiting a response',
      status: 400,
    };
  }

  const awaiting = { status: { in: ['ASSIGNED', 'ASSIGNED_EXTERNAL'] as ('ASSIGNED' | 'ASSIGNED_EXTERNAL')[] } };

  if (decision === 'ACCEPT') {
    const updated = await prisma.lead.updateMany({
      where: { id: { in: eligible.map((l) => l.id) }, ...awaiting },
      data: { status: 'ACCEPTED' },
    });
    if (updated.count === 0) return { error: 'Leads were already updated', status: 409 };
    void recordRetentionEvents(eligible.map((l) => l.id), 'ACCEPTED', { actorId });
    for (const l of eligible) {
      void notifyUsers([l.closerId, l.juniorCloserId], {
        kind: 'success',
        title: 'Your lead was accepted',
        message: `${who(l.customerName)} was accepted.`,
        page: 'HISTORY',
      });
    }
    return { data: { count: updated.count } };
  }

  // REJECT: CPA leads with a closer go back to that closer, CPL leads to their junior closer,
  // RETENTION leads to the Retention queue — each for a re-write (reason carried in
  // returnReason); everything else lands REJECTED in the admin queue as before.
  const trimmed = isNonEmptyString(reason) ? reason.trim() : null;
  const cleared = { clientId: null, externalClientId: null, rejectionReason: trimmed, adminStatus: null };
  const isCpaToCloser = (l: (typeof eligible)[number]) => l.leadType === 'CPA' && !!l.closerId;
  const isCplToJunior = (l: (typeof eligible)[number]) => l.leadType === 'CPL' && !!l.juniorCloserId;
  const isToRetention = (l: (typeof eligible)[number]) => l.leadType === 'RETENTION' && !!l.retentionId;
  const toCloserIds = eligible.filter(isCpaToCloser).map((l) => l.id);
  const toJuniorIds = eligible.filter(isCplToJunior).map((l) => l.id);
  const toRetentionIds = eligible.filter(isToRetention).map((l) => l.id);
  const toAdminIds = eligible
    .filter((l) => !isCpaToCloser(l) && !isCplToJunior(l) && !isToRetention(l))
    .map((l) => l.id);

  const [toCloser, toJunior, toRetention, toAdmin] = await prisma.$transaction([
    prisma.lead.updateMany({
      where: { id: { in: toCloserIds }, ...awaiting },
      data: { ...cleared, status: 'RETURNED_TO_CLOSER', returnReason: trimmed ?? 'Rejected by admin' },
    }),
    prisma.lead.updateMany({
      where: { id: { in: toJuniorIds }, ...awaiting },
      data: { ...cleared, status: 'RETURNED_TO_JUNIOR', returnReason: trimmed ?? 'Rejected by admin' },
    }),
    prisma.lead.updateMany({
      where: { id: { in: toRetentionIds }, ...awaiting },
      data: { ...cleared, status: 'RETURNED_TO_RETENTION', returnReason: trimmed ?? 'Rejected by admin' },
    }),
    prisma.lead.updateMany({
      where: { id: { in: toAdminIds }, ...awaiting },
      data: { ...cleared, status: 'REJECTED' },
    }),
  ]);
  const count = toCloser.count + toJunior.count + toRetention.count + toAdmin.count;
  if (count === 0) return { error: 'Leads were already updated', status: 409 };

  void recordRetentionEvents(eligible.map((l) => l.id), 'REJECTED', { actorId, note: trimmed });
  for (const l of eligible.filter(isCpaToCloser)) {
    void notifyUsers([l.closerId], {
      kind: 'warning',
      title: 'Lead rejected — needs a re-write',
      message: `${who(l.customerName)}: ${trimmed ?? 'Rejected by admin'}`,
      page: 'RETURNED',
    });
  }

  for (const l of eligible.filter(isCplToJunior)) {
    void notifyUsers([l.juniorCloserId], {
      kind: 'warning',
      title: 'Lead rejected — needs a re-write',
      message: `${who(l.customerName)}: ${trimmed ?? 'Rejected by admin'}`,
      page: 'RETURNED',
    });
  }

  for (const l of eligible.filter(isToRetention)) {
    void notifyUsers([l.retentionId], {
      kind: 'warning',
      title: 'Lead rejected — needs a re-write',
      message: `${who(l.customerName)}: ${trimmed ?? 'Rejected by admin'}`,
      page: 'RETURNED',
    });
  }

  return { data: { count } };
}

// ─── Shared ─────────────────────────────────────────────────────
type Requester = {
  id: string;
  role:
    | 'JUNIOR_CLOSER'
    | 'CLOSER'
    | 'ADMIN'
    | 'CLIENT'
    | 'TEAM_LEAD'
    | 'QA_JUNIOR_CLOSER'
    | 'QA_CLOSER'
    | 'RETENTION'
    | 'MANAGER';
};

/** Fetches a lead, scoped to what the requesting role/status combination is allowed to see. */
export async function getLeadById(leadId: string, requester: Requester): Promise<ServiceResult<{ lead: unknown }>> {
  // Loaded once with the full include: the unmasked branches return it as-is, and only the
  // masked branches go back to the DB for their narrower select.
  const lead = await prisma.lead.findUnique({
    where: { id: leadId },
    include: requester.role === 'ADMIN' ? ADMIN_FULL_INCLUDE : FULL_INCLUDE,
  });
  if (!lead) return { error: 'Lead not found', status: 404 };

  // MANAGER gets the same full, unmasked view ADMIN does, but only of Closer/Retention leads
  // (Junior-Closer-originated leads are Team Lead's); the other exclusions on that role
  // (Clients/Team/External Clients/Expenses) are page-level, not lead-detail masking.
  if (requester.role === 'MANAGER' && lead.juniorCloserId) return { error: 'Forbidden', status: 403 };
  if (requester.role === 'ADMIN' || requester.role === 'MANAGER') {
    return { data: { lead } };
  }

  if (requester.role === 'JUNIOR_CLOSER') {
    if (lead.juniorCloserId !== requester.id) return { error: 'Forbidden', status: 403 };
    // Only while it's back with them to fix; every other status stays fully masked.
    if (lead.status === 'RETURNED_TO_JUNIOR') {
      const editable = await prisma.lead.findUnique({ where: { id: leadId }, select: JUNIOR_EDIT_SELECT });
      return { data: { lead: editable } };
    }
    const masked = await prisma.lead.findUnique({ where: { id: leadId }, select: JUNIOR_VIEW_SELECT });
    return { data: { lead: masked } };
  }

  if (requester.role === 'CLOSER') {
    if (lead.closerId !== requester.id) return { error: 'Forbidden', status: 403 };
    if (lead.status === 'NEW' || lead.status === 'RETURNED_TO_CLOSER' || lead.status === 'DRAFT') {
      return { data: { lead } };
    }
    const masked = await prisma.lead.findUnique({ where: { id: leadId }, select: CLOSER_HISTORY_SELECT });
    return { data: { lead: masked } };
  }

  if (requester.role === 'TEAM_LEAD') {
    // Read-only oversight of Junior Closers' work — same masking and juniorCloserId
    // scope as the list endpoint, any status.
    if (!lead.juniorCloserId) return { error: 'Forbidden', status: 403 };
    const masked = await prisma.lead.findUnique({ where: { id: leadId }, select: TEAM_LEAD_SELECT });
    return { data: { lead: masked } };
  }

  if (requester.role === 'QA_JUNIOR_CLOSER') {
    if (!lead.juniorCloserId) return { error: 'Forbidden', status: 403 };
    return { data: { lead } };
  }

  if (requester.role === 'QA_CLOSER') {
    if (!lead.closerId) return { error: 'Forbidden', status: 403 };
    return { data: { lead } };
  }

  if (requester.role === 'RETENTION') {
    // No masking, and no ownership check against requester.id — any Retention teammate can
    // view/edit any RETENTION lead (shared queue), except during its assignee's exclusive window.
    if (lead.leadType !== 'RETENTION') return { error: 'Forbidden', status: 403 };
    if (isHiddenFromRetentionTeammate(lead, requester.id)) return { error: 'Lead not found', status: 404 };
    return { data: { lead } };
  }

  // CLIENT
  if (lead.clientId !== requester.id) return { error: 'Forbidden', status: 403 };
  return { data: { lead } };
}
