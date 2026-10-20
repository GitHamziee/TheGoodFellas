import { APP_TIME_ZONE, pacificParts, pacificStartOfDay, pacificToday, pacificWeekStart } from '../../core/format-utils';

/** Pure helpers shared by the Transfer and Live Call reports — date ranges, weekly buckets, tallies. */

export type RangeKey = '' | 'day' | 'week' | 'month';

export const RANGE_PILLS: { label: string; value: RangeKey }[] = [
  { label: 'All time', value: '' },
  { label: 'Today', value: 'day' },
  { label: 'This week', value: 'week' },
  { label: 'This month', value: 'month' },
];

const DAY = 86400000;

/** Start of a Pacific calendar day, from a yyyy-MM-dd string. */
function pacificDayStart(iso: string): number {
  const [y, m, d] = iso.split('-').map(Number);
  return pacificStartOfDay(y, m, d);
}

/** True when `dateStr` falls in the quick-pill range, or in [from, to] when custom dates are set.
 * All day boundaries are Pacific time. */
export function inRange(dateStr: string, range: RangeKey, from: string, to: string): boolean {
  const t = new Date(dateStr).getTime();
  if (from || to) {
    if (from && t < pacificDayStart(from)) return false;
    if (to) {
      const [y, m, d] = to.split('-').map(Number);
      if (t >= pacificStartOfDay(y, m, d + 1)) return false;
    }
    return true;
  }
  if (!range) return true;
  if (range === 'day') return t >= pacificToday();
  if (range === 'week') return t >= pacificWeekStart();
  const now = pacificParts();
  return t >= pacificStartOfDay(now.year, now.month, 1);
}

export interface WeekBucket {
  /** Epoch ms of Monday 00:00 Pacific. */
  start: number;
  label: string;
}

/** The last `n` Monday-start weeks (Pacific), oldest first, ending with the current week. */
export function lastWeeks(n: number): WeekBucket[] {
  const current = pacificParts(pacificWeekStart());
  return Array.from({ length: n }, (_, i) => {
    const start = pacificStartOfDay(current.year, current.month, current.day - 7 * (n - 1 - i));
    const label = new Date(start).toLocaleDateString('en-US', { timeZone: APP_TIME_ZONE, month: 'short', day: 'numeric' });
    return { start, label };
  });
}

/** Index of the bucket a date falls in, or -1 when it predates the first bucket. */
export function bucketIndex(dateStr: string, weeks: WeekBucket[]): number {
  const t = new Date(dateStr).getTime();
  for (let i = weeks.length - 1; i >= 0; i--) {
    if (t >= weeks[i].start) return i === weeks.length - 1 || t < weeks[i + 1].start ? i : -1;
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
