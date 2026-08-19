import type { PlanType } from '@prisma/client';
import prisma from '../lib/prisma';

const PLAN_TYPES: PlanType[] = ['LEVEL', 'GRADED', 'MODIFIED', 'GI'];
const PLAN_COST_FIELD: Record<PlanType, 'levelCost' | 'gradedCost' | 'modifiedCost' | 'giCost'> = {
  LEVEL: 'levelCost',
  GRADED: 'gradedCost',
  MODIFIED: 'modifiedCost',
  GI: 'giCost',
};

// Metrics reflect CURRENT lead status only — there is no event/audit log yet, so a lead
// that was rejected once, reassigned, and later accepted only counts toward "accepted".
// See REQUIREMENTS.md for the known gap.

async function perUserOutcome(role: 'JUNIOR_CLOSER' | 'CLOSER', groupField: 'juniorCloserId' | 'closerId') {
  const users = await prisma.user.findMany({ where: { role }, select: { id: true, name: true, email: true } });
  const grouped = await prisma.lead.groupBy({
    by: [groupField, 'status'],
    _count: { _all: true },
  });

  return users.map((user) => {
    const rows = grouped.filter((g) => (g as any)[groupField] === user.id);
    const total = rows.reduce((sum, r) => sum + r._count._all, 0);
    const accepted = rows.find((r) => r.status === 'ACCEPTED')?._count._all ?? 0;
    const rejected = rows.find((r) => r.status === 'REJECTED')?._count._all ?? 0;
    return { id: user.id, name: user.name, email: user.email, total, accepted, rejected };
  });
}

export function juniorCloserAnalytics() {
  return perUserOutcome('JUNIOR_CLOSER', 'juniorCloserId');
}

export function closerAnalytics() {
  return perUserOutcome('CLOSER', 'closerId');
}

// ─── Sales by plan (Closer) ────────────────────────────────────
// "Sold" = ACCEPTED or ASSIGNED_EXTERNAL — a lead that made it to a paying destination,
// same population the accept/reject outcome analytics above already treat as decided.
// Revenue is *expected* revenue (count × the paying party's per-plan cost), not actual
// money received — IncomePayment records one PKR total per batch, not a per-lead
// breakdown, so it can't answer "how much did Level plans bring in." An ASSIGNED_EXTERNAL
// lead prices off its ExternalClient instead of a User client — the two are mutually
// exclusive per lead (clientId vs externalClientId), so only one of the two lookups below
// ever contributes for a given lead.
//
// `annualPremiumRevenue` is a separate figure carried alongside the per-plan revenue
// above — both are USD (whole dollars, see REQUIREMENTS.md and CLAUDE.md's currency-scope
// note: PKR is Expenses-page bookkeeping only). `annualPremiumRevenue` is
// `monthlyPremiums × 12` summed over the same sold population, not split by plan type —
// it's the closer's own enrichment figure, distinct from the client/external-client
// per-plan pricing the revenue above uses.
export async function closerPlanAnalytics() {
  const closers = await prisma.user.findMany({
    where: { role: 'CLOSER' },
    select: { id: true, name: true, email: true },
    orderBy: { name: 'asc' },
  });

  // Not filtered on planType — annualPremiumRevenue below must include every sold lead,
  // even ones the closer never picked a plan type for. Per-plan revenue is still only
  // bucketed for leads that do have a planType, guarded inside the loop.
  const leads = await prisma.lead.findMany({
    where: { status: { in: ['ACCEPTED', 'ASSIGNED_EXTERNAL'] } },
    select: {
      closerId: true,
      planType: true,
      monthlyPremiums: true,
      client: { select: { levelCost: true, gradedCost: true, modifiedCost: true, giCost: true } },
      externalClient: { select: { levelCost: true, gradedCost: true, modifiedCost: true, giCost: true } },
    },
  });

  const byCloser = new Map<string, Map<PlanType, { count: number; revenue: number }>>();
  const annualPremiumByCloser = new Map<string, number>();
  for (const lead of leads) {
    // A CPL lead never has a closer, so it never reaches here in practice — this guard
    // is just to satisfy closerId's now-nullable type.
    if (!lead.closerId) continue;

    if (lead.planType) {
      const planType = lead.planType as PlanType;
      const payer = lead.client ?? lead.externalClient;
      const perPlan = byCloser.get(lead.closerId) ?? new Map<PlanType, { count: number; revenue: number }>();
      const entry = perPlan.get(planType) ?? { count: 0, revenue: 0 };
      entry.count += 1;
      entry.revenue += payer?.[PLAN_COST_FIELD[planType]] ?? 0;
      perPlan.set(planType, entry);
      byCloser.set(lead.closerId, perPlan);
    }

    const annualPremium = (lead.monthlyPremiums ?? 0) * 12;
    annualPremiumByCloser.set(lead.closerId, (annualPremiumByCloser.get(lead.closerId) ?? 0) + annualPremium);
  }

  return closers.map((c) => {
    const perPlan = byCloser.get(c.id) ?? new Map<PlanType, { count: number; revenue: number }>();
    const plans = PLAN_TYPES.map((planType) => ({ planType, ...(perPlan.get(planType) ?? { count: 0, revenue: 0 }) }));
    return {
      id: c.id,
      name: c.name,
      email: c.email,
      plans,
      totalCount: plans.reduce((sum, p) => sum + p.count, 0),
      totalRevenue: plans.reduce((sum, p) => sum + p.revenue, 0),
      annualPremiumRevenue: annualPremiumByCloser.get(c.id) ?? 0,
    };
  });
}

