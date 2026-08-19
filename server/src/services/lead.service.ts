import prisma from '../lib/prisma';
import { isNonEmptyString } from '../lib/validation';
import {
  ADMIN_EDIT_FIELDS,
  CLOSER_ENRICHMENT_FIELDS,
  CPL_INTAKE_FIELDS,
  DRAFT_FIELDS,
  FULL_LEAD_FIELDS,
  JUNIOR_INTAKE_FIELDS,
  sanitizeLeadFields,
} from '../lib/lead-fields';

// Union of both intake allowlists — a lead RETURNED_TO_JUNIOR could be either a CPA or a
// CPL lead, and the junior needs to see/edit whichever field set they originally filled in.
const JUNIOR_EDIT_FIELDS = Array.from(new Set<string>([...JUNIOR_INTAKE_FIELDS, ...CPL_INTAKE_FIELDS]));

type ServiceResult<T> = { data: T; status?: never } | { error: string; status: number };

// ─── Select fragments ────────────────────────────────────────────
// Full detail — everyone with a legitimate reason to see everything (active work, admin, post-accept client).
const FULL_INCLUDE = {
  juniorCloser: { select: { id: true, name: true, email: true } },
  closer: { select: { id: true, name: true, email: true } },
  client: { select: { id: true, name: true, email: true } },
  externalClient: { select: { id: true, name: true, company: true, email: true, phone: true } },
  chargeBacks: {
    orderBy: { createdAt: 'desc' },
    include: { client: { select: { id: true, name: true, email: true } } },
  },
} as const;

// Junior Closer view — ANY lead, ANY time: only Customer Name + status + date, per explicit
// requirement (risk of the junior closer stealing customer information, phone included — a junior
// or closer history view must never carry the phone number). Includes the assigned closer's name
// since that's workflow metadata, not customer PII.
const JUNIOR_VIEW_SELECT = {
  id: true,
  customerName: true,
  status: true,
  createdAt: true,
  leadType: true,
  closer: { select: { id: true, name: true } },
} as const;

// Closer's OWN history (leads no longer actively theirs to work, i.e. status != NEW) — same masking
// as the Junior Closer view, phone excluded for the same anti-data-theft reason. While a lead is
// NEW and assigned to them, they get full detail (below).
const CLOSER_HISTORY_SELECT = {
  id: true,
  customerName: true,
  status: true,
  createdAt: true,
  client: { select: { id: true, name: true } },
} as const;

// Closer's inbox LIST — a closer can browse this without ever committing to work a lead, so it's
// masked the same anti-data-theft way as the history views (no phone, no PII/financial fields).
// Full detail (phone included) only opens up via getLeadById once they click through to actually
// enrich the lead — that's the "theirs to work" moment, not just seeing it listed.
const CLOSER_INBOX_PREVIEW_SELECT = {
  id: true,
  customerName: true,
  state: true,
  need: true,
  status: true,
  createdAt: true,
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
  status: true,
  createdAt: true,
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
  customerName: true,
  status: true,
  createdAt: true,
  leadType: true,
  dCode: true,
  juniorCloser: { select: { id: true, name: true } },
  closer: { select: { id: true, name: true } },
} as const;

// Client preview for an ASSIGNED-but-not-yet-accepted lead — enough to decide accept/reject,
// none of the sensitive underwriting/financial/identity fields (SSN, bank/routing, DOB, etc.).
const CLIENT_PREVIEW_SELECT = {
  id: true,
  customerName: true,
  state: true,
  zipcode: true,
  need: true,
  maritalStatus: true,
  status: true,
  createdAt: true,
  closer: { select: { id: true, name: true } },
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
    data: { juniorCloserId, closerId: input.closerId, ...data } as any,
    include: FULL_INCLUDE,
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
    data: { juniorCloserId, leadType: 'CPL', status: 'SUBMITTED', ...data } as any,
    include: FULL_INCLUDE,
  });

  return { data: { lead } };
}

