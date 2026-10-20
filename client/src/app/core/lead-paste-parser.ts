import { US_STATE_OPTIONS } from './lead-options';
import { RetentionIntakeInput } from './services/lead.service';

export interface LeadPasteResult {
  /** Which sheet layout matched — shown to the user so a wrong guess is obvious. */
  template: 'labeled' | 'positional';
  fields: RetentionIntakeInput;
  /** Things that were pasted but couldn't be used as-is (still worth the user's eyes). */
  warnings: string[];
}

type Fields = Record<string, string | number>;

/** Label (lower-cased, punctuation stripped) → how to read its value. A "coverage"-style
 * label carries "amount / premium" in one cell, so it fans out to two fields. */
const LABELS: Record<string, string> = {
  'full name': 'customerName',
  name: 'customerName',
  'phone number': 'phone',
  phone: 'phone',
  address: 'mailingAddress',
  state: 'state',
  dob: 'dob',
  'date of birth': 'dob',
  ssn: 'ssn',
  'carriers name': 'carrierName',
  carrier: 'carrierName',
  coverage: 'coveragePair',
  'coverage premium': 'coveragePair',
  'coverage and premium': 'coveragePair',
  'coverage type': 'planType',
  beneficiary: 'beneficiaryName',
  'bank name': 'bankName',
  'account type': 'accountType',
  'routing number': 'routingNumber',
  'account number': 'accountNumber',
};

/** Order of the unlabeled layouts (bare values, one per line or one per tab-separated cell).
 * The coverage cell is either "12000/64.50" (10 values) or two cells (11 values). */
/** No state line — it's the last word of the address ("1699 romano park Ln TX"). */
const POSITIONAL_9 = [
  'customerName', 'phone', 'mailingAddress', 'dob', 'ssn', 'carrierName', 'coveragePair', 'routingNumber', 'accountNumber',
];
const POSITIONAL_10 = [
  'customerName', 'phone', 'mailingAddress', 'dob', 'state', 'ssn', 'carrierName', 'coveragePair', 'routingNumber', 'accountNumber',
];
const POSITIONAL_11 = [
  'customerName', 'phone', 'mailingAddress', 'dob', 'state', 'ssn', 'carrierName', 'coverageAmount', 'monthlyPremiums', 'routingNumber', 'accountNumber',
];

const EMPTY_VALUES = new Set(['', 'n/a', 'na', 'none', '-', '--', 'null']);

export function parseLeadPaste(text: string): LeadPasteResult | null {
  const lines = splitCells(text);
  if (lines.length === 0) return null;

  const fields: Fields = {};
  const warnings: string[] = [];
  let template: LeadPasteResult['template'];

  const labeled = lines.map((l) => /^([^:]{2,30}):\s*(.*)$/.exec(l));
  if (labeled.filter(Boolean).length >= Math.ceil(lines.length / 2)) {
    template = 'labeled';
    lines.forEach((line, i) => {
      const m = labeled[i];
      if (!m) return;
      const key = LABELS[m[1].toLowerCase().replace(/[^a-z& ]/g, '').replace(/&/g, 'and').replace(/\s+/g, ' ').trim()];
      if (key) assign(fields, key, m[2], warnings);
    });
  } else {
    const layout = lines.length === 9 ? POSITIONAL_9 : lines.length === 10 ? POSITIONAL_10 : lines.length === 11 ? POSITIONAL_11 : null;
    if (!layout) return null;
    template = 'positional';
    layout.forEach((key, i) => assign(fields, key, lines[i], warnings));
  }

  // Some sheets fold the state into the end of the address instead of giving it its own cell.
  if (!fields['state'] && typeof fields['mailingAddress'] === 'string') {
    const tail = /(?:^|\s)([A-Za-z]{2})\.?$/.exec(fields['mailingAddress']);
    if (tail) assign(fields, 'state', tail[1], []);
  }

  // The form only shows the bank fields once a payment method is chosen.
  if (fields['routingNumber'] || fields['accountNumber'] || fields['bankName'] || fields['accountType']) {
    fields['paymentMethod'] = 'BANK_ACCOUNT';
  }

  if (Object.keys(fields).length === 0) return null;
  return { template, fields: fields as RetentionIntakeInput, warnings };
}

