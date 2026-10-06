import { AccountOwnership, AccountType, CardType, DCode, DraftReason, IncomeSource, LeadNeed, PayerType, PaymentMethod, PlanType, RetiredIncomeType } from './models/lead.model';

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

export const PAYMENT_METHOD_OPTIONS: { value: PaymentMethod; label: string }[] = [
  { value: 'BANK_ACCOUNT', label: 'Bank account' },
  { value: 'CARD', label: 'Card' },
];

export const CARD_TYPE_OPTIONS: { value: CardType; label: string }[] = [
  { value: 'CREDIT', label: 'Credit card' },
  { value: 'DEBIT', label: 'Debit card' },
  { value: 'DIRECT_EXPRESS', label: 'Direct Express card' },
];

export const ACCOUNT_OWNERSHIP_OPTIONS: { value: AccountOwnership; label: string }[] = [
  { value: 'SINGLE', label: 'Single account' },
  { value: 'JOINT', label: 'Joint account' },
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
  { value: 'LOST_ON_SOCIAL', label: 'Lost on social' },
  { value: 'LOST_ON_ACCOUNT', label: 'Lost on account' },
  { value: 'LOST_ON_PRICES', label: 'Lost on prices' },
  { value: 'DEMENTIA_ALZHEIMERS', label: "Dementia/Alzheimer's" },
  { value: 'NOT_A_DM', label: 'Not a DM' },
  { value: 'DNC', label: 'DNC' },
  { value: 'BAD_STATE', label: 'Bad state' },
  { value: 'CALLBACK', label: 'Callback' },
  { value: 'HUNGUP', label: 'Hungup' },
  { value: 'OVER_AGE', label: 'Over age' },
  { value: 'CLOSED_DEAD_DEAL', label: 'Closed - dead deal' },
  { value: 'NOT_IN_SERVICE', label: 'Not in service' },
  { value: 'OTHER', label: 'Other' },
];

/** `humanizeEnum` would mangle acronyms here (DNC -> "Dnc", NOT_A_DM -> "Not a dm") the
 * same way it botches PlanType's GI — see PLAN_TYPE_LABEL above. Wherever a draft reason
 * is displayed, look it up here instead of calling humanizeEnum on the raw value. */
export const DRAFT_REASON_LABEL: Record<DraftReason, string> = Object.fromEntries(
  DRAFT_REASON_OPTIONS.map((o) => [o.value, o.label]),
) as Record<DraftReason, string>;
