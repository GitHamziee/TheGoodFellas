import prisma from '../lib/prisma';
import { isNonEmptyString } from '../lib/validation';
import {
  ADMIN_EDIT_FIELDS,
  CLOSER_ENRICHMENT_FIELDS,
  JUNIOR_INTAKE_FIELDS,
  sanitizeLeadFields,
} from '../lib/lead-fields';

type ServiceResult<T> = { data: T; status?: never } | { error: string; status: number };

// ─── Select fragments ────────────────────────────────────────────
// Full detail — everyone with a legitimate reason to see everything (active work, admin, post-accept client).
const FULL_INCLUDE = {
  juniorCloser: { select: { id: true, name: true, email: true } },
  closer: { select: { id: true, name: true, email: true } },
  client: { select: { id: true, name: true, email: true } },
} as const;

// Junior Closer view — ANY lead, ANY time: only Customer Name + Phone, per explicit requirement
// (risk of the junior closer stealing customer information). Includes the assigned closer's name
// since that's workflow metadata, not customer PII.
const JUNIOR_VIEW_SELECT = {
  id: true,
  customerName: true,
  phone: true,
  status: true,
  createdAt: true,
  closer: { select: { id: true, name: true } },
} as const;

// Closer's OWN history (leads no longer actively theirs to work, i.e. status != NEW) — same masking
// as the Junior Closer view. While a lead is NEW and assigned to them, they get full detail (below).
const CLOSER_HISTORY_SELECT = {
  id: true,
  customerName: true,
  phone: true,
  status: true,
  createdAt: true,
  client: { select: { id: true, name: true } },
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

/** Junior Closer's history — masked to Customer Name + Phone only, regardless of lead status. */
export async function listLeadsForJuniorCloser(juniorCloserId: string) {
  return prisma.lead.findMany({
    where: { juniorCloserId },
    select: JUNIOR_VIEW_SELECT,
    orderBy: { createdAt: 'desc' },
  });
}

// ─── Closer ─────────────────────────────────────────────────────
/** Leads actively assigned to this closer to work (status NEW) — full detail. */
export async function listInboxForCloser(closerId: string) {
  return prisma.lead.findMany({
    where: { closerId, status: 'NEW' },
    include: FULL_INCLUDE,
    orderBy: { createdAt: 'desc' },
  });
}

/** Closer's history — leads they've already submitted onward. Same masking as Junior Closer's view. */
export async function listHistoryForCloser(closerId: string) {
  return prisma.lead.findMany({
    where: { closerId, status: { not: 'NEW' } },
    select: CLOSER_HISTORY_SELECT,
    orderBy: { createdAt: 'desc' },
  });
}

export async function enrichAndSubmitLead(
  leadId: string,
  closerId: string,
  input: Record<string, unknown>
): Promise<ServiceResult<{ lead: unknown }>> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) return { error: 'Lead not found', status: 404 };
  if (lead.closerId !== closerId) return { error: 'Lead is not assigned to you', status: 403 };
  if (lead.status !== 'NEW') return { error: 'Lead has already been submitted', status: 400 };

  const sanitized = sanitizeLeadFields(input, CLOSER_ENRICHMENT_FIELDS);
  if ('error' in sanitized) return { error: sanitized.error, status: 400 };

  const updated = await prisma.lead.updateMany({
    where: { id: leadId, status: 'NEW', closerId },
    data: { ...sanitized.data, status: 'SUBMITTED' } as any,
  });
  if (updated.count === 0) return { error: 'Lead was already updated', status: 409 };

  const result = await prisma.lead.findUnique({ where: { id: leadId }, include: FULL_INCLUDE });
  return { data: { lead: result } };
}

// ─── Admin ──────────────────────────────────────────────────────
export async function assignLeadToClient(leadId: string, clientId: string): Promise<ServiceResult<{ lead: unknown }>> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) return { error: 'Lead not found', status: 404 };
  if (lead.status !== 'SUBMITTED' && lead.status !== 'REJECTED') {
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

/** Admin edits lead fields — only permitted while a lead sits REJECTED, prior to reassignment. */
export async function editLead(leadId: string, input: Record<string, unknown>): Promise<ServiceResult<{ lead: unknown }>> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) return { error: 'Lead not found', status: 404 };
  if (lead.status !== 'REJECTED') return { error: 'Only rejected leads can be edited', status: 400 };

  const sanitized = sanitizeLeadFields(input, ADMIN_EDIT_FIELDS);
  if ('error' in sanitized) return { error: sanitized.error, status: 400 };

  const updated = await prisma.lead.update({
    where: { id: leadId },
    data: sanitized.data as any,
    include: FULL_INCLUDE,
  });

  return { data: { lead: updated } };
}

/** Admin marks an ACCEPTED lead paid/unpaid. PAID also stamps closedAt; reverting to UNPAID clears it. */
export async function setLeadPaymentStatus(
  leadId: string,
  paymentStatus: 'PAID' | 'UNPAID'
): Promise<ServiceResult<{ lead: unknown }>> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) return { error: 'Lead not found', status: 404 };
  if (lead.status !== 'ACCEPTED') return { error: 'Only accepted leads can be marked paid/unpaid', status: 400 };

  const updated = await prisma.lead.update({
    where: { id: leadId },
    data: { paymentStatus, closedAt: paymentStatus === 'PAID' ? new Date() : null },
    include: FULL_INCLUDE,
  });

  return { data: { lead: updated } };
}

export async function listQueueForAdmin() {
  return prisma.lead.findMany({
    where: { status: { in: ['SUBMITTED', 'REJECTED'] } },
    include: FULL_INCLUDE,
    orderBy: { createdAt: 'desc' },
  });
}

export async function listAllLeadsForAdmin() {
  return prisma.lead.findMany({
    include: FULL_INCLUDE,
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
type Requester = { id: string; role: 'JUNIOR_CLOSER' | 'CLOSER' | 'ADMIN' | 'CLIENT' };

/** Fetches a lead, scoped to what the requesting role/status combination is allowed to see. */
export async function getLeadById(leadId: string, requester: Requester): Promise<ServiceResult<{ lead: unknown }>> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId } });
  if (!lead) return { error: 'Lead not found', status: 404 };

  if (requester.role === 'ADMIN') {
    return { data: { lead: await prisma.lead.findUnique({ where: { id: leadId }, include: FULL_INCLUDE }) } };
  }

  if (requester.role === 'JUNIOR_CLOSER') {
    if (lead.juniorCloserId !== requester.id) return { error: 'Forbidden', status: 403 };
    const masked = await prisma.lead.findUnique({ where: { id: leadId }, select: JUNIOR_VIEW_SELECT });
    return { data: { lead: masked } };
  }

  if (requester.role === 'CLOSER') {
    if (lead.closerId !== requester.id) return { error: 'Forbidden', status: 403 };
    if (lead.status === 'NEW') {
      return { data: { lead: await prisma.lead.findUnique({ where: { id: leadId }, include: FULL_INCLUDE } ) } };
    }
    const masked = await prisma.lead.findUnique({ where: { id: leadId }, select: CLOSER_HISTORY_SELECT });
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
