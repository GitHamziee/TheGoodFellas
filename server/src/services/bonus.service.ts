import prisma from '../lib/prisma';
import type { Role } from '@prisma/client';
import type { ServiceResult } from '../lib/service-result';

/** Roles with bonus rules wired up. Other roles get added here (and their own BonusConfig row). */
export const BONUS_ROLES = ['RETENTION'] as const;
type BonusRole = (typeof BONUS_ROLES)[number];

/** Same calendar the rest of the app uses for "which day is it" (client APP_TIME_ZONE). */
const BONUS_TIME_ZONE = 'America/Los_Angeles';

export type BonusRules = {
  monthlyThreshold: number;
  monthlyBase: number;
  daily2: number;
  daily3: number;
  daily4: number;
  daily5: number;
  daily6: number;
  levelRate: number;
  gradedRate: number;
  giRate: number;
};

const RULE_KEYS: (keyof BonusRules)[] = [
  'monthlyThreshold', 'monthlyBase', 'daily2', 'daily3', 'daily4', 'daily5', 'daily6', 'levelRate', 'gradedRate', 'giRate',
];

type PlanType = 'LEVEL' | 'GRADED' | 'MODIFIED' | 'GI' | null;
export type ApprovedLead = { id: string; submittedDay: string; planType: PlanType };

const RULE_SELECT = Object.fromEntries(RULE_KEYS.map((k) => [k, true])) as Record<keyof BonusRules, true>;

