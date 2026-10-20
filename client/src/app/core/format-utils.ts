/** Shared display formatting. Mirrors R4Referral's lib/format-utils.ts conventions. */

/** Every date/time in the app is shown and bucketed in US Pacific time (PST/PDT), whatever the
 * viewer's own timezone is. Never use the bare local-time Date getters for display or day maths. */
export const APP_TIME_ZONE = 'America/Los_Angeles';

const PARTS_FORMAT = new Intl.DateTimeFormat('en-US', {
  timeZone: APP_TIME_ZONE,
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric',
  weekday: 'short',
  hourCycle: 'h23',
});
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export interface PacificParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  weekday: number; // 0 = Sunday
}

/** Calendar fields of an instant as read on a Pacific-time wall clock. */
export function pacificParts(date: Date | string | number = new Date()): PacificParts {
  const out: Record<string, string> = {};
  for (const p of PARTS_FORMAT.formatToParts(new Date(date))) out[p.type] = p.value;
  return {
    year: Number(out['year']),
    month: Number(out['month']),
    day: Number(out['day']),
    hour: Number(out['hour']),
    minute: Number(out['minute']),
    weekday: WEEKDAYS.indexOf(out['weekday']),
  };
}

/** The instant (epoch ms) at which the Pacific wall clock reads 00:00 on the given calendar day.
 * Month/day may overflow (e.g. day 0 or -3) — they are normalised like `Date.UTC`. */
export function pacificStartOfDay(year: number, month: number, day: number): number {
  const wall = Date.UTC(year, month - 1, day);
  let guess = wall;
  for (let i = 0; i < 2; i++) {
    const p = pacificParts(guess);
    const seen = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    guess += wall - seen;
  }
  return guess;
}

/** Midnight (Pacific) at the start of today. */
export function pacificToday(now: Date = new Date()): number {
  const p = pacificParts(now);
  return pacificStartOfDay(p.year, p.month, p.day);
}

/** Midnight (Pacific) of the Monday that starts the current week. */
export function pacificWeekStart(now: Date = new Date()): number {
  const p = pacificParts(now);
  return pacificStartOfDay(p.year, p.month, p.day - ((p.weekday + 6) % 7));
}

/** yyyy-MM-dd of an instant, read in Pacific time. */
export function pacificIsoDate(date: Date | string | number = new Date()): string {
  const p = pacificParts(date);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** A date-only value (a DOB, a draft date) is stored as UTC midnight. Showing it in Pacific time
 * would slip it back a day, so those are read as plain calendar dates instead. */
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}(T00:00:00(\.0+)?Z?)?$/;

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** US numeric date, "03/09/2026". */
export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  if (DATE_ONLY.test(dateStr)) return `${dateStr.slice(5, 7)}/${dateStr.slice(8, 10)}/${dateStr.slice(0, 4)}`;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '—';
  const p = pacificParts(d);
  return `${pad(p.month)}/${pad(p.day)}/${p.year}`;
}

/** Submitted/updated stamps show the actual US date rather than a relative "5d ago". */
export function timeAgo(dateStr: string | null | undefined): string {
  return formatDate(dateStr);
}

/** "03/09/2026, 02:30 PM PST" — Pacific time. */
export function formatDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '—';
  return `${formatDate(dateStr)}, ${formatTime(d)}`;
}

