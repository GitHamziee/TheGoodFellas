import { beforeEach, describe, expect, it, vi } from 'vitest';

const prisma = vi.hoisted(() => ({
  lead: { findUnique: vi.fn() },
  leadNote: { create: vi.fn(), findMany: vi.fn() },
}));
vi.mock('../src/lib/prisma', () => ({ default: prisma }));

import { addNote, listNotes } from '../src/services/lead-note.service';

beforeEach(() => {
  vi.clearAllMocks();
  prisma.lead.findUnique.mockResolvedValue({ id: 'l1' });
});

describe('addNote', () => {
  it('rejects empty and non-string bodies without touching the DB', async () => {
    for (const body of ['', '   ', undefined, 42]) {
      expect(await addNote('l1', 'u1', body)).toMatchObject({ status: 400 });
    }
    expect(prisma.leadNote.create).not.toHaveBeenCalled();
  });

  it('rejects an over-long note', async () => {
    expect(await addNote('l1', 'u1', 'x'.repeat(2001))).toMatchObject({ status: 400 });
  });

  it('404s on an unknown lead', async () => {
    prisma.lead.findUnique.mockResolvedValue(null);
    expect(await addNote('nope', 'u1', 'hello')).toMatchObject({ status: 404 });
  });

  it('creates a new row each time, so a later note never replaces an earlier one', async () => {
    prisma.leadNote.create.mockResolvedValue({ id: 'n' });
    await addNote('l1', 'u1', '  first  ');
    await addNote('l1', 'u1', 'two months later');
    expect(prisma.leadNote.create).toHaveBeenCalledTimes(2);
    expect(prisma.leadNote.create.mock.calls[0][0].data).toEqual({ leadId: 'l1', authorId: 'u1', body: 'first' });
  });
});

describe('listNotes', () => {
  it('returns notes newest first', async () => {
    prisma.leadNote.findMany.mockResolvedValue([]);
    await listNotes('l1');
    expect(prisma.leadNote.findMany.mock.calls[0][0].orderBy).toEqual({ createdAt: 'desc' });
  });
});
