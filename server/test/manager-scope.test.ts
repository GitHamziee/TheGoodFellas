import type { AddressInfo } from 'net';
import express from 'express';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// The route file is exercised for real; auth is reduced to "role from a header" and the
// service layer is stubbed, so only the Manager scope hooks decide what gets through.
vi.mock('../src/middleware/auth', () => ({
  authenticate: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    req.user = { id: 'user-1', role: req.header('x-role') as never, tokenVersion: 0 };
    next();
  },
  requireRole:
    (...roles: string[]) =>
    (req: express.Request, res: express.Response, next: express.NextFunction) =>
      roles.includes(req.user!.role) ? next() : res.status(403).json({ error: 'Forbidden' }),
}));
vi.mock('../src/services/retention-sheet-sync.service', () => ({}));
const leadService = vi.hoisted(() => ({
  leadsInManagerScope: vi.fn(),
  editLead: vi.fn(async () => ({ data: { lead: {} } })),
  assignLeadToClient: vi.fn(async () => ({ data: { lead: {} } })),
  batchMarkPaid: vi.fn(async () => ({ data: { count: 1 } })),
  getLeadById: vi.fn(async () => ({ data: { lead: {} } })),
}));
vi.mock('../src/services/lead.service', () => leadService);

import leadsRouter from '../src/routes/leads.routes';

let base = '';
let server: ReturnType<ReturnType<typeof express>['listen']>;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/leads', leadsRouter);
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/leads`;
});

afterAll(() => {
  server.close();
});

beforeEach(() => {
  vi.clearAllMocks();
  leadService.leadsInManagerScope.mockResolvedValue(false);
});

const send = (method: string, path: string, role: string, body?: unknown) =>
  fetch(`${base}${path}`, {
    method,
    headers: { 'content-type': 'application/json', 'x-role': role },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

describe('Manager scope', () => {
  it('blocks PATCH /:id on an out-of-scope lead (the route that used to slip through)', async () => {
    const res = await send('PATCH', '/lead-1', 'MANAGER', { customerName: 'x' });
    expect(res.status).toBe(403);
    expect(leadService.leadsInManagerScope).toHaveBeenCalledWith(['lead-1']);
    expect(leadService.editLead).not.toHaveBeenCalled();
  });

  it('blocks PATCH /:id/assign on an out-of-scope lead', async () => {
    const res = await send('PATCH', '/lead-1/assign', 'MANAGER', { clientId: 'c' });
    expect(res.status).toBe(403);
    expect(leadService.assignLeadToClient).not.toHaveBeenCalled();
  });

  it('blocks a batch that includes an out-of-scope lead', async () => {
    const res = await send('PATCH', '/batch-payment', 'MANAGER', { leadIds: ['a', 'b'], pkrAmount: 1 });
    expect(res.status).toBe(403);
    expect(leadService.leadsInManagerScope).toHaveBeenCalledWith(['a', 'b']);
    expect(leadService.batchMarkPaid).not.toHaveBeenCalled();
  });

  it('lets an in-scope edit through', async () => {
    leadService.leadsInManagerScope.mockResolvedValue(true);
    const res = await send('PATCH', '/lead-1', 'MANAGER', { customerName: 'x' });
    expect(res.status).toBe(200);
    expect(leadService.editLead).toHaveBeenCalled();
  });

  it('never applies to ADMIN', async () => {
    const res = await send('PATCH', '/lead-1', 'ADMIN', { customerName: 'x' });
    expect(res.status).toBe(200);
    expect(leadService.leadsInManagerScope).not.toHaveBeenCalled();
  });

  it('does not gate Manager reads (getLeadById masks those itself)', async () => {
    const res = await send('GET', '/lead-1', 'MANAGER');
    expect(res.status).toBe(200);
    expect(leadService.leadsInManagerScope).not.toHaveBeenCalled();
  });
});
