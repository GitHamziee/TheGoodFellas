// Generic field-level validation for the large, evolving Lead field set.
// Runtime type/shape checks matter here (request bodies are `unknown`), not full
// business-rule validation — see REQUIREMENTS.md for what's still being defined.

import type { Prisma } from '@prisma/client';
import { normalizeUsPhone, INVALID_PHONE_MESSAGE, INVALID_RETENTION_PHONE_MESSAGE, isValidZip, INVALID_ZIP_MESSAGE } from './validation';

type FieldType = 'string' | 'int' | 'boolean' | 'date' | 'ssn' | 'phone' | 'zip' | 'routing' | 'accountNumber' | 'cardNumber' | 'cardExpiry' | 'beneficiaries';

interface FieldSpec {
  type: FieldType;
  enumValues?: readonly string[];
}

export interface ExtraBeneficiary {
  name: string;
  relation: string;
  dob: string;
}

const MAX_EXTRA_BENEFICIARIES = 10;
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}/;

/** Extra beneficiaries arrive as a list; rows with no name are dropped. `[]` is a real value
 * (it clears the list), unlike the other fields where empty means "not sent". */
function parseBeneficiaries(raw: unknown): ExtraBeneficiary[] | null {
  if (!Array.isArray(raw) || raw.length > MAX_EXTRA_BENEFICIARIES) return null;
  const out: ExtraBeneficiary[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) return null;
    const { name, relation, dob } = item as Record<string, unknown>;
    for (const v of [name, relation, dob]) if (v !== undefined && v !== null && typeof v !== 'string') return null;
    const n = typeof name === 'string' ? name.trim().slice(0, 120) : '';
    if (!n) continue;
    const d = typeof dob === 'string' && DATE_ONLY_PATTERN.test(dob) ? dob.slice(0, 10) : '';
    out.push({ name: n, relation: typeof relation === 'string' ? relation.trim().slice(0, 60) : '', dob: d });
  }
  return out;
}

const SSN_PATTERN = /^\d{3}-?\d{2}-?\d{4}$/;
const ROUTING_PATTERN = /^\d{9}$/;
const ACCOUNT_NUMBER_PATTERN = /^\d{3,17}$/;
const CARD_NUMBER_PATTERN = /^\d{13,19}$/;
const CARD_EXPIRY_PATTERN = /^(0[1-9]|1[0-2])\/\d{2}$/;

export const DRAFT_REASON_VALUES = [
  'LOST_ON_SOCIAL',
  'LOST_ON_ACCOUNT',
  'LOST_ON_PRICES',
  'DEMENTIA_ALZHEIMERS',
  'NOT_A_DM',
  'DNC',
  'BAD_STATE',
  'CALLBACK',
  'HUNGUP',
  'OVER_AGE',
  'CLOSED_DEAD_DEAL',
  'NOT_IN_SERVICE',
  'OTHER',
] as const;

export const D_CODE_VALUES = ['D1', 'D2', 'D3', 'D4'] as const;

export function normalizeSSN(value: string): string {
  const digits = value.replace(/\D/g, '');
  return `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5, 9)}`;
}

const FIELD_SCHEMA: Record<string, FieldSpec> = {
  // shared — set by Junior Closer, editable by Closer
  customerName: { type: 'string' },
  maritalStatus: { type: 'string' },
  phone: { type: 'phone' },
  state: { type: 'string' },
  zipcode: { type: 'zip' },
  birthState: { type: 'string' },
  gender: { type: 'string', enumValues: ['Male', 'Female'] },
  smoker: { type: 'boolean' },
  dob: { type: 'date' },
  age: { type: 'int' },
  height: { type: 'string' },
  weight: { type: 'int' },
  healthConditions: { type: 'string' },

  // Junior Closer intake only
  need: { type: 'string', enumValues: ['BURIAL', 'CREMATION', 'LEAVE_MONEY'] },
  incomeSource: { type: 'string', enumValues: ['EMPLOYED', 'SELF_EMPLOYED', 'RETIRED'] },
  retiredIncomeType: { type: 'string', enumValues: ['SSI', 'SSDI'] },
  natureOfDisability: { type: 'string' },
  annualIncome: { type: 'int' },
  juniorNotes: { type: 'string' },

  // Closer enrichment only
  mailingAddress: { type: 'string' },
  email: { type: 'string' },
  yearlyIncome: { type: 'int' },
  ssn: { type: 'ssn' },
  dlStateId: { type: 'string' },
  doctorName: { type: 'string' },
  beneficiaryRelation: { type: 'string' },
  beneficiaryName: { type: 'string' },
  beneficiaryDob: { type: 'date' },
  extraBeneficiaries: { type: 'beneficiaries' },
  medications: { type: 'string' },
  carrierName: { type: 'string' },
  clientLeadId: { type: 'string' },
  planType: { type: 'string', enumValues: ['LEVEL', 'GRADED', 'MODIFIED', 'GI'] },
  coverageAmount: { type: 'int' },
  monthlyPremiums: { type: 'int' },
  initialDraftDate: { type: 'date' },
  futureDraftDate: { type: 'date' },
  payer: { type: 'string', enumValues: ['SELF', 'SOMEONE_ELSE'] },
  paymentMethod: { type: 'string', enumValues: ['BANK_ACCOUNT', 'CARD'] },
  bankName: { type: 'string' },
  accountTitle: { type: 'string' },
  payerSocial: { type: 'ssn' },
  accountType: { type: 'string', enumValues: ['CHECKING', 'SAVINGS'] },
  accountOwnership: { type: 'string', enumValues: ['SINGLE', 'JOINT'] },
  accountOpeningState: { type: 'string' },
  routingNumber: { type: 'routing' },
  accountNumber: { type: 'accountNumber' },
  cardType: { type: 'string', enumValues: ['CREDIT', 'DEBIT', 'DIRECT_EXPRESS'] },
  cardNumber: { type: 'cardNumber' },
  cardExpiry: { type: 'cardExpiry' },

  closerNotes: { type: 'string' },

  // Draft-only — why the closer parked the lead. Not part of any other allowlist below.
  draftReason: { type: 'string', enumValues: DRAFT_REASON_VALUES },
  draftReasonNote: { type: 'string' },

  // CPL intake only
  decisionMaker: { type: 'boolean' },
  bankAccount: { type: 'boolean' },
  dCode: { type: 'string', enumValues: D_CODE_VALUES },
};

