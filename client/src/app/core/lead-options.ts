import { AccountType, DCode, DraftReason, IncomeSource, LeadNeed, PayerType, PlanType, RetiredIncomeType } from './models/lead.model';

/** Shared by Junior intake and Closer enrichment — same field, same options, both forms. */
export const MARITAL_STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'Single', label: 'Single' },
  { value: 'Married', label: 'Married' },
  { value: 'Divorced', label: 'Divorced' },
  { value: 'Widowed', label: 'Widowed' },
];

/** Shared by Junior intake and Closer enrichment — no option list given in the spec,
 * same placeholder-judgment-call pattern as MARITAL_STATUS_OPTIONS above. */
export const GENDER_OPTIONS: { value: string; label: string }[] = [
  { value: 'Male', label: 'Male' },
  { value: 'Female', label: 'Female' },
];

export const NEED_OPTIONS: { value: LeadNeed; label: string }[] = [
  { value: 'BURIAL', label: 'Burial' },
  { value: 'CREMATION', label: 'Cremation' },
  { value: 'LEAVE_MONEY', label: 'Leave money' },
];

export const INCOME_SOURCE_OPTIONS: { value: IncomeSource; label: string }[] = [
  { value: 'EMPLOYED', label: 'Employed' },
  { value: 'SELF_EMPLOYED', label: 'Self employed' },
  { value: 'RETIRED', label: 'Retired' },
];

export const RETIRED_INCOME_OPTIONS: { value: RetiredIncomeType; label: string }[] = [
  { value: 'SSI', label: 'SSI' },
  { value: 'SSDI', label: 'SSDI' },
];

export const ACCOUNT_TYPE_OPTIONS: { value: AccountType; label: string }[] = [
  { value: 'CHECKING', label: 'Checking' },
  { value: 'SAVINGS', label: 'Savings' },
];

/** Shared by Junior intake and Closer enrichment. `undefined` (unset) is the placeholder state. */
export const SMOKER_OPTIONS: { value: boolean; label: string }[] = [
  { value: true, label: 'Yes' },
  { value: false, label: 'No' },
];

export const PAYER_OPTIONS: { value: PayerType; label: string }[] = [
  { value: 'SELF', label: 'Self' },
  { value: 'SOMEONE_ELSE', label: 'Someone else' },
];

/** The four plan types a closer picks from during enrichment — see User.levelCost etc.
 * on the server for the per-client cost of each. `humanizeEnum` would render GI as "Gi",
 * so this carries its own labels rather than reusing that helper. */
export const PLAN_TYPE_OPTIONS: { value: PlanType; label: string }[] = [
  { value: 'LEVEL', label: 'Level' },
  { value: 'GRADED', label: 'Graded' },
  { value: 'MODIFIED', label: 'Modified' },
  { value: 'GI', label: 'GI' },
];

export const PLAN_TYPE_LABEL: Record<PlanType, string> = Object.fromEntries(
  PLAN_TYPE_OPTIONS.map((o) => [o.value, o.label]),
) as Record<PlanType, string>;

/** The client's own opaque classification code for a CPL lead — no separate label map
 * needed, the codes are already reader-friendly. Also doubles as the Decision Maker and
 * Bank Account yes/no options via SMOKER_OPTIONS above, since the shape is identical. */
export const D_CODE_OPTIONS: { value: DCode; label: string }[] = [
  { value: 'D1', label: 'D1' },
  { value: 'D2', label: 'D2' },
  { value: 'D3', label: 'D3' },
  { value: 'D4', label: 'D4' },
];

export const DRAFT_REASON_OPTIONS: { value: DraftReason; label: string }[] = [
  { value: 'MISSING_INFO', label: 'Missing info' },
  { value: 'CLIENT_NOT_REACHABLE', label: 'Client not reachable' },
  { value: 'NEEDS_FOLLOW_UP', label: 'Needs follow-up' },
  { value: 'PENDING_DOCUMENTATION', label: 'Pending documentation' },
  { value: 'OTHER', label: 'Other' },
];
