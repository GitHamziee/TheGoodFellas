import { dateInputFromToday } from '../../core/format-utils';
import { RetentionSubmitInput } from '../../core/services/lead.service';

/** The initial draft can be at most this many days after today. */
export const INITIAL_DRAFT_MAX_DAYS = 30;

/** A field the Retention form won't submit without. `key` matches the input's `name`. */
export interface MissingField {
  key: string;
  label: string;
}

/** Clients whose leads must carry their own lead ID (matched on client name). */
const LEAD_ID_CLIENTS = ['AG', 'FCF'];

export function clientNeedsLeadId(clientName: string | null | undefined): boolean {
  return !!clientName && LEAD_ID_CLIENTS.includes(clientName.trim().toUpperCase());
}

const blank = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

/**
 * Every Retention form field is required except email, DL/State ID, yearly income, doctor's
 * name, health conditions, medications, beneficiary DOBs and the admin notes. Sections that
 * only appear conditionally (retired income, SSDI, bank account, card) are only required
 * while shown. Shared by the new-lead and lead-edit forms.
 */
export function retentionMissing(f: RetentionSubmitInput, needsLeadId = false): MissingField[] {
  const out: MissingField[] = [];
  const need = (key: keyof RetentionSubmitInput, label: string) => {
    if (blank(f[key])) out.push({ key, label });
  };
  const digits = (key: keyof RetentionSubmitInput, label: string, min: number, max = min) => {
    const v = (f[key] as string | undefined) ?? '';
    if (v.length < min || v.length > max) out.push({ key, label });
  };

  need('customerName', "Customer's name");
  need('phone', 'Phone number');
  need('state', 'State');
  need('zipcode', 'Zipcode');
  need('mailingAddress', 'Mailing address');
  need('maritalStatus', 'Marital status');
  need('birthState', 'Birth state');
  need('gender', 'Gender');
  need('dob', 'Date of birth');
  need('age', 'Age');
  digits('ssn', 'Social Security Number', 9);

  need('need', 'Need');
  need('incomeSource', 'Source of income');
  if (f.incomeSource === 'RETIRED') need('retiredIncomeType', 'Retired income type');
  if (f.incomeSource === 'RETIRED' && f.retiredIncomeType === 'SSDI') need('natureOfDisability', 'Nature of disability');

  need('height', 'Height');
  need('weight', 'Weight');
  need('smoker', 'Smoker');

  need('beneficiaryName', 'Beneficiary name');
  need('beneficiaryRelation', 'Beneficiary relation');
  (f.extraBeneficiaries ?? []).forEach((b, i) => {
    if (blank(b.name)) out.push({ key: `extraBeneficiaryName${i}`, label: `Beneficiary ${i + 2} name` });
    if (blank(b.relation)) out.push({ key: `extraBeneficiaryRelation${i}`, label: `Beneficiary ${i + 2} relation` });
  });

  need('suggestedClientId', 'Suggested client');
  if (needsLeadId) need('clientLeadId', 'Lead ID');
  need('carrierName', 'Carrier name');
  need('planType', 'Plan type');
  need('coverageAmount', 'Coverage amount');
  need('monthlyPremiums', 'Monthly premium');

  need('initialDraftDate', 'Initial draft date');
  if (f.initialDraftDate && f.initialDraftDate > dateInputFromToday(INITIAL_DRAFT_MAX_DAYS)) {
    out.push({ key: 'initialDraftDate', label: `Initial draft date (within ${INITIAL_DRAFT_MAX_DAYS} days)` });
  }
  need('futureDraftDate', 'Future draft date');
  if (f.initialDraftDate && f.futureDraftDate && f.futureDraftDate.slice(0, 7) <= f.initialDraftDate.slice(0, 7)) {
    out.push({ key: 'futureDraftDate', label: 'Future draft date (a month after the initial draft)' });
  }
  need('payer', 'Who is paying');
  need('paymentMethod', 'Payment method');

  if (f.payer && f.paymentMethod === 'BANK_ACCOUNT') {
    if (f.payer === 'SELF') need('bankName', 'Bank name');
    else digits('payerSocial', "Payer's Social Security Number", 9);
    need('accountTitle', 'Account title');
    need('accountType', 'Account type');
    need('accountOwnership', 'Joint or single account');
    need('accountOpeningState', 'Account opening state');
    digits('routingNumber', 'Routing number', 9);
    digits('accountNumber', 'Account number', 3, 17);
  }
  if (f.payer && f.paymentMethod === 'CARD') {
    need('cardType', 'Card type');
    digits('cardNumber', 'Card number', 13, 19);
    if (!/^(0[1-9]|1[0-2])\/\d{2}$/.test(f.cardExpiry ?? '')) out.push({ key: 'cardExpiry', label: 'Card expiry' });
  }

  return out;
}

/** Scrolls the first highlighted field into view after the highlight renders. */
export function scrollToFirstInvalid(): void {
  setTimeout(() => {
    const el = document.querySelector<HTMLElement>('form .invalid');
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    (el?.matches('input, textarea') ? el : el?.querySelector<HTMLElement>('input, button'))?.focus({ preventScroll: true });
  });
}

/** Scrolls to the next highlighted field below the current viewport centre, wrapping to the first. */
export function scrollToNextInvalid(): void {
  setTimeout(() => {
    const all = Array.from(document.querySelectorAll<HTMLElement>('form .invalid'));
    const mid = window.innerHeight / 2;
    const el = all.find((e) => e.getBoundingClientRect().top > mid + 24) ?? all[0];
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    (el?.matches('input, textarea') ? el : el?.querySelector<HTMLElement>('input, button'))?.focus({ preventScroll: true });
  });
}