// ─── Sales by plan (Client) ────────────────────────────────────
// Same "expected revenue" model as closerPlanAnalytics above, grouped by the client the
// lead landed on instead of the closer who enriched it. Narrower population than the
// closer version: ASSIGNED_EXTERNAL leads have no clientId (they went to an
// ExternalClient instead), so only ACCEPTED leads count here.
export async function clientPlanAnalytics() {
  const clients = await prisma.user.findMany({
    where: { role: 'CLIENT' },
    select: { id: true, name: true, email: true, levelCost: true, gradedCost: true, modifiedCost: true, giCost: true },
    orderBy: { name: 'asc' },
  });
  const costByClient = new Map(clients.map((c) => [c.id, c]));

  const leads = await prisma.lead.findMany({
    where: { status: 'ACCEPTED', clientId: { not: null }, planType: { not: null } },
    select: { clientId: true, planType: true },
  });

  const byClient = new Map<string, Map<PlanType, { count: number; revenue: number }>>();
  for (const lead of leads) {
    if (!lead.clientId) continue;
    const planType = lead.planType as PlanType;
    const client = costByClient.get(lead.clientId);
    const perPlan = byClient.get(lead.clientId) ?? new Map<PlanType, { count: number; revenue: number }>();
    const entry = perPlan.get(planType) ?? { count: 0, revenue: 0 };
    entry.count += 1;
    entry.revenue += client?.[PLAN_COST_FIELD[planType]] ?? 0;
    perPlan.set(planType, entry);
    byClient.set(lead.clientId, perPlan);
  }

  return clients.map((c) => {
    const perPlan = byClient.get(c.id) ?? new Map<PlanType, { count: number; revenue: number }>();
    const plans = PLAN_TYPES.map((planType) => ({ planType, ...(perPlan.get(planType) ?? { count: 0, revenue: 0 }) }));
    return {
      id: c.id,
      name: c.name,
      email: c.email,
      plans,
      totalCount: plans.reduce((sum, p) => sum + p.count, 0),
      totalRevenue: plans.reduce((sum, p) => sum + p.revenue, 0),
    };
  });
}

export async function overallAnalytics() {
  const [totalLeads, byStatus, closedCount, unpaidAcceptedCount, staffCounts] = await Promise.all([
    prisma.lead.count(),
    prisma.lead.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.lead.count({ where: { paymentStatus: 'PAID' } }),
    prisma.lead.count({ where: { status: 'ACCEPTED', paymentStatus: 'UNPAID' } }),
    prisma.user.groupBy({ by: ['role'], _count: { _all: true } }),
  ]);

  const statusCounts = Object.fromEntries(byStatus.map((s) => [s.status, s._count._all]));
  const roleCounts = Object.fromEntries(staffCounts.map((s) => [s.role, s._count._all]));

  return { totalLeads, statusCounts, closedCount, unpaidAcceptedCount, roleCounts };
}

