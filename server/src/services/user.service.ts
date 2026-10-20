import type { PlanType, Role } from "@prisma/client";
import prisma from "../lib/prisma";
import { isValidState, parseCarriers, parseStates } from "../lib/client-coverage";
import { INVALID_PHONE_MESSAGE, isNonEmptyString, isValidEmail, normalizeUsPhone } from "../lib/validation";

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
  minimumPremium: true,
  acceptsOnlineBankPayment: true,
  states: true,
  carriers: true,
  stateCarriers: { select: { state: true, carriers: true } },
} as const;
// minimumPremium isn't a plan cost, but shares the same nullable-non-negative-whole-dollar
// validation, so it rides the same parse/update path as the four plan costs below.
const PLAN_COST_KEYS = ["levelCost", "gradedCost", "modifiedCost", "giCost", "minimumPremium"] as const;

const PLAN_COST_TO_TYPE: Record<"levelCost" | "gradedCost" | "modifiedCost" | "giCost", PlanType> = {
  levelCost: "LEVEL",
  gradedCost: "GRADED",
  modifiedCost: "MODIFIED",
  giCost: "GI",
};

/** A plan is "accepted" iff its per-plan cost is set to a positive amount — resolved
 * convention from M4/M9, never a separate boolean field. A cost of exactly 0 means the same
 * thing as leaving it blank (the client doesn't take that plan), not "free," so it's excluded
 * the same as null. */
function acceptedPlansFor(user: { levelCost: number | null; gradedCost: number | null; modifiedCost: number | null; giCost: number | null }): PlanType[] {
  return (Object.keys(PLAN_COST_TO_TYPE) as (keyof typeof PLAN_COST_TO_TYPE)[])
    .filter((key) => (user[key] ?? 0) > 0)
    .map((key) => PLAN_COST_TO_TYPE[key]);
}

/** For the junior closer's "select a closer" dropdown at lead submission. */
export async function listClosers() {
  return prisma.user.findMany({
    where: { role: "CLOSER" },
    select: { id: true, name: true, email: true },
    orderBy: { name: "asc" },
  });
}