/** "2:30 PM PST" — Pacific time, with the zone label so PST vs PDT is never ambiguous. */
export function formatTime(date: Date | string | number): string {
  return new Date(date).toLocaleTimeString('en-US', {
    timeZone: APP_TIME_ZONE,
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

/** ISO date for a date input's value. */
export function toDateInput(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  if (DATE_ONLY.test(dateStr)) return dateStr.slice(0, 10);
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? '' : pacificIsoDate(d);
}

/** Today (Pacific) in the yyyy-MM-dd shape a date field's min/max expects. */
export function todayDateInput(): string {
  return pacificIsoDate();
}

/** Strips non-digit characters and caps length as you type — for SSN/routing/account/card
 * inputs where the server enforces an exact digit count; this just stops garbage before
 * it gets there (a plain text input has no digit-count limit on its own). */
export function sanitizeDigits(value: string, maxLength: number): string {
  return value.replace(/\D/g, '').slice(0, maxLength);
}

/** Formats free-typed digits into MM/YY as the user types (e.g. "1225" -> "12/25"). */
export function formatCardExpiry(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}/${digits.slice(2)}`;
}

/** Whole years between a date of birth and today (Pacific) — undefined if the dob is missing/invalid. */
export function calculateAge(dob: string | null | undefined): number | undefined {
  if (!dob) return undefined;
  const iso = toDateInput(dob);
  if (!iso) return undefined;
  const [by, bm, bd] = iso.split('-').map(Number);
  const today = pacificParts();
  let age = today.year - by;
  if (today.month < bm || (today.month === bm && today.day < bd)) age--;
  return age >= 0 ? age : undefined;
}

export function getInitials(name: string | null | undefined): string {
  if (!name) return '?';
  return name
    .split(' ')
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

/** Deterministic accent per id, so the same person keeps the same swatch across pages. */
const AVATAR_TONES = ['tone-a', 'tone-b', 'tone-c', 'tone-d', 'tone-e', 'tone-f'];

export function getAvatarTone(id: string | null | undefined): string {
  if (!id) return AVATAR_TONES[0];
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_TONES[Math.abs(hash) % AVATAR_TONES.length];
}

/** Whole dollars — this project stores money as integer dollars, not cents. */
export function formatMoney(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return '—';
  return `$${amount.toLocaleString('en-US')}`;
}

/** Whole PKR — local bookkeeping currency for the Expenses page, separate from the USD
 * lead-cost fields elsewhere. */
export function formatPkr(amount: number | null | undefined): string {
  if (amount === null || amount === undefined) return '—';
  return `PKR ${amount.toLocaleString('en-US')}`;
}

/** LEAVE_MONEY → "Leave money", SELF_EMPLOYED → "Self employed" */
export function humanizeEnum(value: string | null | undefined): string {
  if (!value) return '—';
  const lower = value.replace(/_/g, ' ').toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/** Formats digits as "555-234-567" while typing; capped at `maxDigits` (9, or 10 for Retention). */
export function formatPhoneInput(value: string, maxDigits = 9): string {
  const digits = value.replace(/\D/g, '').slice(0, maxDigits);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
}

/** Same rule the server enforces: exactly 9 digits — or 10 for Retention (`maxDigits` = 10, 9 still accepted). */
export function isValidUsPhone(value: string | null | undefined, maxDigits = 9): boolean {
  const len = (value ?? '').replace(/\D/g, '').length;
  return len === 9 || (maxDigits === 10 && len === 10);
}

/** Zipcode: exactly 5 digits. */
export function isValidZip(value: string | null | undefined): boolean {
  return /^\d{5}$/.test((value ?? '').trim());
}

export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return '—';
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 9 || digits.length === 10) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  return phone;
}

export function formatBool(value: boolean | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return value ? 'Yes' : 'No';
}

/** Display-side masking for sensitive values. The API is the real boundary — this is defence in depth. */
export function maskSsn(ssn: string | null | undefined): string {
  if (!ssn) return '—';
  const digits = ssn.replace(/\D/g, '');
  if (digits.length < 4) return '•••-••-••••';
  return `•••-••-${digits.slice(-4)}`;
}

export function maskAccount(value: string | null | undefined): string {
  if (!value) return '—';
  if (value.length <= 4) return '••••';
  return `••••${value.slice(-4)}`;
}

/** "1 closer" / "3 closers" — pass an already-pluralized noun as `plural` for irregular cases. */
export function pluralize(count: number, singular: string, plural: string = `${singular}s`): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? singular : plural}`;
}

/** "842 B" / "3.1 KB" / "4.2 MB" — one decimal place above the smallest unit. */
export function formatFileSize(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

export function orDash(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  return String(value);
}

/** True when the date falls on the current calendar day (Pacific). */
export function isToday(dateStr: string): boolean {
  const t = new Date(dateStr).getTime();
  const start = pacificToday();
  return t >= start && t < pacificStartOfDay(...ymd(start, 1));
}

/** True when the date falls within the current calendar week (Pacific, Sunday–Saturday). */
export function isThisWeek(dateStr: string): boolean {
  const t = new Date(dateStr).getTime();
  const now = pacificParts();
  const start = pacificStartOfDay(now.year, now.month, now.day - now.weekday);
  return t >= start && t < pacificStartOfDay(now.year, now.month, now.day - now.weekday + 7);
}

/** True when the date falls in the current calendar month (Pacific). */
export function isThisMonth(dateStr: string): boolean {
  const a = pacificParts(dateStr);
  const b = pacificParts();
  return a.month === b.month && a.year === b.year;
}

/** [year, month, day + offset] of an instant read in Pacific time. */
function ymd(instant: number, dayOffset: number): [number, number, number] {
  const p = pacificParts(instant);
  return [p.year, p.month, p.day + dayOffset];
}

/**
 * How a Junior Closer's submission reads from their side. A CPA lead is "Approved" once it has
 * reached the admin; a CPL lead skips the Closer, so it only counts as accepted when the
 * Client actually accepts it. A CPL still in flight shows as SUBMITTED.
 */
export function juniorOutcome(l: { status: string; leadType?: string }): 'ACCEPTED' | 'RETURNED_TO_JUNIOR' | 'PENDING' {
  if (l.status === 'RETURNED_TO_JUNIOR') return 'RETURNED_TO_JUNIOR';
  if (l.leadType === 'CPL') return l.status === 'ACCEPTED' ? 'ACCEPTED' : 'PENDING';
  return ['NEW', 'DRAFT'].includes(l.status) ? 'PENDING' : 'ACCEPTED';
}

/** % of QA-reviewed leads that passed; null until QA has reviewed at least one. */
export function qaPassRate(rows: { qaReviews?: { outcome: 'PASS' | 'FAIL' }[] }[]): number | null {
  const verdicts = rows.flatMap((l) => l.qaReviews ?? []);
  return verdicts.length ? Math.round((verdicts.filter((v) => v.outcome === 'PASS').length / verdicts.length) * 100) : null;
}
