/** Pure helpers shared by the Transfer and Live Call reports — date ranges, weekly buckets, tallies. */

export type RangeKey = '' | 'day' | 'week' | 'month';

export const RANGE_PILLS: { label: string; value: RangeKey }[] = [
  { label: 'All time', value: '' },
  { label: 'Today', value: 'day' },
  { label: 'This week', value: 'week' },
  { label: 'This month', value: 'month' },
];

const DAY = 86400000;

/** Local midnight of the Monday that starts the week containing `d`. */
export function weekStart(d: Date): Date {
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return start;
}

/** True when `dateStr` falls in the quick-pill range, or in [from, to] when custom dates are set. */
export function inRange(dateStr: string, range: RangeKey, from: string, to: string): boolean {
  const t = new Date(dateStr).getTime();
  if (from || to) {
    if (from && t < new Date(from + 'T00:00:00').getTime()) return false;
    if (to && t >= new Date(to + 'T00:00:00').getTime() + DAY) return false;
    return true;
  }
  if (!range) return true;
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (range === 'day') return t >= startOfToday;
  if (range === 'week') return t >= weekStart(now).getTime();
  return t >= new Date(now.getFullYear(), now.getMonth(), 1).getTime();
}

export interface WeekBucket {
  start: Date;
  label: string;
}

/** The last `n` Monday-start weeks, oldest first, ending with the current week. */
export function lastWeeks(n: number): WeekBucket[] {
  const current = weekStart(new Date());
  return Array.from({ length: n }, (_, i) => {
    const start = new Date(current);
    start.setDate(start.getDate() - 7 * (n - 1 - i));
    return { start, label: start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) };
  });
}

/** Index of the bucket a date falls in, or -1 when it predates the first bucket. */
export function bucketIndex(dateStr: string, weeks: WeekBucket[]): number {
  const t = new Date(dateStr).getTime();
  for (let i = weeks.length - 1; i >= 0; i--) {
    if (t >= weeks[i].start.getTime()) return t < weeks[i].start.getTime() + 7 * DAY ? i : -1;
  }
  return -1;
}

export function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Whole-percent pass rate, or null when nothing was reviewed. */
export function passRate(pass: number, fail: number): number | null {
  const n = pass + fail;
  return n === 0 ? null : Math.round((pass / n) * 100);
}

export function daysBetween(fromIso: string, toIso: string): number {
  return (new Date(toIso).getTime() - new Date(fromIso).getTime()) / DAY;
}

export function daysSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / DAY));
}

/** Most frequent comments (case/space-normalised), most common first. */
export function topReasons(comments: (string | null | undefined)[], limit = 8): { text: string; count: number }[] {
  const counts = new Map<string, { text: string; count: number }>();
  for (const c of comments) {
    const text = (c ?? '').trim().replace(/\s+/g, ' ');
    if (!text) continue;
    const key = text.toLowerCase();
    const entry = counts.get(key) ?? { text, count: 0 };
    entry.count += 1;
    counts.set(key, entry);
  }
  return [...counts.values()].sort((a, b) => b.count - a.count).slice(0, limit);
}
