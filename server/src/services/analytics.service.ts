import type { Prisma, PlanType, Role } from '@prisma/client';
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

async function perUserOutcome(
  role: 'JUNIOR_CLOSER' | 'CLOSER' | 'RETENTION',
  groupField: 'juniorCloserId' | 'closerId' | 'retentionId',
  range?: { from: Date; to: Date }
) {
  const users = await prisma.user.findMany({ where: { role }, select: { id: true, name: true, email: true } });
  const grouped = await prisma.lead.groupBy({
    by: [groupField, 'status', 'leadType'],
    where: range ? { createdAt: { gte: range.from, lt: range.to } } : undefined,
    _count: { _all: true },
  });

  return users.map((user) => {
    const rows = grouped.filter((g) => (g as Record<string, unknown>)[groupField] === user.id);
    const total = rows.reduce((sum, r) => sum + r._count._all, 0);
    const count = (statuses: string[], leadType?: string) =>
      rows
        .filter((r) => statuses.includes(r.status) && (!leadType || r.leadType === leadType))
        .reduce((sum, r) => sum + r._count._all, 0);
    // Junior Closers are judged on their own hand-off: a CPA lead counts as accepted once it
    // has reached the admin (past NEW, not sent back to them), but a CPL only once a Client
    // accepts it. Rejected = the admin sent it back for correction. Everyone else is judged
    // on the client's accept/reject.
    const cpaTotal = rows.filter((r) => r.leadType === 'CPA').reduce((sum, r) => sum + r._count._all, 0);
    const accepted =
      role === 'JUNIOR_CLOSER'
        ? cpaTotal - count(['NEW', 'DRAFT', 'RETURNED_TO_JUNIOR'], 'CPA') + count(['ACCEPTED'], 'CPL')
        : count(['ACCEPTED']);
    const rejected = role === 'JUNIOR_CLOSER' ? count(['RETURNED_TO_JUNIOR']) : count(['REJECTED']);
    return { id: user.id, name: user.name, email: user.email, total, accepted, rejected };
  });
}

/** Optional `range` limits the counts to leads created in [from, to). */
export function juniorCloserAnalytics(range?: { from: Date; to: Date }) {
  return perUserOutcome('JUNIOR_CLOSER', 'juniorCloserId', range);
}

/**
 * Drill-down for one Junior Closer: every lead they submitted (masked — no phone/SSN/bank),
 * the QA verdicts on their intake, the live-call issues flagged against them, and the team
 * baseline to compare against. The client derives the breakdowns (trend, states, closers,
 * outcomes) in memory from these rows, same convention as the QA reports. Null if the id
 * isn't a Junior Closer.
 */
export async function juniorCloserDetail(id: string) {
  const person = await prisma.user.findFirst({
    where: { id, role: 'JUNIOR_CLOSER' },
    select: { id: true, name: true, email: true, createdAt: true },
  });
  if (!person) return null;

  const [leads, reviews, callIssues, teamRows] = await Promise.all([
    prisma.lead.findMany({
      where: { juniorCloserId: id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        customerName: true,
        leadType: true,
        dCode: true,
        state: true,
        status: true,
        planType: true,
        paymentStatus: true,
        returnReason: true,
        createdAt: true,
        updatedAt: true,
        closer: { select: { id: true, name: true, email: true } },
        client: { select: { id: true, name: true } },
        externalClient: { select: { id: true, name: true } },
      },
    }),
    prisma.leadReview.findMany({
      where: { role: 'QA_JUNIOR_CLOSER', lead: { juniorCloserId: id } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        leadId: true,
        outcome: true,
        comment: true,
        createdAt: true,
        reviewer: { select: { id: true, name: true, email: true } },
        lead: { select: { customerName: true } },
      },
    }),
    prisma.callReview.findMany({
      where: { revieweeId: id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        comment: true,
        createdAt: true,
        reviewer: { select: { id: true, name: true, email: true } },
        lead: { select: { id: true, customerName: true } },
      },
    }),
    juniorCloserAnalytics(),
  ]);

  const teamTotal = teamRows.reduce((s, r) => s + r.total, 0);
  const teamAccepted = teamRows.reduce((s, r) => s + r.accepted, 0);
  const teamRejected = teamRows.reduce((s, r) => s + r.rejected, 0);
  const decided = teamAccepted + teamRejected;
  const ranked = [...teamRows].sort((a, b) => b.total - a.total);

  return {
    person,
    leads,
    reviews,
    callIssues,
    team: {
      people: teamRows.length,
      avgTotal: teamRows.length ? Math.round((teamTotal / teamRows.length) * 10) / 10 : 0,
      acceptRate: decided ? Math.round((teamAccepted / decided) * 100) : null,
      volumeRank: ranked.findIndex((r) => r.id === id) + 1,
    },
  };
}

