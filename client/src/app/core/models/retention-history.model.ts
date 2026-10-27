import type { LeadStatus } from './lead.model';

export type RetentionHistoryState = 'PENDING' | 'ACTIVE' | 'CHARGED_BACK' | 'RETAINED';

export type RetentionTimelineKind =
  | 'CREATED'
  | 'ASSIGNED_TO_RETENTION'
  | 'SUBMITTED'
  | 'RETURNED_TO_RETENTION'
  | 'ASSIGNED_TO_CLIENT'
  | 'ASSIGNED_EXTERNAL'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'PAID'
  | 'CHARGED_BACK';

export interface RetentionHistoryRow {
  id: string;
  customerName: string;
  status: LeadStatus;
  state: RetentionHistoryState;
  createdAt: string;
  closer: string | null;
  paidAt: string | null;
  chargedBackAt: string | null;
  chargeBackCount: number;
  /** Whole months from first paid to first charge-back (or today while still active). */
  monthsOnBook: number | null;
  workedBy: string[];
  reassignedTo: string | null;
  retainedBy: string | null;
}

export interface RetentionTimelineEntry {
  at: string;
  kind: RetentionTimelineKind;
  actor: string | null;
  target: string | null;
  note: string | null;
}