/** Junior Closer's history — masked to Customer Name + Phone only, regardless of lead status. */
export async function listLeadsForJuniorCloser(juniorCloserId: string) {
  return prisma.lead.findMany({
    where: { juniorCloserId },
    select: JUNIOR_VIEW_SELECT,
    orderBy: { createdAt: 'desc' },
  });
}

/** Leads the admin sent back to this junior closer to correct. */
export async function listReturnedForJuniorCloser(juniorCloserId: string) {
  return prisma.lead.findMany({
    where: { juniorCloserId, status: 'RETURNED_TO_JUNIOR' },
    select: JUNIOR_EDIT_SELECT,
    orderBy: { createdAt: 'desc' },
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
    data: { ...data, status: 'SUBMITTED', returnReason: null } as any,
  });
  if (updated.count === 0) return { error: 'Lead was already updated', status: 409 };

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
    orderBy: { createdAt: 'desc' },
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
    orderBy: { createdAt: 'desc' },
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

/** Closer parks a half-baked enrichment instead of submitting — requires a reason. Resumable via getLeadById/enrichAndSubmitLead. */
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

  const sanitized = sanitizeLeadFields(input, DRAFT_FIELDS);
  if ('error' in sanitized) return { error: sanitized.error, status: 400 };
  const { data } = sanitized;

  if (!isNonEmptyString(data.draftReason as string | undefined)) {
    return { error: 'Pick a reason for saving this as a draft', status: 400 };
  }

  const updated = await prisma.lead.updateMany({
    where: { id: leadId, status: lead.status, closerId },
    data: { ...data, status: 'DRAFT' } as any,
  });
  if (updated.count === 0) return { error: 'Lead was already updated', status: 409 };

  const result = await prisma.lead.findUnique({ where: { id: leadId }, include: FULL_INCLUDE });
  return { data: { lead: result } };
}

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

  const sanitized = sanitizeLeadFields(input, CLOSER_ENRICHMENT_FIELDS);
  if ('error' in sanitized) return { error: sanitized.error, status: 400 };

  const updated = await prisma.lead.updateMany({
    where: { id: leadId, status: lead.status, closerId },
    data: { ...sanitized.data, status: 'SUBMITTED', draftReason: null } as any,
  });
  if (updated.count === 0) return { error: 'Lead was already updated', status: 409 };

  const result = await prisma.lead.findUnique({ where: { id: leadId }, include: FULL_INCLUDE });
  return { data: { lead: result } };
}

/** Leads the admin sent back to this closer to correct — full detail, as when they worked it. */
export async function listReturnedForCloser(closerId: string) {
  return prisma.lead.findMany({
    where: { closerId, status: 'RETURNED_TO_CLOSER' },
    include: FULL_INCLUDE,
    orderBy: { createdAt: 'desc' },
  });
}

/** Closer corrects their enrichment and sends it back to the admin. */
export async function resubmitByCloser(
  leadId: string,
  closerId: string,
  input: Record<string, unknown>
): Promise<ServiceResult<{ lead: unknown }>> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) return { error: 'Lead not found', status: 404 };
  if (lead.closerId !== closerId) return { error: 'Lead is not assigned to you', status: 403 };
  if (lead.status !== 'RETURNED_TO_CLOSER') return { error: 'Lead was not sent back to you', status: 400 };

  const sanitized = sanitizeLeadFields(input, CLOSER_ENRICHMENT_FIELDS);
  if ('error' in sanitized) return { error: sanitized.error, status: 400 };

  const updated = await prisma.lead.updateMany({
    where: { id: leadId, status: 'RETURNED_TO_CLOSER', closerId },
    data: { ...sanitized.data, status: 'SUBMITTED', returnReason: null } as any,
  });
  if (updated.count === 0) return { error: 'Lead was already updated', status: 409 };

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

  const lead = await prisma.lead.create({
    data: { closerId, status: 'SUBMITTED', ...data } as any,
    include: FULL_INCLUDE,
  });

  return { data: { lead } };
}