export function closerAnalytics() {
  return perUserOutcome('CLOSER', 'closerId');
}

// retentionId is only ever set on a RETENTION-type lead (see schema.prisma), so grouping
// by it naturally scopes to just those leads — no extra leadType filter needed, same as
// juniorCloserId/closerId scope themselves to CPA/CPL leads by construction.
export function retentionAnalytics() {
  return perUserOutcome('RETENTION', 'retentionId');
}

// ─── QA reports ─────────────────────────────────────────────────
// The QA report pages need the rows behind the numbers (who failed, why, which lead, who
// reviewed it, when), so these return raw detail and the client aggregates in memory — same
// "client-side over a loaded array" convention as the list pages. Internal metrics only,
// derived from LeadReview/CallReview — never from Lead.status.

export type QaLane = 'junior' | 'closer';

const personSelect = { id: true, name: true, email: true } as const;

const leadSelect = {
  id: true,
  customerName: true,
  leadType: true,
  dCode: true,
  state: true,
  status: true,
  createdAt: true,
  juniorCloserId: true,
  juniorCloser: { select: personSelect },
  closer: { select: personSelect },
} as const;

/**
 * Transfer Report detail for one lane: every QA verdict on a Junior Closer's intake (or a
 * Closer's enrichment) with the lead summary, the leads still awaiting QA (same predicates
 * as the QA reviewers' own queues in lead.service.ts), and everyone in the role so people
 * with no activity still appear. Lead summary is masked — no phone/SSN/bank fields.
 */
export async function qaTransferDetail(lane: QaLane) {
  const role: Role = lane === 'junior' ? 'JUNIOR_CLOSER' : 'CLOSER';
  const qaRole: Role = lane === 'junior' ? 'QA_JUNIOR_CLOSER' : 'QA_CLOSER';

  const pendingWhere: Prisma.LeadWhereInput =
    lane === 'junior'
      ? { juniorCloserId: { not: null }, qaReviews: { none: { role: qaRole } } }
      : { closerId: { not: null }, status: { notIn: ['NEW', 'DRAFT'] }, qaReviews: { none: { role: qaRole } } };

  const [people, reviews, pending] = await Promise.all([
    prisma.user.findMany({ where: { role }, select: personSelect, orderBy: { name: 'asc' } }),
    prisma.leadReview.findMany({
      where: { role: qaRole },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        outcome: true,
        comment: true,
        createdAt: true,
        reviewer: { select: personSelect },
        lead: { select: leadSelect },
      },
    }),
    prisma.lead.findMany({ where: pendingWhere, select: leadSelect, orderBy: { createdAt: 'asc' } }),
  ]);

  return { people, reviews, pending };
}

/**
 * Live Call Report detail for one lane: every issue QA has flagged against a person in the
 * role — all of them, no cap. There is no "pass" side (CallReview only exists to log a
 * problem), so the metric is an issue count over time, not a rate.
 */