// ─── Drafts ─────────────────────────────────────────────────────
// Counts/aging of parked (DRAFT) leads, per closer and per reason — helps admin spot
// drafts that have gone stale. Aging is measured off updatedAt (last time the closer
// touched it), not createdAt.
export async function draftsAnalytics() {
  // DRAFT is only reachable via saveLeadAsDraft, which requires a real closerId — a CPL
  // lead (closerId null) can never become DRAFT, so `closer` below is always non-null.
  const drafts = await prisma.lead.findMany({
    where: { status: 'DRAFT' },
    select: {
      id: true,
      customerName: true,
      draftReason: true,
      createdAt: true,
      updatedAt: true,
      closer: { select: { id: true, name: true, email: true } },
    },
    orderBy: { updatedAt: 'asc' },
  });

  const now = Date.now();
  const ageDays = (updatedAt: Date) => Math.floor((now - updatedAt.getTime()) / 86400000);

  const byCloser = new Map<string, { id: string; name: string; email: string; count: number }>();
  const byReason: Record<string, number> = {};
  for (const d of drafts) {
    // See the comment above — a DRAFT lead always has a closer, this is just the type guard.
    if (!d.closer) continue;
    const entry = byCloser.get(d.closer.id) ?? { id: d.closer.id, name: d.closer.name, email: d.closer.email, count: 0 };
    entry.count += 1;
    byCloser.set(d.closer.id, entry);
    if (d.draftReason) byReason[d.draftReason] = (byReason[d.draftReason] ?? 0) + 1;
  }

  const ages = drafts.map((d) => ageDays(d.updatedAt));

  return {
    total: drafts.length,
    oldestDays: ages.length ? Math.max(...ages) : 0,
    avgAgeDays: ages.length ? Math.round(ages.reduce((sum, n) => sum + n, 0) / ages.length) : 0,
    byCloser: Array.from(byCloser.values()).sort((a, b) => b.count - a.count),
    byReason,
    drafts: drafts.map((d) => ({
      id: d.id,
      customerName: d.customerName,
      draftReason: d.draftReason,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      ageDays: ageDays(d.updatedAt),
      // Guaranteed non-null per the comment at the top of this function.
      closer: { id: d.closer!.id, name: d.closer!.name },
    })),
  };
}

// ─── Charge-backs ───────────────────────────────────────────────
// Breaks chargeback events down by client (who caused it) and by closer (whose sale got
// clawed back) — the ChargeBack table is the audit trail, since Lead.clientId gets
// cleared and reassigned once a chargeback happens (see lead.service#markLeadChargedBack).
export async function chargeBackAnalytics() {
  const chargeBacks = await prisma.chargeBack.findMany({
    select: {
      id: true,
      leadId: true,
      pkrAmount: true,
      reason: true,
      createdAt: true,
      client: { select: { id: true, name: true, email: true } },
      lead: {
        select: {
          customerName: true,
          closer: { select: { id: true, name: true, email: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  type Bucket = { id: string; name: string; email: string; count: number; pkrAmount: number };
  const byClient = new Map<string, Bucket>();
  const byCloser = new Map<string, Bucket>();
  const bump = (map: Map<string, Bucket>, party: { id: string; name: string; email: string }, pkrAmount: number) => {
    const entry = map.get(party.id) ?? { id: party.id, name: party.name, email: party.email, count: 0, pkrAmount: 0 };
    entry.count += 1;
    entry.pkrAmount += pkrAmount;
    map.set(party.id, entry);
  };

  for (const cb of chargeBacks) {
    bump(byClient, cb.client, cb.pkrAmount);
    // A CPL lead can also be charged back (nothing in accept/pay/chargeback is CPA-only),
    // but has no closer to attribute it to — counts toward byClient, not byCloser, same
    // as an ASSIGNED_EXTERNAL lead contributing volume but not revenue elsewhere.
    if (cb.lead.closer) bump(byCloser, cb.lead.closer, cb.pkrAmount);
  }

  const sortDesc = (rows: Bucket[]) => rows.sort((a, b) => b.count - a.count);

  return {
    total: chargeBacks.length,
    totalPkrAmount: chargeBacks.reduce((sum, cb) => sum + cb.pkrAmount, 0),
    byClient: sortDesc([...byClient.values()]),
    byCloser: sortDesc([...byCloser.values()]),
    recent: chargeBacks.map((cb) => ({
      id: cb.id,
      leadId: cb.leadId,
      customerName: cb.lead.customerName,
      client: cb.client,
      closer: cb.lead.closer,
      pkrAmount: cb.pkrAmount,
      reason: cb.reason,
      createdAt: cb.createdAt,
    })),
  };
}
