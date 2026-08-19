import type { Role } from "@prisma/client";
import prisma from "../lib/prisma";
import { parseCarriers, parseStates } from "../lib/client-coverage";

const PUBLIC_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  phone: true,
  createdAt: true,
  levelCost: true,
  gradedCost: true,
  modifiedCost: true,
  giCost: true,
  states: true,
  carriers: true,
} as const;
const PLAN_COST_KEYS = ["levelCost", "gradedCost", "modifiedCost", "giCost"] as const;

/** For the junior closer's "select a closer" dropdown at lead submission. */
export async function listClosers() {
  return prisma.user.findMany({
    where: { role: "CLOSER" },
    select: { id: true, name: true, email: true },
    orderBy: { name: "asc" },
  });
}

/** For the admin's "assign to client" dropdown. */
export async function listClients() {
  return prisma.user.findMany({
    where: { role: "CLIENT" },
    select: { id: true, name: true, email: true },
    orderBy: { name: "asc" },
  });
}

/** For the State Sheet (state -> clients -> carriers available there), visible to
 * Closer/Team Lead/Admin. Deliberately narrow — no email/phone/pricing, just enough to
 * build the per-state directory. */
export async function listClientCoverage() {
  return prisma.user.findMany({
    where: { role: "CLIENT" },
    select: { id: true, name: true, states: true, carriers: true },
    orderBy: { name: "asc" },
  });
}

export async function listUsers(role?: Role) {
  return prisma.user.findMany({
    where: role ? { role } : undefined,
    select: PUBLIC_SELECT,
    orderBy: { createdAt: "desc" },
  });
}

export async function getUserById(id: string) {
  return prisma.user.findUnique({ where: { id }, select: PUBLIC_SELECT });
}

/** Admin role switch — bumps tokenVersion to force re-login under the new role. */
export async function updateUserRole(id: string, role: Role) {
  return prisma.user.update({
    where: { id },
    data: { role, tokenVersion: { increment: 1 } },
    select: PUBLIC_SELECT,
  });
}

/** Admin editing a CLIENT's per-plan lead cost (USD). Meaningless for any other role, so
 * rejected outright rather than silently no-op'd. Each key is a non-negative integer or
 * null to clear it; omitted keys are left unchanged. */
export async function updateClientPricing(
  id: string,
  input: Record<string, unknown>
): Promise<{ data: { user: Awaited<ReturnType<typeof getUserById>> } } | { error: string; status: number }> {
  const user = await prisma.user.findUnique({ where: { id }, select: { role: true } });
  if (!user) return { error: "User not found", status: 404 };
  if (user.role !== "CLIENT") return { error: "Only client accounts carry plan pricing", status: 400 };

  const data: Record<string, number | null> = {};
  for (const key of PLAN_COST_KEYS) {
    if (!(key in input)) continue;
    const raw = input[key];
    if (raw === null || raw === "") {
      data[key] = null;
      continue;
    }
    const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
    if (!Number.isFinite(n) || n < 0) return { error: `Invalid ${key}`, status: 400 };
    data[key] = Math.trunc(n);
  }

  const updated = await prisma.user.update({ where: { id }, data, select: PUBLIC_SELECT });
  return { data: { user: updated } };
}

/** Admin editing a CLIENT's licensed states / carriers — the data set the future State
 * Sheet page reads (state -> clients -> carriers available there). Meaningless for any
 * other role, so rejected outright like pricing above. Either key omitted is left
 * unchanged; present but empty clears it. */
export async function updateClientCoverage(
  id: string,
  input: Record<string, unknown>
): Promise<{ data: { user: Awaited<ReturnType<typeof getUserById>> } } | { error: string; status: number }> {
  const user = await prisma.user.findUnique({ where: { id }, select: { role: true } });
  if (!user) return { error: "User not found", status: 404 };
  if (user.role !== "CLIENT") return { error: "Only client accounts carry state/carrier coverage", status: 400 };

  const data: Record<string, string[]> = {};

  const states = parseStates(input.states);
  if (states && "error" in states) return { error: states.error, status: 400 };
  if (states) data.states = states.value;

  const carriers = parseCarriers(input.carriers);
  if (carriers && "error" in carriers) return { error: carriers.error, status: 400 };
  if (carriers) data.carriers = carriers.value;

  const updated = await prisma.user.update({ where: { id }, data, select: PUBLIC_SELECT });
  return { data: { user: updated } };
}