export async function callReviewDetail(lane: QaLane) {
  const role: Role = lane === 'junior' ? 'JUNIOR_CLOSER' : 'CLOSER';
  const [people, issues] = await Promise.all([
    prisma.user.findMany({ where: { role }, select: personSelect, orderBy: { name: 'asc' } }),
    prisma.callReview.findMany({
      where: { reviewee: { role } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        comment: true,
        createdAt: true,
        reviewee: { select: personSelect },
        reviewer: { select: personSelect },
        lead: { select: leadSelect },
      },
    }),
  ]);
  return { people, issues };
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
  const [totalLeads, byStatus, closedCount, unpaidAcceptedCount, staffCounts, leads, chargeBacks] = await Promise.all([
    prisma.lead.count(),
    prisma.lead.groupBy({ by: ['status'], _count: { _all: true } }),
    prisma.lead.count({ where: { paymentStatus: 'PAID' } }),
    prisma.lead.count({ where: { status: 'ACCEPTED', paymentStatus: 'UNPAID' } }),
    prisma.user.groupBy({ by: ['role'], _count: { _all: true } }),
    // One light row per lead — status, source, payment and dates only, no customer fields —
    // so the page can slice by period and source in memory (same approach as the QA reports).
    prisma.lead.findMany({ select: { status: true, leadType: true, paymentStatus: true, createdAt: true } }),
    // The ChargeBack table is the audit trail: a charged-back lead's status moves on once it's
    // reassigned, so counting CHARGED_BACK statuses would undercount.
    prisma.chargeBack.findMany({ select: { createdAt: true, lead: { select: { leadType: true } } } }),
  ]);

  const statusCounts = Object.fromEntries(byStatus.map((s) => [s.status, s._count._all]));
  const roleCounts = Object.fromEntries(staffCounts.map((s) => [s.role, s._count._all]));

  return {
    totalLeads,
    statusCounts,
    closedCount,
    unpaidAcceptedCount,
    roleCounts,
    leads,
    chargeBacks: chargeBacks.map((c) => ({ createdAt: c.createdAt, leadType: c.lead.leadType })),
  };
}

// ─── Charge-backs ───────────────────────────────────────────────
// Breaks chargeback events down by client (who caused it) and by closer (whose sale got
// clawed back) — the ChargeBack table is the audit trail, since Lead.clientId gets
// cleared and reassigned once a chargeback happens (see lead.service#markLeadChargedBack).
export async function chargeBackAnalytics(viewer: 'ADMIN' | 'MANAGER' | 'RETENTION_MANAGER') {
  const chargeBacks = await prisma.chargeBack.findMany({
    // RETENTION_MANAGER only ever sees charge-backs on RETENTION leads.
    where: viewer === 'RETENTION_MANAGER' ? { lead: { leadType: 'RETENTION' } } : undefined,
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
          phone: true,
          state: true,
          planType: true,
          status: true,
          closer: { select: { id: true, name: true, email: true } },
          juniorCloser: { select: { id: true, name: true, email: true } },
          // Who holds the lead now — only set once an admin has reassigned it.
          client: { select: { id: true, name: true } },
          externalClient: { select: { id: true, name: true } },
          // Latest note + count, for the at-a-glance cell on the Charge Backs page.
          notes: {
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { id: true, body: true, createdAt: true, author: { select: { id: true, name: true } } },
          },
          _count: { select: { notes: true } },
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

  const result = {
    total: chargeBacks.length,
    totalPkrAmount: chargeBacks.reduce((sum, cb) => sum + cb.pkrAmount, 0),
    byClient: sortDesc([...byClient.values()]),
    byCloser: sortDesc([...byCloser.values()]),
    recent: chargeBacks.map((cb) => ({
      id: cb.id,
      leadId: cb.leadId,
      customerName: cb.lead.customerName,
      phone: cb.lead.phone,
      state: cb.lead.state,
      planType: cb.lead.planType,
      juniorCloser: cb.lead.juniorCloser,
      // Null while the lead is still waiting for a new client.
      reassignedTo: cb.lead.client?.name ?? cb.lead.externalClient?.name ?? null,
      // CHARGED_BACK = still awaiting reassignment; anything else was reassigned since.
      awaitingReassignment: cb.lead.status === 'CHARGED_BACK',
      // Where the lead sits today — a charge-back row is kept forever, even after the lead
      // is sent back for correction or reassigned, so the page can show what became of it.
      leadStatus: cb.lead.status,
      notes: cb.lead.notes,
      _count: cb.lead._count,
      client: cb.client,
      closer: cb.lead.closer,
      pkrAmount: cb.pkrAmount,
      reason: cb.reason,
      createdAt: cb.createdAt,
    })),
  };
  if (viewer === 'ADMIN') return result;

  // PKR amounts are ADMIN-only — MANAGER gets counts, parties and reasons, never money.
  const { totalPkrAmount: _total, ...rest } = result;
  return {
    ...rest,
    byClient: rest.byClient.map(({ pkrAmount: _p, ...b }) => b),
    byCloser: rest.byCloser.map(({ pkrAmount: _p, ...b }) => b),
    recent: rest.recent.map(({ pkrAmount: _p, ...r }) => r),
  };
}
