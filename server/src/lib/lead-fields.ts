// Generic field-level validation for the large, evolving Lead field set.
// Runtime type/shape checks matter here (request bodies are `unknown`), not full
// business-rule validation — see REQUIREMENTS.md for what's still being defined.

type FieldType = 'string' | 'int' | 'boolean' | 'date' | 'ssn' | 'routing';

interface FieldSpec {
  type: FieldType;
  enumValues?: readonly string[];
}

const SSN_PATTERN = /^\d{3}-?\d{2}-?\d{4}$/;
const ROUTING_PATTERN = /^\d{9}$/;

export const DRAFT_REASON_VALUES = [
  'MISSING_INFO',
  'CLIENT_NOT_REACHABLE',
  'NEEDS_FOLLOW_UP',
  'PENDING_DOCUMENTATION',
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
  phone: { type: 'string' },
  state: { type: 'string' },
  zipcode: { type: 'string' },
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
  medications: { type: 'string' },
  carrierName: { type: 'string' },
  planType: { type: 'string', enumValues: ['LEVEL', 'GRADED', 'MODIFIED', 'GI'] },
  coverageAmount: { type: 'int' },
  monthlyPremiums: { type: 'int' },
  initialDraftDate: { type: 'date' },
  futureDraftDate: { type: 'date' },
  payer: { type: 'string', enumValues: ['SELF', 'SOMEONE_ELSE'] },
  bankName: { type: 'string' },
  accountTitle: { type: 'string' },
  payerSocial: { type: 'ssn' },
  accountType: { type: 'string', enumValues: ['CHECKING', 'SAVINGS'] },
  routingNumber: { type: 'routing' },
  accountNumber: { type: 'string' },

  closerNotes: { type: 'string' },

  // Draft-only — why the closer parked the lead. Not part of any other allowlist below.
  draftReason: { type: 'string', enumValues: DRAFT_REASON_VALUES },

  // CPL intake only
  decisionMaker: { type: 'boolean' },
  bankAccount: { type: 'boolean' },
  dCode: { type: 'string', enumValues: D_CODE_VALUES },
};

export const SHARED_FIELDS = [
  'customerName', 'maritalStatus', 'phone', 'state', 'zipcode', 'birthState', 'gender',
  'smoker', 'dob', 'age', 'height', 'weight', 'healthConditions',
] as const;

export const JUNIOR_ONLY_FIELDS = [
  'need', 'incomeSource', 'retiredIncomeType', 'natureOfDisability', 'annualIncome', 'juniorNotes',
] as const;

export const CLOSER_ONLY_FIELDS = [
  'mailingAddress', 'email', 'yearlyIncome', 'ssn', 'dlStateId', 'doctorName',
  'beneficiaryRelation', 'beneficiaryName', 'beneficiaryDob',
  'medications',
  'carrierName', 'planType', 'coverageAmount', 'monthlyPremiums',
  'initialDraftDate', 'futureDraftDate', 'payer',
  'bankName', 'accountTitle', 'payerSocial', 'accountType', 'routingNumber', 'accountNumber',
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
export const DRAFT_FIELDS = [...CLOSER_ENRICHMENT_FIELDS, 'draftReason'] as const;

// CPL's own, deliberately shorter intake — no enrichment step exists for CPL, so this
// is the entire field set a CPL lead ever carries (see PENDING_CHANGES.md Module M3).
export const CPL_ONLY_FIELDS = ['decisionMaker', 'bankAccount', 'dCode'] as const;
export const CPL_INTAKE_FIELDS = [
  'customerName', 'phone', 'state', 'zipcode', 'smoker', 'dob', 'need', 'juniorNotes',
  ...CPL_ONLY_FIELDS,
] as const;

export type SanitizedLeadFields = Record<string, string | number | boolean | Date>;

export function sanitizeLeadFields(
  body: unknown,
  allowedKeys: readonly string[]
): { data: SanitizedLeadFields } | { error: string } {
  if (typeof body !== 'object' || body === null) return { error: 'Invalid request body' };
  const input = body as Record<string, unknown>;
  const data: SanitizedLeadFields = {};

  for (const key of allowedKeys) {
    const raw = input[key];
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
      case 'routing': {
        if (typeof raw !== 'string' || !ROUTING_PATTERN.test(raw)) return { error: `Invalid ${key} — must be exactly 9 digits` };
        data[key] = raw;
        break;
      }
    }
  }

  return { data };
}
