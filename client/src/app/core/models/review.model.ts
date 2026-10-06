import { DCode, Lead, LeadStatus, LeadType } from './lead.model';

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

/** QA_JUNIOR_CLOSER's queue/history row — full lead detail, same as QA_CLOSER's (see
 * FULL_INCLUDE server-side). */
export type QaJuniorLeadRow = Lead;

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
  /** The lead the call was about, when the reviewer attached one. */
  lead?: CallLeadRef | null;
}

/** Minimal lead reference for the "which lead was this call about?" picker and QA's own list. */
export interface CallLeadRef {
  id: string;
  customerName: string;
  state: string | null;
  createdAt: string;
}

/** Everyone in a lane — so people with no activity still show up in a report. */
export interface QaPerson {
  id: string;
  name: string;
  email: string;
}

/** Masked lead summary carried on a QA report row — no phone/SSN/bank fields. */
export interface QaLeadSummary {
  id: string;
  customerName: string;
  leadType: LeadType;
  dCode: DCode | null;
  state: string | null;
  status: LeadStatus;
  createdAt: string;
  juniorCloserId: string | null;
  juniorCloser: QaPerson | null;
  closer: QaPerson | null;
}

/** One QA verdict on a lead, as the Transfer Report sees it. */
export interface QaReviewRow {
  id: string;
  outcome: ReviewOutcome;
  comment: string | null;
  createdAt: string;
  reviewer: QaPerson;
  lead: QaLeadSummary;
}

export interface QaTransferDetail {
  people: QaPerson[];
  reviews: QaReviewRow[];
  /** Leads still waiting on QA for this lane, oldest first. */
  pending: QaLeadSummary[];
}

/** One flagged live-call issue — both parties, unlike CallReview (reviewee only). */
export interface CallReviewIssue {
  id: string;
  comment: string;
  createdAt: string;
  reviewee: ReviewParty;
  reviewer: ReviewParty;
  /** Null when the call was not tied to a lead. */
  lead: QaLeadSummary | null;
}

export interface CallReviewDetail {
  people: QaPerson[];
  issues: CallReviewIssue[];
}

export type QaLane = 'junior' | 'closer';
