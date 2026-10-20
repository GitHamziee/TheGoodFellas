import { beforeEach, describe, expect, it, vi } from 'vitest';

// lead.service talks to Prisma and fires notifications; both are replaced so these tests
// exercise only the service's own access-control and transaction logic.
const db = vi.hoisted(() => ({
  lead: { findUnique: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
  incomePayment: { create: vi.fn() },
  chargeBack: { create: vi.fn(), createMany: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock('../src/lib/prisma', () => ({ default: db, prisma: db }));
vi.mock('../src/services/notification.service', () => ({
  notifyUsers: vi.fn(async () => undefined),
  notifyRoles: vi.fn(async () => undefined),
}));

import { batchChargeBack, batchMarkPaid, getLeadById, markLeadChargedBack } from '../src/services/lead.service';

const FULL_LEAD = {
  id: 'lead-1',
  customerName: 'Jane Doe',
  phone: '555-234-567',
  ssn: '123-45-6789',
  status: 'NEW',
  leadType: 'CPA',
  juniorCloserId: 'junior-1',
  closerId: 'closer-1',
  clientId: 'client-1',
};

function selectOf(call: unknown[]): Record<string, unknown> {
  return (call[0] as { select: Record<string, unknown> }).select;
}

beforeEach(() => {
  vi.resetAllMocks();
  // Interactive transactions run against the same mocked client.
  db.$transaction.mockImplementation(async (fn: (tx: typeof db) => Promise<unknown>) => fn(db));
});

describe('getLeadById masking', () => {
  it('returns 404 for a missing lead', async () => {
    db.lead.findUnique.mockResolvedValueOnce(null);
    expect(await getLeadById('x', { id: 'a', role: 'ADMIN' })).toEqual({ error: 'Lead not found', status: 404 });
  });

  it('gives ADMIN the full lead from a single read', async () => {
    db.lead.findUnique.mockResolvedValueOnce(FULL_LEAD);
    expect(await getLeadById('lead-1', { id: 'a', role: 'ADMIN' })).toEqual({ data: { lead: FULL_LEAD } });
    expect(db.lead.findUnique).toHaveBeenCalledTimes(1);
  });

  it('forbids MANAGER from Junior-Closer leads', async () => {
    db.lead.findUnique.mockResolvedValueOnce(FULL_LEAD);
    expect(await getLeadById('lead-1', { id: 'm', role: 'MANAGER' })).toEqual({ error: 'Forbidden', status: 403 });
  });

  it('forbids a JUNIOR_CLOSER from someone else’s lead', async () => {
    db.lead.findUnique.mockResolvedValueOnce(FULL_LEAD);
    expect(await getLeadById('lead-1', { id: 'other', role: 'JUNIOR_CLOSER' })).toEqual({
      error: 'Forbidden',
      status: 403,
    });
  });

  it('masks a JUNIOR_CLOSER’s own lead — no phone, no SSN', async () => {
    db.lead.findUnique.mockResolvedValueOnce(FULL_LEAD).mockResolvedValueOnce({ id: 'lead-1' });
    await getLeadById('lead-1', { id: 'junior-1', role: 'JUNIOR_CLOSER' });
    const select = selectOf(db.lead.findUnique.mock.calls[1]);
    expect(select.customerName).toBe(true);
    expect(select).not.toHaveProperty('phone');
    expect(select).not.toHaveProperty('ssn');
  });

  it('shows a RETURNED_TO_JUNIOR lead’s intake fields but never closer-added ones', async () => {
    db.lead.findUnique
      .mockResolvedValueOnce({ ...FULL_LEAD, status: 'RETURNED_TO_JUNIOR' })
      .mockResolvedValueOnce({ id: 'lead-1' });
    await getLeadById('lead-1', { id: 'junior-1', role: 'JUNIOR_CLOSER' });
    const select = selectOf(db.lead.findUnique.mock.calls[1]);
    expect(select.phone).toBe(true);
    expect(select).not.toHaveProperty('ssn');
    expect(select).not.toHaveProperty('routingNumber');
  });

  it('gives a CLOSER full detail while NEW, masked history afterwards', async () => {
    db.lead.findUnique.mockResolvedValueOnce(FULL_LEAD);
    expect(await getLeadById('lead-1', { id: 'closer-1', role: 'CLOSER' })).toEqual({ data: { lead: FULL_LEAD } });

    db.lead.findUnique.mockResolvedValueOnce({ ...FULL_LEAD, status: 'SUBMITTED' }).mockResolvedValueOnce({ id: 'lead-1' });
    await getLeadById('lead-1', { id: 'closer-1', role: 'CLOSER' });
    const select = selectOf(db.lead.findUnique.mock.calls[2]);
    expect(select).not.toHaveProperty('phone');
    expect(select).not.toHaveProperty('ssn');
  });

  it('forbids a CLIENT from a lead that is not theirs', async () => {
    db.lead.findUnique.mockResolvedValueOnce(FULL_LEAD);
    expect(await getLeadById('lead-1', { id: 'client-2', role: 'CLIENT' })).toEqual({ error: 'Forbidden', status: 403 });
  });

  it('forbids RETENTION from non-retention leads', async () => {
    db.lead.findUnique.mockResolvedValueOnce(FULL_LEAD);
    expect(await getLeadById('lead-1', { id: 'r', role: 'RETENTION' })).toEqual({ error: 'Forbidden', status: 403 });
  });
});

describe('payment writes never record money twice', () => {
  it('batchMarkPaid records one IncomePayment when every lead updates', async () => {
    db.lead.findMany.mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }]);
    db.lead.updateMany.mockResolvedValueOnce({ count: 2 });
    expect(await batchMarkPaid(['a', 'b'], 5000, undefined)).toEqual({ data: { count: 2 } });
    expect(db.incomePayment.create).toHaveBeenCalledTimes(1);
    expect(db.lead.updateMany.mock.calls[0][0].where).toMatchObject({ paymentStatus: 'UNPAID' });
  });

  it('batchMarkPaid rolls back without income when another batch paid a lead first', async () => {
    db.lead.findMany.mockResolvedValueOnce([{ id: 'a' }, { id: 'b' }]);
    db.lead.updateMany.mockResolvedValueOnce({ count: 1 });
    const result = await batchMarkPaid(['a', 'b'], 5000, undefined);
    expect(result).toMatchObject({ status: 409 });
    expect(db.incomePayment.create).not.toHaveBeenCalled();
  });

  it('markLeadChargedBack writes no ChargeBack row when the lead had already moved', async () => {
    db.lead.findUnique.mockResolvedValueOnce({ ...FULL_LEAD, status: 'ACCEPTED', paymentStatus: 'PAID' });
    db.lead.updateMany.mockResolvedValueOnce({ count: 0 });
    const result = await markLeadChargedBack('lead-1', 100, 'refund');
    expect(result).toMatchObject({ status: 409 });
    expect(db.chargeBack.create).not.toHaveBeenCalled();
  });

  it('batchChargeBack splits the total and writes rows only after the guarded update', async () => {
    db.lead.findMany.mockResolvedValueOnce([
      { id: 'a', clientId: 'c', customerName: 'A' },
      { id: 'b', clientId: 'c', customerName: 'B' },
    ]);
    db.lead.updateMany.mockResolvedValueOnce({ count: 2 });
    expect(await batchChargeBack(['a', 'b'], 101, 'refund')).toEqual({ data: { count: 2 } });
    const rows = db.chargeBack.createMany.mock.calls[0][0].data as { pkrAmount: number }[];
    expect(rows.map((r) => r.pkrAmount)).toEqual([51, 50]);
  });

  it('batchChargeBack rolls back when any lead had already moved', async () => {
    db.lead.findMany.mockResolvedValueOnce([
      { id: 'a', clientId: 'c', customerName: 'A' },
      { id: 'b', clientId: 'c', customerName: 'B' },
    ]);
    db.lead.updateMany.mockResolvedValueOnce({ count: 1 });
    expect(await batchChargeBack(['a', 'b'], 100, 'refund')).toMatchObject({ status: 409 });
    expect(db.chargeBack.createMany).not.toHaveBeenCalled();
  });
});