/** For QA_JUNIOR_CLOSER's "who is this call review about" dropdown. */
export async function listJuniorClosers() {
  return prisma.user.findMany({
    where: { role: "JUNIOR_CLOSER" },
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

/** For Admin's "assign to retention person" dropdown and the Retention queue's "filter by
 * teammate" dropdown. */
export async function listRetention() {
  return prisma.user.findMany({
    where: { role: "RETENTION" },
    select: { id: true, name: true, email: true },
    orderBy: { name: "asc" },
  });
}

/** For the State Sheet (state -> clients -> carriers available there), visible to
 * Closer/Team Lead/Admin. Deliberately narrow — no email/phone/raw pricing figures, just
 * enough to build the per-state directory. `acceptedPlans` is derived from the four cost
 * fields (non-null -> accepted) rather than exposing the dollar amounts themselves;
 * `minimumPremium` is the one dollar figure surfaced here, since the State Sheet explicitly
 * needs it shown against the client. */
export async function listClientCoverage() {
  const clients = await prisma.user.findMany({
    where: { role: "CLIENT" },
    select: {
      id: true,
      name: true,
      states: true,
      carriers: true,
      stateCarriers: { select: { state: true, carriers: true } },
      levelCost: true,
      gradedCost: true,
      modifiedCost: true,
      giCost: true,
      minimumPremium: true,
      acceptsOnlineBankPayment: true,
    },
    orderBy: { name: "asc" },
  });

  return clients.map((c) => ({
    id: c.id,
    name: c.name,
    states: c.states,
    carriers: c.carriers,
    stateCarriers: c.stateCarriers,
    acceptedPlans: acceptedPlansFor(c),
    minimumPremium: c.minimumPremium,
    acceptsOnlineBankPayment: c.acceptsOnlineBankPayment,
  }));
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

/** Admin editing an account's basic info (name/email/phone) — any role, since a client (or
 * any staff account) has no self-service way to fix a typo in their own name/email: the
 * shared Settings page is password-change only. Any key omitted is left unchanged; email
 * must stay unique across accounts. */
export async function updateUserProfile(
  id: string,
  input: { name?: unknown; email?: unknown; phone?: unknown }
): Promise<{ data: { user: Awaited<ReturnType<typeof getUserById>> } } | { error: string; status: number }> {
  const existing = await prisma.user.findUnique({ where: { id }, select: { id: true } });
  if (!existing) return { error: "User not found", status: 404 };

  const data: Record<string, string | null> = {};

  if (input.name !== undefined) {
    if (!isNonEmptyString(input.name)) return { error: "Name is required", status: 400 };
    data.name = input.name;
  }

  if (input.email !== undefined) {
    if (!isValidEmail(input.email)) return { error: "Invalid email", status: 400 };
    const taken = await prisma.user.findUnique({ where: { email: input.email as string } });
    if (taken && taken.id !== id) return { error: "An account with this email already exists", status: 409 };
    data.email = input.email as string;
  }

  if (input.phone !== undefined) {
    if (input.phone === null || input.phone === "") {
      data.phone = null;
    } else {
      const phone = normalizeUsPhone(input.phone);
      if (!phone) return { error: INVALID_PHONE_MESSAGE, status: 400 };
      data.phone = phone;
    }
  }

  const updated = await prisma.user.update({ where: { id }, data, select: PUBLIC_SELECT });
  return { data: { user: updated } };
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

/** Admin editing a CLIENT's licensed states / carrier roster / online-bank-payment
 * acceptance — the data set the State Sheet page reads (state -> clients -> carriers
 * available there). Meaningless for any other role, so rejected outright like pricing above.
 * Any key omitted is left unchanged; states/carriers present but empty clears them. Shrinking
 * `states` also cleans up the per-state carrier assignments (ClientStateCarrier) for any
 * removed state, so no stale data survives a coverage edit. `carriers` here is just the
 * client's general roster — independent of per-state carrier lists (see
 * updateClientStateCarriers), so shrinking it doesn't touch ClientStateCarrier rows. */
export async function updateClientCoverage(
  id: string,
  input: Record<string, unknown>
): Promise<{ data: { user: Awaited<ReturnType<typeof getUserById>> } } | { error: string; status: number }> {
  const user = await prisma.user.findUnique({ where: { id }, select: { role: true, states: true } });
  if (!user) return { error: "User not found", status: 404 };
  if (user.role !== "CLIENT") return { error: "Only client accounts carry state/carrier coverage", status: 400 };

  const data: Record<string, string[] | boolean> = {};

  const states = parseStates(input.states);
  if (states && "error" in states) return { error: states.error, status: 400 };
  if (states) data.states = states.value;

  const carriers = parseCarriers(input.carriers);
  if (carriers && "error" in carriers) return { error: carriers.error, status: 400 };
  if (carriers) data.carriers = carriers.value;

  if (typeof input.acceptsOnlineBankPayment === "boolean") {
    data.acceptsOnlineBankPayment = input.acceptsOnlineBankPayment;
  }

  await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id }, data });

    if (states) {
      const removedStates = user.states.filter((s) => !states.value.includes(s));
      if (removedStates.length) {
        await tx.clientStateCarrier.deleteMany({ where: { clientId: id, state: { in: removedStates } } });
      }
    }
  });

  const updated = await getUserById(id);
  return { data: { user: updated } };
}

/** Admin editing the carriers a CLIENT writes business through in one specific licensed
 * state — e.g. Sunrise writes NRG in Alaska but MPG in Alabama. Each state's carrier list is
 * independent freehand text, entered per state (not a shared roster toggled per state — that
 * shape made one carrier entry fan out across every state, which is exactly the bug this
 * replaced). Rejected for any other role, or for a state the client isn't currently licensed
 * in. */
export async function updateClientStateCarriers(
  id: string,
  input: Record<string, unknown>
): Promise<{ data: { user: Awaited<ReturnType<typeof getUserById>> } } | { error: string; status: number }> {
  const user = await prisma.user.findUnique({ where: { id }, select: { role: true, states: true } });
  if (!user) return { error: "User not found", status: 404 };
  if (user.role !== "CLIENT") return { error: "Only client accounts carry state/carrier coverage", status: 400 };

  const { state } = input;
  if (typeof state !== "string" || !isValidState(state)) return { error: "Invalid state", status: 400 };
  if (!user.states.includes(state)) return { error: "Client is not licensed in this state", status: 400 };

  const carriers = parseCarriers(input.carriers);
  if (carriers && "error" in carriers) return { error: carriers.error, status: 400 };

  await prisma.clientStateCarrier.upsert({
    where: { clientId_state: { clientId: id, state } },
    update: { carriers: carriers?.value ?? [] },
    create: { clientId: id, state, carriers: carriers?.value ?? [] },
  });

  const updated = await getUserById(id);
  return { data: { user: updated } };
}
