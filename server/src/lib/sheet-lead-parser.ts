/**
 * Reads one lead out of a Google Sheet cell. Each lead sits in a single cell of column A as
 * labeled lines ("Full Name: …\nPhone Number: …"); the output uses the same field names and
 * formats as the public retention intake form, so it goes straight into submitRetentionIntake.
 * Server-side counterpart of client/src/app/core/lead-paste-parser.ts (labeled layout only).
 */

const STATE_ABBREVIATIONS: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado',
  CT: 'Connecticut', DE: 'Delaware', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho',
  IL: 'Illinois', IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
  ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada',
  NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon',
  PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota',
  TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington',
  WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
};

const STATE_NAMES = new Map(Object.values(STATE_ABBREVIATIONS).map((n) => [n.toLowerCase(), n]));

/** Label (lower-cased, punctuation stripped) → field. "coverage" carries "amount / premium". */
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
  'carrier name': 'carrierName',
  carrier: 'carrierName',
  coverage: 'coveragePair',
  'coverage premium': 'coveragePair',
  'coverage and premium': 'coveragePair',
  'coverage type': 'planType',
  beneficiary: 'beneficiaryName',
  'beneficiary name': 'beneficiaryName',
  'bank name': 'bankName',
  'account type': 'accountType',
  'routing number': 'routingNumber',
  'account number': 'accountNumber',
};

const EMPTY_VALUES = new Set(['', 'n/a', 'na', 'none', '-', '--', 'null']);

type Fields = Record<string, string | number>;

export interface SheetLeadResult {
  fields: Fields;
  warnings: string[];
}

export function parseSheetLead(cell: string): SheetLeadResult | null {
  const fields: Fields = {};
  const warnings: string[] = [];

  for (const line of cell.split(/\r?\n/)) {
    const m = /^([^:]{2,30}):\s*(.*)$/.exec(line.trim());
    if (!m) continue;
    const key = LABELS[m[1].toLowerCase().replace(/[^a-z& ]/g, '').replace(/&/g, 'and').replace(/\s+/g, ' ').trim()];
    if (key) assign(fields, key, m[2], warnings);
  }

  // Some rows fold the state into the end of the address instead of giving it its own line.
  if (!fields['state'] && typeof fields['mailingAddress'] === 'string') {
    const tail = /(?:^|\s)([A-Za-z]{2})\.?$/.exec(fields['mailingAddress']);
    if (tail) assign(fields, 'state', tail[1], []);
  }

  if (fields['routingNumber'] || fields['accountNumber'] || fields['bankName'] || fields['accountType']) {
    fields['paymentMethod'] = 'BANK_ACCOUNT';
  }

  if (Object.keys(fields).length === 0) return null;
  return { fields, warnings };
}

function assign(out: Fields, key: string, rawValue: string, warnings: string[]): void {
  const value = rawValue.trim();
  if (EMPTY_VALUES.has(value.toLowerCase())) return;

  switch (key) {
    case 'customerName':
      out[key] = value.replace(/^\d+[.\s]+/, '').trim();
      break;
    case 'phone': {
      const digits = value.replace(/\D/g, '');
      if (digits.length === 9 || digits.length === 10) out[key] = digits;
      else warnings.push(`Phone has ${digits.length} digits — expected 10.`);
      break;
    }
    case 'state': {
      const name = STATE_ABBREVIATIONS[value.toUpperCase()] ?? STATE_NAMES.get(value.toLowerCase());
      if (name) out[key] = name;
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
      else warnings.push("SSN isn't 9 digits — left blank.");
      break;
    }
    case 'routingNumber': {
      let digits = value.replace(/\D/g, '');
      if (digits.length === 8) {
        digits = digits.padStart(9, '0');
        warnings.push('Routing number had 8 digits — a leading 0 was added.');
      }
      if (digits.length === 9) out[key] = digits;
      else warnings.push("Routing number isn't 9 digits — left blank.");
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