// ─── Admin ──────────────────────────────────────────────────────
const ASSIGNABLE_STATUSES = ['SUBMITTED', 'REJECTED', 'CHARGED_BACK'] as const;

export async function assignLeadToClient(leadId: string, clientId: string): Promise<ServiceResult<{ lead: unknown }>> {
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

  const result = await prisma.lead.findUnique({ where: { id: leadId }, include: FULL_INCLUDE });
  return { data: { lead: result } };
}

/** Admin hands a lead to a non-login ExternalClient — no accept/reject step, terminal. */
export async function assignLeadToExternalClient(
  leadId: string,
  externalClientId: string
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

  const result = await prisma.lead.findUnique({ where: { id: leadId }, include: FULL_INCLUDE });
  return { data: { lead: result } };
}

/** Admin edits lead fields — only permitted while a lead sits REJECTED, prior to reassignment. */
export async function editLead(leadId: string, input: Record<string, unknown>): Promise<ServiceResult<{ lead: unknown }>> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) return { error: 'Lead not found', status: 404 };
  if (lead.status !== 'REJECTED') return { error: 'Only rejected leads can be edited', status: 400 };

  // A CPL lead never acquires Closer-only fields — not even Admin fills those in.
  const sanitized = sanitizeLeadFields(input, lead.leadType === 'CPL' ? CPL_INTAKE_FIELDS : ADMIN_EDIT_FIELDS);
  if ('error' in sanitized) return { error: sanitized.error, status: 400 };

  const updated = await prisma.lead.update({
    where: { id: leadId },
    data: sanitized.data as any,
    include: FULL_INCLUDE,
  });

  return { data: { lead: updated } };
}

/**
 * Admin sends a lead back for correction, to whichever role entered the bad data.
 * Only from the admin's own queue (SUBMITTED / REJECTED) — a lead that is out with a
 * client, already accepted, or still being worked isn't the admin's to recall.
 */
export async function returnLeadForEdit(
  leadId: string,
  target: 'JUNIOR_CLOSER' | 'CLOSER',
  reason: string
): Promise<ServiceResult<{ lead: unknown }>> {
  if (!isNonEmptyString(reason)) return { error: 'A reason is required so they know what to fix', status: 400 };

  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) return { error: 'Lead not found', status: 404 };
  if (lead.status !== 'SUBMITTED' && lead.status !== 'REJECTED') {
    return { error: 'Only leads waiting in the admin queue can be sent back', status: 400 };
  }
  if (target === 'CLOSER' && lead.leadType === 'CPL') {
    return { error: 'CPL leads have no closer to send back to', status: 400 };
  }
  if (target === 'JUNIOR_CLOSER' && !lead.juniorCloserId) {
    return { error: 'This lead has no junior closer to send back to', status: 400 };
  }

  const status = target === 'JUNIOR_CLOSER' ? 'RETURNED_TO_JUNIOR' : 'RETURNED_TO_CLOSER';

  const updated = await prisma.lead.updateMany({
    where: { id: leadId, status: lead.status },
    data: { status, returnReason: reason.trim() },
  });
  if (updated.count === 0) return { error: 'Lead was already updated', status: 409 };

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
  if (lead.status !== 'ACCEPTED' && lead.status !== 'ASSIGNED_EXTERNAL') {
    return { error: 'Only accepted or externally-assigned leads can be marked paid/unpaid', status: 400 };
  }

  const updated = await prisma.lead.update({
    where: { id: leadId },
    data: { paymentStatus: 'UNPAID', closedAt: null },
    include: FULL_INCLUDE,
  });

  return { data: { lead: updated } };
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
  note: unknown
): Promise<ServiceResult<{ count: number }>> {
  if (!Array.isArray(leadIds) || leadIds.length === 0 || !leadIds.every((id) => typeof id === 'string')) {
    return { error: 'Select at least one lead', status: 400 };
  }

  const amountNum = typeof pkrAmount === 'number' ? pkrAmount : typeof pkrAmount === 'string' ? Number(pkrAmount) : NaN;
  if (!Number.isFinite(amountNum) || amountNum <= 0) return { error: 'Enter the PKR amount received', status: 400 };

  if (note !== undefined && note !== null && typeof note !== 'string') return { error: 'Invalid note', status: 400 };

  const eligible = await prisma.lead.findMany({
    where: { id: { in: leadIds }, status: { in: ['ACCEPTED', 'ASSIGNED_EXTERNAL'] }, paymentStatus: 'UNPAID' },
    select: { id: true },
  });
  if (eligible.length === 0) return { error: 'None of the selected leads can be marked paid', status: 400 };

  const eligibleIds = eligible.map((l) => l.id);

  await prisma.$transaction([
    prisma.incomePayment.create({
      data: {
        pkrAmount: Math.trunc(amountNum),
        note: isNonEmptyString(note) ? note.trim() : null,
        leads: { connect: eligibleIds.map((id) => ({ id })) },
      },
    }),
    prisma.lead.updateMany({
      where: { id: { in: eligibleIds } },
      data: { paymentStatus: 'PAID', closedAt: new Date() },
    }),
  ]);

  return { data: { count: eligibleIds.length } };
}