const SENSITIVE_TYPES: FieldType[] = ['ssn', 'routing', 'accountNumber', 'cardNumber', 'cardExpiry'];

/** True for fields holding identity/bank/card numbers — never echoed into logs. */
export function isSensitiveField(key: string): boolean {
  const type = FIELD_SCHEMA[key]?.type;
  return !!type && SENSITIVE_TYPES.includes(type);
}

export const SHARED_FIELDS = [
  'customerName', 'maritalStatus', 'phone', 'state', 'zipcode', 'birthState', 'gender',
  'smoker', 'dob', 'age', 'height', 'weight', 'healthConditions',
] as const;

export const JUNIOR_ONLY_FIELDS = [
  'need', 'incomeSource', 'retiredIncomeType', 'natureOfDisability', 'annualIncome', 'juniorNotes',
] as const;

export const CLOSER_ONLY_FIELDS = [
  'mailingAddress', 'email', 'yearlyIncome', 'ssn', 'dlStateId', 'doctorName',
  'beneficiaryRelation', 'beneficiaryName', 'beneficiaryDob', 'extraBeneficiaries',
  'medications',
  'carrierName', 'clientLeadId', 'planType', 'coverageAmount', 'monthlyPremiums',
  'initialDraftDate', 'futureDraftDate', 'payer', 'paymentMethod',
  'bankName', 'accountTitle', 'payerSocial', 'accountType', 'accountOwnership', 'accountOpeningState',
  'routingNumber', 'accountNumber', 'cardType', 'cardNumber', 'cardExpiry',
  'closerNotes',
] as const;

export const JUNIOR_INTAKE_FIELDS = [...SHARED_FIELDS, ...JUNIOR_ONLY_FIELDS] as const;
export const CLOSER_ENRICHMENT_FIELDS = [...SHARED_FIELDS, ...CLOSER_ONLY_FIELDS] as const;
// Junior intake + closer enrichment together — the full CPA field set. Used by the
// admin's post-rejection edit and by the closer's from-scratch create (self-/AI-sourced
// calls with no junior closer involved).
export const FULL_LEAD_FIELDS = [...SHARED_FIELDS, ...JUNIOR_ONLY_FIELDS, ...CLOSER_ONLY_FIELDS] as const;
export const ADMIN_EDIT_FIELDS = FULL_LEAD_FIELDS;
// Saving/updating a draft accepts everything enrichment does, plus the reason.
export const DRAFT_FIELDS = [...CLOSER_ENRICHMENT_FIELDS, 'draftReason', 'draftReasonNote'] as const;
// Draft variant of FULL_LEAD_FIELDS — used anywhere a lead is built/resumed from the full
// junior+closer field set, not just the closer-only fields: Retention's edit form (any
// RETENTION lead, see enrichAndSubmitRetentionLead), and a self-sourced Closer draft (no
// Junior Closer involved, see saveLeadAsDraft's juniorCloserId branch).
export const FULL_LEAD_DRAFT_FIELDS = [...FULL_LEAD_FIELDS, 'draftReason', 'draftReasonNote'] as const;

// CPL's own, deliberately shorter intake — no enrichment step exists for CPL, so this
// is the entire field set a CPL lead ever carries (see PENDING_CHANGES.md Module M3).
export const CPL_ONLY_FIELDS = ['decisionMaker', 'bankAccount', 'dCode'] as const;
export const CPL_INTAKE_FIELDS = [
  'customerName', 'phone', 'state', 'zipcode', 'smoker', 'dob', 'need', 'juniorNotes',
  ...CPL_ONLY_FIELDS,
] as const;

