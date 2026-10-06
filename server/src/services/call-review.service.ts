import prisma from '../lib/prisma';
import { isNonEmptyString } from '../lib/validation';

type ServiceResult<T> = { data: T; status?: never } | { error: string; status: number };

const REVIEWEE_SELECT = { id: true, name: true, email: true } as const;
const REVIEWER_SELECT = { id: true, name: true, email: true } as const;

/** Which role a QA lane is allowed to write a call review against — enforced server-side,
 *  never trusted from the request body, same pattern as submitQaReview's lane check. */
const EXPECTED_REVIEWEE_ROLE = {
  QA_JUNIOR_CLOSER: 'JUNIOR_CLOSER',
  QA_CLOSER: 'CLOSER',
} as const;

const LEAD_REF_SELECT = { id: true, customerName: true, state: true, createdAt: true } as const;

/** Which Lead column ties a lead to the person a QA lane reviews. */
const WORKED_BY_FIELD = { QA_JUNIOR_CLOSER: 'juniorCloserId', QA_CLOSER: 'closerId' } as const;

/**
 * Records a QA reviewer flagging something wrong on a live call with a Closer or Junior
 * Closer, unlimited per person. There is no "pass" — a call with nothing wrong just never
 * gets a row here, so a description of the issue is required. A lead may optionally be
 * attached (the lead the call was about); it must be one the reviewee actually worked.
 * Never touches any Lead or its status.
 */
export async function submitCallReview(
  reviewer: { id: string; role: 'QA_JUNIOR_CLOSER' | 'QA_CLOSER' },
  input: { revieweeId?: unknown; comment?: unknown; leadId?: unknown }
): Promise<ServiceResult<{ review: unknown }>> {
  if (!isNonEmptyString(input.revieweeId)) return { error: 'Select who this review is about', status: 400 };
  if (!isNonEmptyString(input.comment)) return { error: 'Describe what happened on the call', status: 400 };

  const reviewee = await prisma.user.findUnique({ where: { id: input.revieweeId }, select: { id: true, role: true } });
  const expectedRole = EXPECTED_REVIEWEE_ROLE[reviewer.role];
  if (!reviewee || reviewee.role !== expectedRole) {
    return { error: 'Selected person is invalid', status: 400 };
  }

  let leadId: string | null = null;
  if (input.leadId !== undefined && input.leadId !== null && input.leadId !== '') {
    if (!isNonEmptyString(input.leadId)) return { error: 'Selected lead is invalid', status: 400 };
    const lead = await prisma.lead.findFirst({
      where: { id: input.leadId, [WORKED_BY_FIELD[reviewer.role]]: reviewee.id },
      select: { id: true },
    });
    if (!lead) return { error: 'That lead does not belong to the selected person', status: 400 };
    leadId = lead.id;
  }

  const review = await prisma.callReview.create({
    data: {
      reviewerId: reviewer.id,
      revieweeId: reviewee.id,
      leadId,
      comment: input.comment.trim(),
    },
    include: { reviewee: { select: REVIEWEE_SELECT }, lead: { select: LEAD_REF_SELECT } },
  });

  return { data: { review } };
}

/** Reviews this QA reviewer has personally written, most recent first. */
export async function listMineForReviewer(reviewerId: string) {
  return prisma.callReview.findMany({
    where: { reviewerId },
    orderBy: { createdAt: 'desc' },
    include: { reviewee: { select: REVIEWEE_SELECT }, lead: { select: LEAD_REF_SELECT } },
  });
}

/**
 * Recent leads a person worked, for the "which lead was this call about?" picker. Masked —
 * just enough to recognise the customer, no phone/SSN. Scoped by the reviewer's lane so a
 * QA reviewer can only look up people in their own lane.
 */
export async function listLeadsForReviewee(
  reviewer: { role: 'QA_JUNIOR_CLOSER' | 'QA_CLOSER' },
  revieweeId: unknown
): Promise<ServiceResult<{ leads: unknown[] }>> {
  if (!isNonEmptyString(revieweeId)) return { error: 'revieweeId is required', status: 400 };
  const reviewee = await prisma.user.findUnique({ where: { id: revieweeId }, select: { role: true } });
  if (!reviewee || reviewee.role !== EXPECTED_REVIEWEE_ROLE[reviewer.role]) {
    return { error: 'Selected person is invalid', status: 400 };
  }
  const leads = await prisma.lead.findMany({
    where: { [WORKED_BY_FIELD[reviewer.role]]: revieweeId },
    select: LEAD_REF_SELECT,
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  return { data: { leads } };
}

/** Every call review, any QA reviewer — Admin's oversight list. */
export async function listAllForAdmin() {
  return prisma.callReview.findMany({
    orderBy: { createdAt: 'desc' },
    include: { reviewer: { select: REVIEWER_SELECT }, reviewee: { select: REVIEWEE_SELECT }, lead: { select: LEAD_REF_SELECT } },
  });
}
