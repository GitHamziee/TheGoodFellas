import prisma from '../lib/prisma';
import type { ServiceResult } from '../lib/service-result';

const MAX_NOTE_LENGTH = 2000;

const NOTE_SELECT = {
  id: true,
  leadId: true,
  body: true,
  createdAt: true,
  author: { select: { id: true, name: true } },
} as const;

/** Newest first — the latest follow-up is the one the Retention Manager wants to see. */
export async function listNotes(
  leadId: string,
  viewer?: { id: string; role: string }
): Promise<ServiceResult<{ notes: unknown[] }>> {
  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { id: true, leadType: true, retentionId: true } });
  if (!lead) return { error: 'Lead not found', status: 404 };
  // A Retention person reads the notes left on their own leads — nobody else's.
  if (viewer?.role === 'RETENTION' && (lead.leadType !== 'RETENTION' || lead.retentionId !== viewer.id)) {
    return { error: 'Not your lead', status: 403 };
  }

  const notes = await prisma.leadNote.findMany({
    where: { leadId },
    select: NOTE_SELECT,
    orderBy: { createdAt: 'desc' },
  });
  return { data: { notes } };
}

/** Always creates a new row — notes are append-only, so a second note months later never touches the first. */
export async function addNote(
  leadId: string,
  authorId: string,
  body: unknown
): Promise<ServiceResult<{ note: unknown }>> {
  if (typeof body !== 'string' || !body.trim()) return { error: 'Note cannot be empty', status: 400 };
  const text = body.trim();
  if (text.length > MAX_NOTE_LENGTH) {
    return { error: `Note must be ${MAX_NOTE_LENGTH} characters or fewer`, status: 400 };
  }

  const lead = await prisma.lead.findUnique({ where: { id: leadId }, select: { id: true } });
  if (!lead) return { error: 'Lead not found', status: 404 };

  const note = await prisma.leadNote.create({
    data: { leadId, authorId, body: text },
    select: NOTE_SELECT,
  });
  return { data: { note } };
}
