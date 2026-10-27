import { beforeEach, describe, expect, it, vi } from 'vitest';

const prisma = vi.hoisted(() => ({
  lead: { findMany: vi.fn(), findFirst: vi.fn() },
  user: { findMany: vi.fn() },
}));
vi.mock('../src/lib/prisma', () => ({ default: prisma }));

import { getRetentionHistory, listRetentionHistory, wholeMonthsBetween } from '../src/services/retention-history.service';

const d = (iso: string) => new Date(iso);

const baseLead = {
  id: 'l1',
  customerName: 'Jane Doe',
  status: 'ACCEPTED',
  paymentStatus: 'PAID',
  createdAt: d('2025-01-05T00:00:00Z'),
  closer: null,
  retention: { name: 'Rita' },
  incomePayment: null,
  chargeBacks: [],
  events: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  prisma.user.findMany.mockResolvedValue([
    { id: 'u-rita', name: 'Rita' },
    { id: 'u-sam', name: 'Sam' },
    { id: 'u-admin', name: 'Ada' },
  ]);
});

describe('wholeMonthsBetween', () => {
  it('counts completed calendar months only', () => {
    expect(wholeMonthsBetween(d('2025-01-15T00:00:00Z'), d('2025-04-14T00:00:00Z'))).toBe(2);
    expect(wholeMonthsBetween(d('2025-01-15T00:00:00Z'), d('2025-04-15T00:00:00Z'))).toBe(3);
    expect(wholeMonthsBetween(d('2025-04-15T00:00:00Z'), d('2025-01-15T00:00:00Z'))).toBe(0);
  });
});

describe('listRetentionHistory', () => {
  it('derives time on book, charge-back, reassignment and who retained it', async () => {
    prisma.lead.findMany.mockResolvedValue([
      {
        ...baseLead,
        chargeBacks: [{ id: 'c1', createdAt: d('2025-06-10T00:00:00Z'), reason: 'NSF' }],
        events: [
          { type: 'CREATED', actorId: null, targetId: null, note: null, createdAt: d('2025-01-05T00:00:00Z') },
          { type: 'SUBMITTED', actorId: 'u-rita', targetId: null, note: null, createdAt: d('2025-01-06T00:00:00Z') },
          { type: 'PAID', actorId: 'u-admin', targetId: null, note: null, createdAt: d('2025-02-01T00:00:00Z') },
          { type: 'RETURNED_TO_RETENTION', actorId: 'u-admin', targetId: 'u-sam', note: 'redo', createdAt: d('2025-06-12T00:00:00Z') },
          { type: 'SUBMITTED', actorId: 'u-sam', targetId: null, note: null, createdAt: d('2025-06-14T00:00:00Z') },
        ],
      },
    ]);

    const [row] = await listRetentionHistory();
    expect(row).toMatchObject({
      state: 'RETAINED',
      closer: 'Rita',
      monthsOnBook: 4,
      chargeBackCount: 1,
      workedBy: ['Rita', 'Sam'],
      reassignedTo: 'Sam',
      retainedBy: 'Sam',
    });
  });

  it('falls back to Lead timestamps for a lead with no events', async () => {
    prisma.lead.findMany.mockResolvedValue([
      {
        ...baseLead,
        status: 'CHARGED_BACK',
        paymentStatus: 'UNPAID',
        incomePayment: { createdAt: d('2025-02-01T00:00:00Z') },
        chargeBacks: [{ id: 'c1', createdAt: d('2025-03-20T00:00:00Z'), reason: 'x' }],
      },
    ]);
    const [row] = await listRetentionHistory();
    expect(row).toMatchObject({ state: 'CHARGED_BACK', closer: 'Rita', monthsOnBook: 1, retainedBy: null, reassignedTo: null });
  });

  it('marks an unpaid lead pending and a paid, never-charged-back one active', async () => {
    prisma.lead.findMany.mockResolvedValue([
      { ...baseLead, id: 'a', status: 'SUBMITTED', paymentStatus: 'UNPAID' },
      { ...baseLead, id: 'b' },
    ]);
    const rows = await listRetentionHistory();
    expect(rows.map((r) => r.state)).toEqual(['PENDING', 'ACTIVE']);
    expect(rows[0].monthsOnBook).toBeNull();
  });
});

describe('getRetentionHistory', () => {
  it('404s for a missing or non-retention lead', async () => {
    prisma.lead.findFirst.mockResolvedValue(null);
    expect(await getRetentionHistory('nope')).toEqual({ error: 'Lead not found', status: 404 });
  });

  it('merges events and charge-backs into one ordered timeline, without any amount', async () => {
    prisma.lead.findFirst.mockResolvedValue({
      ...baseLead,
      incomePayment: { createdAt: d('2025-02-01T00:00:00Z') },
      chargeBacks: [{ id: 'c1', createdAt: d('2025-06-10T00:00:00Z'), reason: 'NSF' }],
      events: [{ type: 'ASSIGNED_TO_CLIENT', actorId: 'u-admin', targetId: null, note: 'Acme', createdAt: d('2025-01-20T00:00:00Z') }],
    });
    const result = await getRetentionHistory('l1');
    if ('error' in result) throw new Error(result.error);
    expect(result.data.timeline.map((t) => t.kind)).toEqual(['CREATED', 'ASSIGNED_TO_CLIENT', 'PAID', 'CHARGED_BACK']);
    expect(result.data.timeline[1]).toMatchObject({ actor: 'Ada', target: 'Acme' });
    expect(result.data.timeline[3].note).toBe('NSF');
    expect(JSON.stringify(result.data)).not.toMatch(/pkr/i);
  });
});
