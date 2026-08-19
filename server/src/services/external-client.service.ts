import prisma from '../lib/prisma';
import { isNonEmptyString, isValidEmail } from '../lib/validation';

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
  createdAt: true,
  updatedAt: true,
} as const;

const PLAN_COST_KEYS = ['levelCost', 'gradedCost', 'modifiedCost', 'giCost'] as const;

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

  return { data };
}

export async function listExternalClients() {
  return prisma.externalClient.findMany({ select: SELECT, orderBy: { name: 'asc' } });
}

export async function createExternalClient(input: ExternalClientInput): Promise<ServiceResult<{ externalClient: unknown }>> {
  const result = validate(input, true);
  if ('error' in result) return { error: result.error, status: 400 };

  const externalClient = await prisma.externalClient.create({ data: result.data as any, select: SELECT });
  return { data: { externalClient } };
}

export async function updateExternalClient(
  id: string,
  input: ExternalClientInput
): Promise<ServiceResult<{ externalClient: unknown }>> {
  const existing = await prisma.externalClient.findUnique({ where: { id } });
  if (!existing) return { error: 'External client not found', status: 404 };

  const result = validate(input, false);
  if ('error' in result) return { error: result.error, status: 400 };

  const externalClient = await prisma.externalClient.update({ where: { id }, data: result.data as any, select: SELECT });
  return { data: { externalClient } };
}
