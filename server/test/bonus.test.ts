import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/prisma', () => ({ default: {} }));

import { dailyBonus, dayKey, monthlyBonus, payoutDay, type BonusRules } from '../src/services/bonus.service';

const rules: BonusRules = {
  monthlyThreshold: 15, monthlyBase: 100_000,
  daily2: 1000, daily3: 4000, daily4: 6000, daily5: 10_000, daily6: 12_000,
  levelRate: 10_000, gradedRate: 5000, giRate: 2000,
};

const lead = (i: number, planType: 'LEVEL' | 'GRADED' | 'MODIFIED' | 'GI' | null) => ({ id: `l${String(i).padStart(2, '0')}`, submittedDay: '2026-10-05', planType });

describe('dailyBonus', () => {
  it('follows the tier table', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map((n) => dailyBonus(n, rules))).toEqual([0, 0, 1000, 4000, 6000, 10_000, 12_000]);
  });
  it('pays the top tier above 6', () => expect(dailyBonus(9, rules)).toBe(12_000));
});

describe('monthlyBonus', () => {
  it('matches the 22-lead example: 100k + 30k + 10k + 4k', () => {
    const leads = [
      ...Array.from({ length: 15 }, (_, i) => lead(i, 'LEVEL')),
      ...[15, 16, 17].map((i) => lead(i, 'LEVEL')),
      ...[18, 19].map((i) => lead(i, 'GRADED')),
      ...[20, 21].map((i) => lead(i, 'GI')),
    ];
    const r = monthlyBonus(leads, rules);
    expect(r.extra).toEqual({ level: 3, gradedModified: 2, gi: 2, unclassified: 0 });
    expect(r.total).toBe(144_000);
  });
  it('pays nothing below the threshold', () => {
    const r = monthlyBonus(Array.from({ length: 14 }, (_, i) => lead(i, 'LEVEL')), rules);
    expect(r).toMatchObject({ qualified: false, total: 0 });
  });
  it('pays base only at exactly the threshold', () => {
    expect(monthlyBonus(Array.from({ length: 15 }, (_, i) => lead(i, 'GI')), rules).total).toBe(100_000);
  });
  it('treats Modified like Graded and flags leads with no plan', () => {
    const leads = [...Array.from({ length: 15 }, (_, i) => lead(i, 'LEVEL')), lead(15, 'MODIFIED'), lead(16, null)];
    const r = monthlyBonus(leads, rules);
    expect(r.extra).toMatchObject({ gradedModified: 1, unclassified: 1 });
    expect(r.extraAmount).toBe(5000);
  });
  it('decides which leads are past the threshold by submission day', () => {
    const early = Array.from({ length: 15 }, (_, i) => ({ id: `e${i}`, submittedDay: '2026-10-01', planType: 'LEVEL' as const }));
    const r = monthlyBonus([{ id: 'a', submittedDay: '2026-10-20', planType: 'GI' }, ...early], rules);
    expect(r.extra.gi).toBe(1);
  });
});

describe('payoutDay', () => {
  it('pays Mon–Fri of a week on the next week’s Thursday', () => {
    // Mon 2026-10-12 … Fri 2026-10-16 → Thu 2026-10-22
    for (const d of ['2026-10-12', '2026-10-14', '2026-10-16']) expect(payoutDay(d)).toBe('2026-10-22');
  });
  it('keeps weekend submissions with their own week', () => {
    expect(payoutDay('2026-10-17')).toBe('2026-10-22');
    expect(payoutDay('2026-10-18')).toBe('2026-10-22');
    expect(payoutDay('2026-10-19')).toBe('2026-10-29');
  });
});

describe('dayKey', () => {
  it('uses the business time zone, not UTC', () => {
    expect(dayKey(new Date('2026-10-17T03:00:00Z'))).toBe('2026-10-16');
  });
});
