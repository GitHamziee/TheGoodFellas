import { AccountOwnership, AccountType, CardType, DCode, DraftReason, DraftSchedule, IncomeSource, LeadAdminStatus, LeadNeed, LeadStatus, PayerType, PaymentMethod, PlanType, RetiredIncomeType } from './models/lead.model';

import { US_STATES } from './us-states';
import { formatDate } from './format-utils';

/** Leads handed to a client can be marked paid / charged back whatever their decision status. */
export const MONEY_STATUSES: LeadStatus[] = ['ASSIGNED', 'ACCEPTED', 'ASSIGNED_EXTERNAL', 'REJECTED'];

/** Leads the admin can label: the admin queue plus everything handed to a client. */
export const TRACKABLE_STATUSES: LeadStatus[] = [...MONEY_STATUSES, 'SUBMITTED', 'CHARGED_BACK'];

export const ADMIN_STATUS_OPTIONS: { value: LeadAdminStatus; label: string }[] = [
  { value: 'CLIENT_PAID', label: 'Client Paid' },
  { value: 'CLIENT_UNPAID', label: 'Client Unpaid' },
  { value: 'APPROVAL_CONFIRMED', label: 'Approval Confirmed' },
  { value: 'UNDERWRITING_REVIEW', label: 'Underwriting Review' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'DECLINED', label: 'Declined' },
];

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

/** Every US state, as full names — same values the licensed-states picker stores. */
const US_STATE_ABBREVIATIONS: Record<string, string> = {
  Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA', Colorado: 'CO',
  Connecticut: 'CT', Delaware: 'DE', Florida: 'FL', Georgia: 'GA', Hawaii: 'HI', Idaho: 'ID',
  Illinois: 'IL', Indiana: 'IN', Iowa: 'IA', Kansas: 'KS', Kentucky: 'KY', Louisiana: 'LA',
  Maine: 'ME', Maryland: 'MD', Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN',
  Mississippi: 'MS', Missouri: 'MO', Montana: 'MT', Nebraska: 'NE', Nevada: 'NV',
  'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY',
  'North Carolina': 'NC', 'North Dakota': 'ND', Ohio: 'OH', Oklahoma: 'OK', Oregon: 'OR',
  Pennsylvania: 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC', 'South Dakota': 'SD',
  Tennessee: 'TN', Texas: 'TX', Utah: 'UT', Vermont: 'VT', Virginia: 'VA', Washington: 'WA',
  'West Virginia': 'WV', Wisconsin: 'WI', Wyoming: 'WY',
};

export const US_STATE_OPTIONS: { value: string; label: string; keywords: string }[] = US_STATES.map((s) => ({
  value: s,
  label: s,
  keywords: US_STATE_ABBREVIATIONS[s],
}));

export const NEED_OPTIONS: { value: LeadNeed; label: string }[] = [
  { value: 'BURIAL', label: 'Burial' },
  { value: 'CREMATION', label: 'Cremation' },
  { value: 'LEAVE_MONEY', label: 'Leave money' },
];

export const INCOME_SOURCE_OPTIONS: { value: IncomeSource; label: string }[] = [
  { value: 'EMPLOYED', label: 'Employed' },
  { value: 'SELF_EMPLOYED', label: 'Self employed' },
  { value: 'RETIRED', label: 'Retired / SSI / Disability' },
];

export const RETIRED_INCOME_OPTIONS: { value: RetiredIncomeType; label: string }[] = [
  { value: 'SSI', label: 'SSI' },
  { value: 'SSDI', label: 'SSDI' },
];

export const DRAFT_SCHEDULE_OPTIONS: { value: DraftSchedule; label: string }[] = [
  { value: 'FIRST_OF_MONTH', label: '1st of month' },
  { value: 'SECOND_OF_MONTH', label: '2nd of month' },
  { value: 'THIRD_OF_MONTH', label: '3rd of month' },
  { value: 'SECOND_WEDNESDAY', label: '2nd Wednesday' },
  { value: 'THIRD_WEDNESDAY', label: '3rd Wednesday' },
  { value: 'FOURTH_WEDNESDAY', label: '4th Wednesday' },
];

/** Which day of the month each schedule lands on: a fixed day, or the nth Wednesday. */
const DRAFT_SCHEDULE_DAY: Record<DraftSchedule, { day: number } | { wednesday: number }> = {
  FIRST_OF_MONTH: { day: 1 },
  SECOND_OF_MONTH: { day: 2 },
  THIRD_OF_MONTH: { day: 3 },
  SECOND_WEDNESDAY: { wednesday: 2 },
  THIRD_WEDNESDAY: { wednesday: 3 },
  FOURTH_WEDNESDAY: { wednesday: 4 },
};

/** The exact date a schedule falls on in a month — `month` is "yyyy-MM", result "yyyy-MM-dd".
 * Mirrors `draftScheduleDate` in server/src/lib/lead-fields.ts. */
export function draftScheduleDate(schedule: DraftSchedule, month: string): string {
  const [year, mon] = month.split('-').map(Number);
  const rule = DRAFT_SCHEDULE_DAY[schedule];
  let day: number;
  if ('day' in rule) day = rule.day;
  else {
    const firstWeekday = new Date(Date.UTC(year, mon - 1, 1)).getUTCDay();
    day = 1 + ((3 - firstWeekday + 7) % 7) + (rule.wednesday - 1) * 7;
  }
  return `${month}-${String(day).padStart(2, '0')}`;
}

/** A draft's display text: "2nd Wednesday · 12/09/2026" for a schedule, else the date. */
export function draftLabel(date: string | null | undefined, schedule: DraftSchedule | null | undefined): string {
  const label = DRAFT_SCHEDULE_OPTIONS.find((o) => o.value === schedule)?.label;
  if (!label) return formatDate(date);
  return date ? `${label} · ${formatDate(date)}` : label;
}

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

const ORDINALS = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th', '11th', '12th'];

/** Which draft a charge-back hit (stored as the number 1–12). */
export const CHARGE_BACK_MONTH_OPTIONS: { value: number; label: string }[] = ORDINALS.map((o, i) => ({
  value: i + 1,
  label: `Chargeback – ${o} Draft`,
}));

export function chargeBackMonthLabel(month: number | null | undefined): string | null {
  return month ? (CHARGE_BACK_MONTH_OPTIONS[month - 1]?.label ?? null) : null;
}

/** Preset reasons for an admin charging a lead back. The stored ChargeBack.reason is plain
 * text: the preset label, or whatever the admin typed when they picked OTHER. */
export const CHARGE_BACK_REASON_OPTIONS: { value: string; label: string }[] = [
  { value: 'Invalid Account', label: 'Invalid Account' },
  { value: 'Account Closed', label: 'Account Closed' },
  { value: 'NSF', label: 'NSF' },
  { value: 'Customer Cancelled', label: 'Customer Cancelled' },
  { value: 'OTHER', label: 'Other' },
];