export async function listQueueForAdmin() {
  return prisma.lead.findMany({
    where: { status: { in: ['SUBMITTED', 'REJECTED'] } },
    include: FULL_INCLUDE,
    orderBy: { createdAt: 'desc' },
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
export async function markLeadChargedBack(
  leadId: string,
  pkrAmount: unknown,
  reason: unknown
): Promise<ServiceResult<{ lead: unknown }>> {
  if (!isNonEmptyString(reason)) return { error: 'A reason is required', status: 400 };

  const amountNum = typeof pkrAmount === 'number' ? pkrAmount : typeof pkrAmount === 'string' ? Number(pkrAmount) : NaN;
  if (!Number.isFinite(amountNum) || amountNum <= 0) return { error: 'Enter the PKR amount charged back', status: 400 };

  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) return { error: 'Lead not found', status: 404 };
  if (lead.status !== 'ACCEPTED' || lead.paymentStatus !== 'PAID') {
    return { error: 'Only an accepted, paid lead can be charged back', status: 400 };
  }
  if (!lead.clientId) return { error: 'Lead has no client on record', status: 400 };

  await prisma.$transaction([
    prisma.chargeBack.create({
      data: { leadId, clientId: lead.clientId, pkrAmount: Math.trunc(amountNum), reason: reason.trim() },
    }),
    prisma.lead.updateMany({
      where: { id: leadId, status: 'ACCEPTED', paymentStatus: 'PAID' },
      data: { status: 'CHARGED_BACK', clientId: null, paymentStatus: 'UNPAID', closedAt: null },
    }),
  ]);

  const result = await prisma.lead.findUnique({ where: { id: leadId }, include: FULL_INCLUDE });
  return { data: { lead: result } };
}

/** Charged-back leads waiting to be reassigned to a different client/external client. */
export async function listChargeBacksForAdmin() {
  return prisma.lead.findMany({
    where: { status: 'CHARGED_BACK' },
    include: FULL_INCLUDE,
    orderBy: { updatedAt: 'desc' },
  });
}

export async function listAllLeadsForAdmin() {
  return prisma.lead.findMany({
    include: FULL_INCLUDE,
    orderBy: { createdAt: 'desc' },
  });
}

/** All CPL leads, any status — the dedicated Admin "CPL Leads" page filters client-side. */
export async function listCplLeadsForAdmin() {
  return prisma.lead.findMany({
    where: { leadType: 'CPL' },
    include: FULL_INCLUDE,
    orderBy: { createdAt: 'desc' },
  });
}

// ─── Team Lead ──────────────────────────────────────────────────
/** Submitted leads, masked — Team Lead's read-only oversight of the admin's incoming queue. */
export async function listSubmittedForTeamLead() {
  return prisma.lead.findMany({
    where: { status: 'SUBMITTED' },
    select: TEAM_LEAD_SELECT,
    orderBy: { createdAt: 'desc' },
  });
}

// ─── Client ─────────────────────────────────────────────────────
/** New Leads page — ASSIGNED leads awaiting a decision. Masked preview until accepted. */
export async function listAssignedPreviewsForClient(clientId: string) {
  return prisma.lead.findMany({
    where: { clientId, status: 'ASSIGNED' },
    select: CLIENT_PREVIEW_SELECT,
    orderBy: { createdAt: 'desc' },
  });
}

/** Lead History page — everything this client has already accepted, full detail. */
export async function listHistoryForClient(clientId: string) {
  return prisma.lead.findMany({
    where: { clientId, status: 'ACCEPTED' },
    include: FULL_INCLUDE,
    orderBy: { createdAt: 'desc' },
  });
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

  const result = await prisma.lead.findUnique({ where: { id: leadId }, include: FULL_INCLUDE });
  return { data: { lead: result } };
}

export async function rejectLead(leadId: string, clientId: string, reason?: string): Promise<ServiceResult<{ lead: unknown }>> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) return { error: 'Lead not found', status: 404 };
  if (lead.clientId !== clientId) return { error: 'Lead is not assigned to you', status: 403 };
  if (lead.status !== 'ASSIGNED') return { error: 'Lead is not awaiting a response', status: 400 };

  const updated = await prisma.lead.updateMany({
    where: { id: leadId, status: 'ASSIGNED', clientId },
    data: { status: 'REJECTED', clientId: null, rejectionReason: reason ?? null },
  });
  if (updated.count === 0) return { error: 'Lead was already updated', status: 409 };

  const result = await prisma.lead.findUnique({ where: { id: leadId }, include: FULL_INCLUDE });
  return { data: { lead: result } };
}