// What the public retention intake form (see routes/leads.routes.ts's '/retention/intake'
// route) submits — every one of these already exists in FIELD_SCHEMA above (shared with
// CPA), nothing RETENTION-specific needed.
export const RETENTION_INTAKE_FIELDS = [
  'customerName', 'phone', 'mailingAddress', 'state', 'dob', 'ssn', 'carrierName',
  'planType', 'coverageAmount', 'monthlyPremiums', 'beneficiaryName',
  'paymentMethod', 'bankName', 'accountType', 'accountOwnership', 'accountOpeningState',
  'routingNumber', 'accountNumber', 'cardType', 'cardNumber', 'cardExpiry',
] as const;

/** Typed against Prisma's own Lead input so callers can spread it into create/update data
 * without casting. The cast happens once, below: every key comes from FIELD_SCHEMA and has
 * already been type-checked (and enum-checked) against it. */
export type SanitizedLeadFields = Partial<Prisma.LeadUncheckedCreateInput>;

export function sanitizeLeadFields(
  body: unknown,
  allowedKeys: readonly string[],
  opts: { retention?: boolean } = {}
): { data: SanitizedLeadFields } | { error: string } {
  if (typeof body !== 'object' || body === null) return { error: 'Invalid request body' };
  const input = body as Record<string, unknown>;
  const data: Record<string, string | number | boolean | Date | ExtraBeneficiary[]> = {};

  for (const key of allowedKeys) {
    const raw = input[key];
    if (FIELD_SCHEMA[key]?.type === 'beneficiaries') {
      if (raw === undefined || raw === null) continue;
      const list = parseBeneficiaries(raw);
      if (!list) return { error: `Invalid ${key}` };
      data[key] = list;
      continue;
    }
    if (raw === undefined || raw === null || raw === '') continue;

    const spec = FIELD_SCHEMA[key];
    if (!spec) continue;

    switch (spec.type) {
      case 'string': {
        if (typeof raw !== 'string') return { error: `Invalid ${key}` };
        if (spec.enumValues && !spec.enumValues.includes(raw)) return { error: `Invalid ${key}` };
        data[key] = raw;
        break;
      }
      case 'int': {
        const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
        if (!Number.isFinite(n)) return { error: `Invalid ${key}` };
        data[key] = Math.trunc(n);
        break;
      }
      case 'boolean': {
        if (typeof raw === 'boolean') data[key] = raw;
        else if (raw === 'true') data[key] = true;
        else if (raw === 'false') data[key] = false;
        else return { error: `Invalid ${key}` };
        break;
      }
      case 'date': {
        if (typeof raw !== 'string' && !(raw instanceof Date)) return { error: `Invalid ${key}` };
        const d = new Date(raw as string);
        if (Number.isNaN(d.getTime())) return { error: `Invalid ${key}` };
        data[key] = d;
        break;
      }
      case 'ssn': {
        if (typeof raw !== 'string' || !SSN_PATTERN.test(raw)) return { error: `Invalid ${key} — must be 9 digits` };
        data[key] = normalizeSSN(raw);
        break;
      }
      case 'phone': {
        // Retention leads come from US sheets, so they take a 10-digit number (9 still accepted).
        const phone = normalizeUsPhone(raw, opts.retention ? [9, 10] : [9]);
        if (!phone) return { error: opts.retention ? INVALID_RETENTION_PHONE_MESSAGE : INVALID_PHONE_MESSAGE };
        data[key] = phone;
        break;
      }
      case 'zip': {
        if (!isValidZip(raw)) return { error: INVALID_ZIP_MESSAGE };
        data[key] = raw.trim();
        break;
      }
      case 'routing': {
        if (typeof raw !== 'string' || !ROUTING_PATTERN.test(raw)) return { error: `Invalid ${key} — must be exactly 9 digits` };
        data[key] = raw;
        break;
      }
      case 'accountNumber': {
        if (typeof raw !== 'string' || !ACCOUNT_NUMBER_PATTERN.test(raw)) return { error: `Invalid ${key} — must be 3 to 17 digits` };
        data[key] = raw;
        break;
      }
      case 'cardNumber': {
        if (typeof raw !== 'string' || !CARD_NUMBER_PATTERN.test(raw)) return { error: `Invalid ${key} — must be 13 to 19 digits` };
        data[key] = raw;
        break;
      }
      case 'cardExpiry': {
        if (typeof raw !== 'string' || !CARD_EXPIRY_PATTERN.test(raw)) return { error: `Invalid ${key} — must be MM/YY` };
        data[key] = raw;
        break;
      }
    }
  }

  return { data: data as SanitizedLeadFields };
}
