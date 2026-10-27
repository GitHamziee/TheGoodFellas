import prisma from '../lib/prisma';
import type { LeadEventType } from '@prisma/client';

/**
 * Appends audit rows for the Retention History page. Best-effort and fire-and-forget like
 * notifications (`void recordRetentionEvents(...)`): a failure here must never fail the lead
 * transition it describes. Only RETENTION leads are recorded — nothing else reads them.
 */
export async function recordRetentionEvents(
  leadIds: string[],
  type: LeadEventType,
  opts: { actorId?: string | null; targetId?: string | null; note?: string | null } = {}
): Promise<void> {
  if (leadIds.length === 0) return;
  try {
    const leads = await prisma.lead.findMany({
      where: { id: { in: leadIds }, leadType: 'RETENTION' },
      select: { id: true },
    });
    if (leads.length === 0) return;
    await prisma.leadEvent.createMany({
      data: leads.map((l) => ({
        leadId: l.id,
        type,
        actorId: opts.actorId ?? null,
        targetId: opts.targetId ?? null,
        note: opts.note ?? null,
      })),
    });
  } catch {
    // Swallowed on purpose — see above.
  }
}
