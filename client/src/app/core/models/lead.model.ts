import { ExternalClient } from './external-client.model';

export type LeadStatus =
  | 'NEW'
  | 'SUBMITTED'
  | 'ASSIGNED'
  | 'ACCEPTED'
  | 'REJECTED'
  // Admin sent it back to the role that entered the bad data; all three resubmit to SUBMITTED.
  | 'RETURNED_TO_JUNIOR'
  | 'RETURNED_TO_CLOSER'
  // A RETENTION lead's only valid return target — it never has a junior closer or closer.
  | 'RETURNED_TO_RETENTION'
  // Handed to a non-login ExternalClient — terminal, no approve/decline step.
  | 'ASSIGNED_EXTERNAL'
  // Closer parked a half-baked enrichment instead of submitting; resumable by them only.
  | 'DRAFT'
  // An ACCEPTED + PAID lead was clawed back by the client — see ChargeBack below.
  | 'CHARGED_BACK';
export type PaymentStatus = 'UNPAID' | 'PAID';
export type DraftReason =
  | 'LOST_ON_SOCIAL'
  | 'LOST_ON_ACCOUNT'
  | 'LOST_ON_PRICES'
  | 'DEMENTIA_ALZHEIMERS'
  | 'NOT_A_DM'
  | 'DNC'
  | 'BAD_STATE'
  | 'CALLBACK'
  | 'HUNGUP'
  | 'OVER_AGE'
  | 'CLOSED_DEAD_DEAL'
  | 'NOT_IN_SERVICE'
  | 'OTHER';
export type LeadNeed = 'BURIAL' | 'CREMATION' | 'LEAVE_MONEY';
/** CPA = today's full pipeline. CPL skips the Closer step entirely — see the Lead interface.
 * RETENTION = AI-sourced leads submitted through the public retention intake form (no login),
 * no Junior Closer/Closer step. */
export type LeadType = 'CPA' | 'CPL' | 'RETENTION';
/** The client's own internal classification code for a CPL lead, picked at intake. */
export type DCode = 'D1' | 'D2' | 'D3' | 'D4';
export type IncomeSource = 'EMPLOYED' | 'SELF_EMPLOYED' | 'RETIRED';
export type RetiredIncomeType = 'SSI' | 'SSDI';
export type AccountType = 'CHECKING' | 'SAVINGS';
export type PayerType = 'SELF' | 'SOMEONE_ELSE';
export type PlanType = 'LEVEL' | 'GRADED' | 'MODIFIED' | 'GI';
export type PaymentMethod = 'BANK_ACCOUNT' | 'CARD';
export type CardType = 'CREDIT' | 'DEBIT' | 'DIRECT_EXPRESS';
export type AccountOwnership = 'SINGLE' | 'JOINT';

export interface LeadParty {
  id: string;
  name: string;
  email?: string;
}

/** One chargeback event — snapshots which client the lead was assigned to at the time,
 * since the lead's own clientId is cleared and reassigned elsewhere afterward. */
export interface ChargeBack {
  id: string;
  leadId: string;
  /** ADMIN reads only — the server omits it for every other role. */
  pkrAmount?: number;
  reason: string;
  createdAt: string;
  client: LeadParty;
}

/** Full lead record — admin, active-inbox closer, or client after acceptance. */
export interface Lead {
  id: string;
  /** Null when a Closer created the lead from scratch (self- or AI-sourced calls). */
  juniorCloserId: string | null;
  /** Null for a CPL lead — CPL skips the Closer step entirely, forever. */
  closerId: string | null;
  clientId: string | null;
  externalClientId: string | null;
  /** Set only for RETENTION leads — who Admin handed a form-submitted lead to. */
  retentionId: string | null;
  /** When Admin last handed this lead to retentionId — null on leads a Retention person created themselves. */
  retentionAssignedAt?: string | null;
  /** Non-binding hint from whoever built/enriched the lead — "I think this fits Client X".
   * Admin still explicitly assigns; this is just a heads-up shown in the queue. */
  suggestedClientId?: string | null;

  /** CPA = today's pipeline. A CPL lead never leaves this shorter field set. */
  leadType: LeadType;

  // shared
  customerName: string;
  maritalStatus?: string | null;
  phone: string;
  state: string;
  zipcode?: string | null;
  birthState?: string | null;
  gender?: string | null;
  smoker?: boolean | null;
  dob?: string | null;
  age?: number | null;
  height?: string | null;
  weight?: number | null;
  healthConditions?: string | null;

  // junior-only
  need?: LeadNeed | null;
  incomeSource?: IncomeSource | null;
  retiredIncomeType?: RetiredIncomeType | null;
  natureOfDisability?: string | null;
  annualIncome?: number | null;
  juniorNotes?: string | null;

  // CPL intake only — set by Junior Closer, never touched by Closer or Admin
  dCode?: DCode | null;
  decisionMaker?: boolean | null;
  bankAccount?: boolean | null;

