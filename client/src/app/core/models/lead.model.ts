export type LeadStatus = 'NEW' | 'SUBMITTED' | 'ASSIGNED' | 'ACCEPTED' | 'REJECTED';
export type PaymentStatus = 'UNPAID' | 'PAID';
export type LeadNeed = 'BURIAL' | 'CREMATION' | 'LEAVE_MONEY';
export type IncomeSource = 'EMPLOYED' | 'SELF_EMPLOYED' | 'RETIRED';
export type RetiredIncomeType = 'SSI' | 'SSDI';
export type AccountType = 'CHECKING' | 'SAVINGS';
export type PayerType = 'SELF' | 'SOMEONE_ELSE';

export interface LeadParty {
  id: string;
  name: string;
  email?: string;
}

/** Full lead record — admin, active-inbox closer, or client after acceptance. */
export interface Lead {
  id: string;
  juniorCloserId: string;
  closerId: string;
  clientId: string | null;

  // shared
  customerName: string;
  maritalStatus?: string | null;
  phone: string;
  state: string;
  zipcode?: string | null;
  birthState?: string | null;
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
  planType?: string | null;
  coverageAmount?: number | null;
  monthlyPremiums?: number | null;
  initialDraftDate?: string | null;
  futureDraftDate?: string | null;
  payer?: PayerType | null;
  bankName?: string | null;
  accountTitle?: string | null;
  payerSocial?: string | null;
  accountType?: AccountType | null;
  routingNumber?: string | null;
  accountNumber?: string | null;
  closerNotes?: string | null;

  // admin
  rejectionReason?: string | null;
  paymentStatus: PaymentStatus;
  closedAt?: string | null;

  status: LeadStatus;
  createdAt: string;
  updatedAt: string;

  juniorCloser: LeadParty;
  closer: LeadParty;
  client: LeadParty | null;
}

/** Masked row for Junior Closer / Closer history views — Name + Phone only, per access-control requirement. */
export interface LeadHistoryRow {
  id: string;
  customerName: string;
  phone: string;
  status: LeadStatus;
  createdAt: string;
  closer?: LeadParty;
  client?: LeadParty | null;
}

/** Masked preview for a Client's not-yet-accepted ("New Leads") lead — no PII/financial fields. */
export interface LeadPreview {
  id: string;
  customerName: string;
  state: string;
  zipcode?: string | null;
  need?: LeadNeed | null;
  maritalStatus?: string | null;
  status: LeadStatus;
  createdAt: string;
  closer: LeadParty;
}
