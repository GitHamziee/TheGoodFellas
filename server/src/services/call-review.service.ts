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

/**
 * Records a QA reviewer flagging something wrong on a live call with a Closer or Junior
 * Closer — no lead involved, unlimited per person. There is no "pass" — a call with
 * nothing wrong just never gets a row here, so a description of the issue is required.
 * Never touches any Lead or its status.
 */
export async function submitCallReview(
  reviewer: { id: string; role: 'QA_JUNIOR_CLOSER' | 'QA_CLOSER' },
  input: { revieweeId?: unknown; comment?: unknown }
): Promise<ServiceResult<{ review: unknown }>> {
  if (!isNonEmptyString(input.revieweeId)) return { error: 'Select who this review is about', status: 400 };
  if (!isNonEmptyString(input.comment)) return { error: 'Describe what happened on the call', status: 400 };

  const reviewee = await prisma.user.findUnique({ where: { id: input.revieweeId }, select: { id: true, role: true } });
  const expectedRole = EXPECTED_REVIEWEE_ROLE[reviewer.role];
  if (!reviewee || reviewee.role !== expectedRole) {
    return { error: 'Selected person is invalid', status: 400 };
  }

  const review = await prisma.callReview.create({
    data: {
      reviewerId: reviewer.id,
      revieweeId: reviewee.id,
      comment: input.comment.trim(),
    },
    include: { reviewee: { select: REVIEWEE_SELECT } },
  });

  return { data: { review } };
}

/** Reviews this QA reviewer has personally written, most recent first. */
export async function listMineForReviewer(reviewerId: string) {
  return prisma.callReview.findMany({
    where: { reviewerId },
    orderBy: { createdAt: 'desc' },
    include: { reviewee: { select: REVIEWEE_SELECT } },
  });
}

/** Every call review, any QA reviewer — Admin's oversight list. */
export async function listAllForAdmin() {
  return prisma.callReview.findMany({
    orderBy: { createdAt: 'desc' },
    include: { reviewer: { select: REVIEWER_SELECT }, reviewee: { select: REVIEWEE_SELECT } },
  });
}