/** Calendar day (yyyy-mm-dd) an instant falls on in the business time zone. */
export function dayKey(at: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: BONUS_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

function utcMs(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/** The Thursday bonuses for `day` are paid: weeks run Monday–Sunday, paid the Thursday of the
 * following week (Monday + 10 days). Weekend submissions belong to the week they fall in. */
export function payoutDay(day: string): string {
  const ms = utcMs(day);
  const sinceMonday = (new Date(ms).getUTCDay() + 6) % 7;
  return new Date(ms - sinceMonday * 86_400_000 + 10 * 86_400_000).toISOString().slice(0, 10);
}

/** Daily tier for N approvals submitted on one day: <2 pays nothing, >6 pays the top tier. */
export function dailyBonus(count: number, rules: BonusRules): number {
  if (count >= 6) return rules.daily6;
  if (count === 5) return rules.daily5;
  if (count === 4) return rules.daily4;
  if (count === 3) return rules.daily3;
  if (count === 2) return rules.daily2;
  return 0;
}

export type MonthlyBonus = {
  count: number;
  qualified: boolean;
  base: number;
  extra: { level: number; gradedModified: number; gi: number; unclassified: number };
  extraAmount: number;
  total: number;
};

/** Monthly bonus: base once `count` reaches the threshold, then a per-plan rate for every
 * lead beyond it. Leads are ordered by submission day (then id) so "past the threshold" is
 * deterministic. A lead past the threshold with no plan type pays nothing and is reported. */
export function monthlyBonus(leads: ApprovedLead[], rules: BonusRules): MonthlyBonus {
  const sorted = [...leads].sort((a, b) => a.submittedDay.localeCompare(b.submittedDay) || a.id.localeCompare(b.id));
  const extra = { level: 0, gradedModified: 0, gi: 0, unclassified: 0 };
  for (const lead of sorted.slice(rules.monthlyThreshold)) {
    if (lead.planType === 'LEVEL') extra.level += 1;
    else if (lead.planType === 'GRADED' || lead.planType === 'MODIFIED') extra.gradedModified += 1;
    else if (lead.planType === 'GI') extra.gi += 1;
    else extra.unclassified += 1;
  }
  const qualified = sorted.length >= rules.monthlyThreshold;
  const base = qualified ? rules.monthlyBase : 0;
  const extraAmount = extra.level * rules.levelRate + extra.gradedModified * rules.gradedRate + extra.gi * rules.giRate;
  return { count: sorted.length, qualified, base, extra, extraAmount, total: base + extraAmount };
}

export async function getRules(role: BonusRole): Promise<BonusRules> {
  const row = await prisma.bonusConfig.findUnique({ where: { role }, select: RULE_SELECT });
  if (row) return row;
  return prisma.bonusConfig.create({ data: { role }, select: RULE_SELECT });
}

export async function updateRules(role: unknown, input: Record<string, unknown>): Promise<ServiceResult<{ rules: BonusRules }>> {
  if (!(BONUS_ROLES as readonly unknown[]).includes(role)) return { error: 'Bonuses are not available for that role yet', status: 400 };
  const data: Partial<BonusRules> = {};
  for (const key of RULE_KEYS) {
    const value = input[key];
    if (value === undefined) continue;
    const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
    if (!Number.isInteger(n) || n < 0) return { error: `${key} must be a whole number, 0 or more`, status: 400 };
    if (key === 'monthlyThreshold' && n < 1) return { error: 'monthlyThreshold must be at least 1', status: 400 };
    data[key] = n;
  }
  const rules = await prisma.bonusConfig.upsert({
    where: { role: role as Role },
    create: { role: role as Role, ...data },
    update: data,
    select: RULE_SELECT,
  });
  return { data: { rules } };
}

export type BonusDayRow = { day: string; count: number; bonus: number; payoutDay: string };
export type BonusPersonRow = {
  userId: string;
  name: string;
  days: BonusDayRow[];
  dailyTotal: number;
  monthly: MonthlyBonus;
  total: number;
};

/** Per-person bonus report for one month (`yyyy-mm`, by submission day). Counts RETENTION
 * leads currently labelled Approval Confirmed, credited to the day they were submitted — not
 * the day the label was set, since approval lags submission by several days. */
export async function monthReport(role: BonusRole, month: unknown, onlyUserId?: string): Promise<ServiceResult<{ month: string; rules: BonusRules; people: BonusPersonRow[] }>> {
  if (typeof month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return { error: 'month must be yyyy-mm', status: 400 };
  const [y, m] = month.split('-').map(Number);
  // Pad a day each side so time-zone offsets can't drop a boundary lead; filtered by dayKey below.
  const from = new Date(Date.UTC(y, m - 1, 1) - 86_400_000);
  const to = new Date(Date.UTC(y, m, 1) + 86_400_000);

  const rules = await getRules(role);
  const leads = await prisma.lead.findMany({
    where: {
      leadType: 'RETENTION',
      adminStatus: 'APPROVAL_CONFIRMED',
      retentionId: onlyUserId ?? { not: null },
      OR: [
        { submittedAt: { gte: from, lt: to } },
        { submittedAt: null, createdAt: { gte: from, lt: to } },
      ],
    },
    select: { id: true, retentionId: true, planType: true, submittedAt: true, createdAt: true, retention: { select: { name: true } } },
  });

  const byPerson = new Map<string, { name: string; leads: ApprovedLead[] }>();
  for (const l of leads) {
    const submittedDay = dayKey(l.submittedAt ?? l.createdAt);
    if (!submittedDay.startsWith(month)) continue;
    const entry = byPerson.get(l.retentionId!) ?? { name: l.retention?.name ?? 'Unknown', leads: [] };
    entry.leads.push({ id: l.id, submittedDay, planType: l.planType });
    byPerson.set(l.retentionId!, entry);
  }

  const people: BonusPersonRow[] = [...byPerson.entries()].map(([userId, { name, leads: approved }]) => {
    const perDay = new Map<string, number>();
    for (const l of approved) perDay.set(l.submittedDay, (perDay.get(l.submittedDay) ?? 0) + 1);
    const days = [...perDay.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([day, count]) => ({ day, count, bonus: dailyBonus(count, rules), payoutDay: payoutDay(day) }));
    const dailyTotal = days.reduce((sum, d) => sum + d.bonus, 0);
    const monthly = monthlyBonus(approved, rules);
    return { userId, name, days, dailyTotal, monthly, total: dailyTotal + monthly.total };
  });
  people.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));

  return { data: { month, rules, people } };
}

/** One person's own bonus for a month — the same figures the admin report shows for them, never
 * anyone else's. A person with no approvals gets an all-zero row rather than an empty result. */
export async function myReport(userId: string, name: string, month: unknown): Promise<ServiceResult<{ month: string; rules: BonusRules; me: BonusPersonRow }>> {
  const result = await monthReport('RETENTION', month, userId);
  if ('error' in result) return result;
  const { rules, people } = result.data;
  const me = people[0] ?? { userId, name, days: [], dailyTotal: 0, monthly: monthlyBonus([], rules), total: 0 };
  return { data: { month: result.data.month, rules, me } };
}