// ─── Shared ─────────────────────────────────────────────────────
type Requester = { id: string; role: 'JUNIOR_CLOSER' | 'CLOSER' | 'ADMIN' | 'CLIENT' | 'TEAM_LEAD' };

/** Fetches a lead, scoped to what the requesting role/status combination is allowed to see. */
export async function getLeadById(leadId: string, requester: Requester): Promise<ServiceResult<{ lead: unknown }>> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) return { error: 'Lead not found', status: 404 };

  if (requester.role === 'ADMIN') {
    return { data: { lead: await prisma.lead.findUnique({ where: { id: leadId }, include: FULL_INCLUDE }) } };
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
      return { data: { lead: await prisma.lead.findUnique({ where: { id: leadId }, include: FULL_INCLUDE } ) } };
    }
    const masked = await prisma.lead.findUnique({ where: { id: leadId }, select: CLOSER_HISTORY_SELECT });
    return { data: { lead: masked } };
  }

  if (requester.role === 'TEAM_LEAD') {
    // Read-only oversight of the admin's incoming queue — same masking as the list endpoint,
    // and only while it's actually sitting there (not once it's moved on).
    if (lead.status !== 'SUBMITTED') return { error: 'Forbidden', status: 403 };
    const masked = await prisma.lead.findUnique({ where: { id: leadId }, select: TEAM_LEAD_SELECT });
    return { data: { lead: masked } };
  }

  // CLIENT
  if (lead.clientId !== requester.id) return { error: 'Forbidden', status: 403 };
  if (lead.status === 'ASSIGNED') {
    const preview = await prisma.lead.findUnique({ where: { id: leadId }, select: CLIENT_PREVIEW_SELECT });
    return { data: { lead: preview } };
  }
  return { data: { lead: await prisma.lead.findUnique({ where: { id: leadId }, include: FULL_INCLUDE }) } };
}
