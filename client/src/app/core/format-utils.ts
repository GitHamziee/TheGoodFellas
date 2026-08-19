/** Shared display formatting. Mirrors R4Referral's lib/format-utils.ts conventions. */

/** "Today" / "Yesterday" / "5d ago" / "3mo ago" / "2y ago" */
export function timeAgo(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

/** "Mar 9, 2026" */
export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/** "Mar 9, 2026, 02:30 PM" */
export function formatDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** ISO date for a date input's value. */
export function toDateInput(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
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

export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return '—';
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
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

export function orDash(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  return String(value);
}

/** True when the date falls on the current calendar day. */
export function isToday(dateStr: string): boolean {
  const d = new Date(dateStr);
  const now = new Date();
  return (
    d.getDate() === now.getDate() &&
    d.getMonth() === now.getMonth() &&
    d.getFullYear() === now.getFullYear()
  );
}

/** True when the date falls within the current calendar week (Sunday–Saturday). */
export function isThisWeek(dateStr: string): boolean {
  const d = new Date(dateStr);
  const now = new Date();
  const startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay());
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 7);
  return d >= startOfWeek && d < endOfWeek;
}

/** True when the date falls in the current calendar month. */
export function isThisMonth(dateStr: string): boolean {
  const d = new Date(dateStr);
  const now = new Date();
  return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
}
