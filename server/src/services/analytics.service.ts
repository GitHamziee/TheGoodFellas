import prisma from '../lib/prisma';

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
