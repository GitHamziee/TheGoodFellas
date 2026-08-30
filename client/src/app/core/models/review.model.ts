import { Lead, LeadIntakeEdit } from './lead.model';

export type ReviewOutcome = 'PASS' | 'FAIL';

interface ReviewParty {
  id: string;
  name: string;
  email: string;
}

/** One QA verdict on a lead's submitted intake or enrichment — see LeadReview in
 * schema.prisma. `mine` marks a review this reviewer personally wrote, since the queue
 * excludes leads any QA lane-mate has already reviewed but history shows everyone's. */
export interface LeadReviewRow<TLead> {
  id: string;
  outcome: ReviewOutcome;
  comment: string | null;
  createdAt: string;
  mine: boolean;
  lead: TLead;
}

/** QA_JUNIOR_CLOSER's queue/history row — same unmasked-intake shape as the Junior
 * Closer's own "sent back to me" edit view (see JUNIOR_EDIT_SELECT server-side). */
export type QaJuniorLeadRow = LeadIntakeEdit;

/** QA_CLOSER's queue/history row — full lead detail, same as an Admin/active-Closer view. */
export type QaCloserLeadRow = Lead;

/** One QA-flagged issue from a live call with a Junior Closer or Closer — no lead
 * involved. There is no "pass" side: a call with nothing wrong never gets a row here, so
 * `comment` (what went wrong) is required. */
export interface CallReview {
  id: string;
  comment: string;
  createdAt: string;
  reviewee: ReviewParty;
}

/** One row of a Live Call Report — how many issues QA has flagged against this person. */
export interface CallReviewBucket {
  id: string;
  name: string;
  email: string;
  count: number;
}

/** One flagged issue as it appears in a Live Call Report's recent-issues list — carries
 * both parties, unlike CallReview above (which only needs the reviewee, since it's
 * rendered on a page already scoped to "reviews I wrote"). */
export interface CallReviewIssue {
  id: string;
  comment: string;
  createdAt: string;
  reviewee: ReviewParty;
  reviewer: ReviewParty;
}

export interface CallReviewAnalytics {
  total: number;
  byPerson: CallReviewBucket[];
  recent: CallReviewIssue[];
}