/** A copied sheet row arrives tab-separated on one line; a copied block arrives one per line. */
function splitCells(text: string): string[] {
  const vertical = text.includes('\n');
  const raw = vertical ? text.split(/\r?\n/) : text.split('\t');
  const cells = raw.map((l) => l.trim()).filter((l) => !vertical || l !== '');
  // Blank cells in the middle keep their position (a tab-separated row); trailing ones are noise.
  while (cells.length && cells[cells.length - 1] === '') cells.pop();
  return cells;
}

function assign(out: Fields, key: string, rawValue: string, warnings: string[]): void {
  const value = rawValue.trim();
  if (EMPTY_VALUES.has(value.toLowerCase())) return;

  switch (key) {
    case 'customerName':
      // Some sheets prefix a row number ("10..Cynthia Parker").
      out[key] = value.replace(/^\d+[.\s]+/, '').trim();
      break;
    case 'phone': {
      const digits = value.replace(/\D/g, '');
      if (digits.length === 9 || digits.length === 10) out[key] = digits;
      else warnings.push(`Phone "${value}" has ${digits.length} digits — expected 10, so it was left blank.`);
      break;
    }
    case 'state': {
      const s = US_STATE_OPTIONS.find((o) => o.keywords === value.toUpperCase() || o.value.toLowerCase() === value.toLowerCase());
      if (s) out[key] = s.value;
      else warnings.push(`State "${value}" wasn't recognised.`);
      break;
    }
    case 'dob': {
      const iso = toIsoDate(value);
      if (iso) out[key] = iso;
      else warnings.push(`Date of birth "${value}" wasn't recognised.`);
      break;
    }
    case 'ssn': {
      let digits = value.replace(/\D/g, '');
      if (digits.length === 8) digits = digits.padStart(9, '0'); // a sheet drops the leading zero
      if (digits.length === 9) out[key] = digits;
      else warnings.push(`SSN "${value}" isn't 9 digits — left blank.`);
      break;
    }
    case 'routingNumber': {
      let digits = value.replace(/\D/g, '');
      if (digits.length === 8) {
        digits = digits.padStart(9, '0');
        warnings.push(`Routing number had 8 digits — a leading 0 was added (${digits}). Please double-check it.`);
      }
      if (digits.length === 9) out[key] = digits;
      else warnings.push(`Routing number "${value}" isn't 9 digits — left blank.`);
      break;
    }
    case 'accountNumber':
      out[key] = value.replace(/\D/g, '').slice(0, 17);
      break;
    case 'planType': {
      const plan = value.toUpperCase().replace(/[^A-Z]/g, '');
      if (['LEVEL', 'GRADED', 'MODIFIED', 'GI'].includes(plan)) out[key] = plan;
      else warnings.push(`Coverage type "${value}" wasn't recognised.`);
      break;
    }
    case 'accountType': {
      const t = value.toUpperCase();
      if (t === 'CHECKING' || t === 'SAVINGS') out[key] = t;
      else warnings.push(`Account type "${value}" wasn't recognised.`);
      break;
    }
    case 'coveragePair': {
      const [amount, premium] = value.split('/');
      assign(out, 'coverageAmount', amount ?? '', warnings);
      assign(out, 'monthlyPremiums', premium ?? '', warnings);
      break;
    }
    case 'coverageAmount':
    case 'monthlyPremiums': {
      let n = parseFloat(value.replace(/[^0-9.]/g, ''));
      if (/k\s*$/i.test(value)) n *= 1000; // "20k"
      if (Number.isNaN(n)) warnings.push(`Amount "${value}" wasn't a number.`);
      else out[key] = Math.round(n); // money is whole dollars in this app
      break;
    }
    default:
      out[key] = value;
  }
}

/** m/d/yyyy, yyyy-mm-dd, yyyy.mm.dd, yyyy/mm/dd → yyyy-mm-dd, or null if not a real date. */
function toIsoDate(value: string): string | null {
  let y: number, m: number, d: number;
  let match = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/.exec(value);
  if (match) [y, m, d] = [+match[1], +match[2], +match[3]];
  else if ((match = /^(\d{1,2})[-./](\d{1,2})[-./](\d{4})$/.exec(value))) [m, d, y] = [+match[1], +match[2], +match[3]];
  else return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