  // closer-only
  mailingAddress?: string | null;
  email?: string | null;
  yearlyIncome?: number | null;
  ssn?: string | null;
  dlStateId?: string | null;
  doctorName?: string | null;
  beneficiaryRelation?: string | null;
  beneficiaryName?: string | null;
  beneficiaryDob?: string | null;
  medications?: string | null;
  carrierName?: string | null;
  planType?: PlanType | null;
  coverageAmount?: number | null;
  monthlyPremiums?: number | null;
  initialDraftDate?: string | null;
  futureDraftDate?: string | null;
  payer?: PayerType | null;
  paymentMethod?: PaymentMethod | null;
  bankName?: string | null;
  accountTitle?: string | null;
  payerSocial?: string | null;
  accountType?: AccountType | null;
  accountOwnership?: AccountOwnership | null;
  accountOpeningState?: string | null;
  routingNumber?: string | null;
  accountNumber?: string | null;
  cardType?: CardType | null;
  cardNumber?: string | null;
  cardExpiry?: string | null;
  closerNotes?: string | null;

  /** Set while status is DRAFT; cleared on final submit. */
  draftReason?: DraftReason | null;
  /** Typed reason, only present when draftReason is 'OTHER'. */
  draftReasonNote?: string | null;

  /** RETENTION only — who marked this queue lead as a Callback. While set, only they see it. */
  callbackById?: string | null;
  callbackAt?: string | null;

  // admin
  rejectionReason?: string | null;
  /** What the admin asked to be corrected. Cleared on resubmit. */
  returnReason?: string | null;
  paymentStatus: PaymentStatus;
  closedAt?: string | null;
  /** Set only when marked paid through the batch "Mark Paid" action — see IncomePayment. */
  incomePaymentId?: string | null;

  status: LeadStatus;
  createdAt: string;
  updatedAt: string;

  /** Null when a Closer created the lead from scratch (self- or AI-sourced calls). */
  juniorCloser: LeadParty | null;
  /** Null for a CPL lead — CPL skips the Closer step entirely, forever. */
  closer: LeadParty | null;
  client: LeadParty | null;
  externalClient: Pick<ExternalClient, 'id' | 'name' | 'company' | 'email' | 'phone'> | null;
  /** Set only for RETENTION leads — who Admin handed a form-submitted lead to. */
  retention: LeadParty | null;
  /** Non-binding "suggested for this client" hint — see suggestedClientId above. */
  suggestedClient?: LeadParty | null;
  /** Full chargeback history, newest first. Empty unless the lead has ever been charged back. */
  chargeBacks: ChargeBack[];
}

/** Masked row for Junior Closer / Closer history views — Name + status + date only, per
 * access-control requirement. Phone is deliberately excluded here (data-theft risk) even
 * though the full Lead carries it. */
export interface LeadHistoryRow {
  id: string;
  customerName: string;
  status: LeadStatus;
  createdAt: string;
  updatedAt: string;
  leadType?: LeadType;
  closer?: LeadParty;
  client?: LeadParty | null;
  /** Junior view only: the QA intake verdict, if QA has reviewed this lead yet. */
  qaReviews?: { outcome: 'PASS' | 'FAIL' }[];
}

/**
 * Junior Closer's view of a lead the admin sent back to them. Wider than
 * LeadHistoryRow because they can't fix what they can't see, but scoped to exactly
 * the intake fields they entered themselves — no closer-added financial/identity
 * fields. Derived from Lead so it can't drift as fields are added.
 */
export type LeadIntakeEdit = Pick<
  Lead,
  | 'id'
  | 'status'
  | 'createdAt'
  | 'updatedAt'
  | 'returnReason'
  | 'leadType'
  | 'customerName'
  | 'maritalStatus'
  | 'phone'
  | 'state'
  | 'zipcode'
  | 'birthState'
  | 'gender'
  | 'smoker'
  | 'dob'
  | 'age'
  | 'height'
  | 'weight'
  | 'healthConditions'
  | 'need'
  | 'incomeSource'
  | 'retiredIncomeType'
  | 'natureOfDisability'
  | 'annualIncome'
  | 'juniorNotes'
  | 'dCode'
  | 'decisionMaker'
  | 'bankAccount'
> & { closer: LeadParty };

/**
 * Team Lead's masked view of the admin's SUBMITTED queue — same anti-data-theft masking as
 * LeadHistoryRow, plus both parties who worked the lead (Team Lead oversees Junior Closer
 * *and* Closer performance).
 */
export interface TeamLeadLeadRow {
  id: string;
  customerName: string;
  status: LeadStatus;
  createdAt: string;
  updatedAt: string;
  leadType?: LeadType;
  dCode?: DCode | null;
  juniorCloser?: LeadParty;
  closer?: LeadParty;
}

/** Masked preview for a Client's not-yet-approved ("New Leads") lead — no PII/financial fields. */
export interface LeadPreview {
  id: string;
  customerName: string;
  state: string;
  zipcode?: string | null;
  need?: LeadNeed | null;
  maritalStatus?: string | null;
  leadType?: LeadType;
  status: LeadStatus;
  createdAt: string;
  updatedAt: string;
  /** Null for a CPL lead — CPL skips the Closer step entirely, forever. */
  closer?: LeadParty | null;
}

/**
 * Masked preview for a Closer's inbox (NEW leads not yet opened) — name/state/need only,
 * per the anti-data-theft rule: browsing the inbox must not expose phone or other PII.
 * Full detail loads separately once the closer opens a lead to actually enrich it.
 */
export interface LeadInboxPreview {
  id: string;
  customerName: string;
  state: string;
  need?: LeadNeed | null;
  status: LeadStatus;
  createdAt: string;
  updatedAt: string;
  leadType?: LeadType;
  juniorCloser: LeadParty;
}
