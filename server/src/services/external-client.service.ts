import prisma from '../lib/prisma';
import { isNonEmptyString, isValidEmail } from '../lib/validation';
import { parseCarriers, parseStates } from '../lib/client-coverage';

type ServiceResult<T> = { data: T; status?: never } | { error: string; status: number };

const SELECT = {
  id: true,
  name: true,
  company: true,
  email: true,
  phone: true,
  notes: true,
  levelCost: true,
  gradedCost: true,
  modifiedCost: true,
  giCost: true,
  minimumPremium: true,
  acceptsOnlineBankPayment: true,
  states: true,
  carriers: true,
  stateCarriers: { select: { state: true, carriers: true } },
  createdAt: true,
  updatedAt: true,
} as const;

// minimumPremium isn't a plan cost, but shares the same nullable-non-negative-whole-amount
// validation, so it rides the same parse loop as the four plan costs below.
const PLAN_COST_KEYS = ['levelCost', 'gradedCost', 'modifiedCost', 'giCost', 'minimumPremium'] as const;

type ExternalClientInput = {
  name?: unknown;
  company?: unknown;
  email?: unknown;
  phone?: unknown;
  notes?: unknown;
  levelCost?: unknown;
  gradedCost?: unknown;
  modifiedCost?: unknown;
  giCost?: unknown;
  minimumPremium?: unknown;
  acceptsOnlineBankPayment?: unknown;
  states?: unknown;
  carriers?: unknown;
  stateCarriers?: unknown;
};

/** A whole-PKR amount, or null/undefined to leave it unset. Rejects negative or non-numeric input. */
function parsePlanCost(raw: unknown): number | null | undefined {
  if (raw === undefined) return undefined;
  if (raw === null || raw === '') return null;
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.trunc(n);
}

function validate(input: ExternalClientInput, requireName: boolean): { error: string } | { data: Record<string, unknown> } {
  const data: Record<string, unknown> = {};

  if (requireName || input.name !== undefined) {
    if (!isNonEmptyString(input.name)) return { error: 'Name is required' };
    data.name = input.name.trim();
  }
  if (input.company !== undefined) {
    if (input.company !== null && typeof input.company !== 'string') return { error: 'Invalid company' };
    data.company = input.company;
  }
  if (input.email !== undefined) {
    if (input.email !== null && input.email !== '' && !isValidEmail(input.email)) return { error: 'Invalid email' };
    data.email = input.email || null;
  }
  if (input.phone !== undefined) {
    if (input.phone !== null && typeof input.phone !== 'string') return { error: 'Invalid phone' };
    data.phone = input.phone;
  }
  if (input.notes !== undefined) {
    if (input.notes !== null && typeof input.notes !== 'string') return { error: 'Invalid notes' };
    data.notes = input.notes;
  }
  for (const key of PLAN_COST_KEYS) {
    if (input[key] === undefined) continue;
    const parsed = parsePlanCost(input[key]);
    if (parsed === undefined) return { error: `Invalid ${key}` };
    data[key] = parsed;
  }
  if (typeof input.acceptsOnlineBankPayment === 'boolean') {
    data.acceptsOnlineBankPayment = input.acceptsOnlineBankPayment;
  }

  const states = parseStates(input.states);
  if (states && 'error' in states) return { error: states.error };
  if (states) data.states = states.value;

  const carriers = parseCarriers(input.carriers);
  if (carriers && 'error' in carriers) return { error: carriers.error };
  if (carriers) data.carriers = carriers.value;

  return { data };
}

/** Validates the optional per-state carrier assignment against `licensedStates` (the states
 * this external client will end up licensed in after this write) — same rule as
 * createStaffUser's CLIENT coverage handling in auth.service.ts. `undefined` means the key
 * was absent from input — caller leaves existing per-state assignments untouched. */
function parseStateCarriers(
  raw: unknown,
  licensedStates: string[]
): { value: { state: string; carriers: string[] }[] } | { error: string } | undefined {
  if (!Array.isArray(raw)) return undefined;

  const result: { state: string; carriers: string[] }[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'object' || entry === null) return { error: 'Invalid state-carrier entry' };
    const { state, carriers } = entry as Record<string, unknown>;
    if (typeof state !== 'string' || !licensedStates.includes(state)) {
      return { error: `Invalid state in carrier assignment: ${String(state)}` };
    }
    const parsed = parseCarriers(carriers);
    if (parsed && 'error' in parsed) return { error: parsed.error };
    result.push({ state, carriers: parsed?.value ?? [] });
  }
  return { value: result };
}

export async function listExternalClients() {
  return prisma.externalClient.findMany({ select: SELECT, orderBy: { name: 'asc' } });
}

/** Accepts the same coverage fields as a CLIENT-role account (minimumPremium, licensed
 * states, carrier roster, per-state carrier assignment, online-bank-payment acceptance) up
 * front, same shape as auth.service.ts's createStaffUser for CLIENT accounts — an external
 * client is priced and licensed the same way, it just has no login. */
export async function createExternalClient(input: ExternalClientInput): Promise<ServiceResult<{ externalClient: unknown }>> {
  const result = validate(input, true);
  if ('error' in result) return { error: result.error, status: 400 };

  const licensedStates = Array.isArray(result.data.states) ? (result.data.states as string[]) : [];
  const stateCarriers = parseStateCarriers(input.stateCarriers, licensedStates);
  if (stateCarriers && 'error' in stateCarriers) return { error: stateCarriers.error, status: 400 };

  const externalClient = await prisma.externalClient.create({
    data: {
      ...(result.data as any),
      ...(stateCarriers?.value.length ? { stateCarriers: { create: stateCarriers.value } } : {}),
    },
    select: SELECT,
  });
  return { data: { externalClient } };
}

/** Shrinking `states` cleans up the per-state carrier assignments for any removed state, same
 * as updateClientCoverage does for CLIENT accounts, so no stale rows survive a coverage edit. */
export async function updateExternalClient(
  id: string,
  input: ExternalClientInput
): Promise<ServiceResult<{ externalClient: unknown }>> {
  const existing = await prisma.externalClient.findUnique({ where: { id }, select: { id: true, states: true } });
  if (!existing) return { error: 'External client not found', status: 404 };

  const result = validate(input, false);
  if ('error' in result) return { error: result.error, status: 400 };

  const nextStates = Array.isArray(result.data.states) ? (result.data.states as string[]) : existing.states;
  const stateCarriers = parseStateCarriers(input.stateCarriers, nextStates);
  if (stateCarriers && 'error' in stateCarriers) return { error: stateCarriers.error, status: 400 };

  const removedStates = Array.isArray(result.data.states)
    ? existing.states.filter((s) => !(result.data.states as string[]).includes(s))
    : [];

  const externalClient = await prisma.$transaction(async (tx) => {
    if (removedStates.length) {
      await tx.externalClientStateCarrier.deleteMany({ where: { externalClientId: id, state: { in: removedStates } } });
    }
    if (stateCarriers) {
      for (const sc of stateCarriers.value) {
        await tx.externalClientStateCarrier.upsert({
          where: { externalClientId_state: { externalClientId: id, state: sc.state } },
          update: { carriers: sc.carriers },
          create: { externalClientId: id, state: sc.state, carriers: sc.carriers },
        });
      }
    }
    return tx.externalClient.update({ where: { id }, data: result.data as any, select: SELECT });
  });

  return { data: { externalClient } };
}
