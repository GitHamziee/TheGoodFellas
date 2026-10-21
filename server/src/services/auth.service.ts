import bcrypt from "bcrypt";
import { Role } from "@prisma/client";
import prisma from "../lib/prisma";
import { signToken } from "../lib/jwt";
import { INVALID_PHONE_MESSAGE, isNonEmptyString, isValidEmail, isValidPassword, normalizeUsPhone } from "../lib/validation";
import { parseCarriers, parseStates } from "../lib/client-coverage";
import { IP_EXEMPT_ROLES, isIpWhitelisted } from "../lib/ip-whitelist";
import type { ServiceResult } from "../lib/service-result";


const SALT_ROUNDS = 10;

function publicUser(user: {
  id: string;
  name: string;
  email: string;
  role: Role;
  phone: string | null;
  levelCost?: number | null;
  gradedCost?: number | null;
  modifiedCost?: number | null;
  giCost?: number | null;
  minimumPremium?: number | null;
  acceptsOnlineBankPayment?: boolean;
  states?: string[];
  carriers?: string[];
  stateCarriers?: { state: string; carriers: string[] }[];
}) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    phone: user.phone,
    levelCost: user.levelCost ?? null,
    gradedCost: user.gradedCost ?? null,
    modifiedCost: user.modifiedCost ?? null,
    giCost: user.giCost ?? null,
    minimumPremium: user.minimumPremium ?? null,
    acceptsOnlineBankPayment: user.acceptsOnlineBankPayment ?? false,
    states: user.states ?? [],
    carriers: user.carriers ?? [],
    stateCarriers: (user.stateCarriers ?? []).map((sc) => ({ state: sc.state, carriers: sc.carriers })),
  };
}

export async function login(email: unknown, password: unknown, ip: string): Promise<ServiceResult<{ token: string; user: ReturnType<typeof publicUser> }>> {
  if (typeof email !== "string" || typeof password !== "string") {
    return { error: "Invalid email or password", status: 401 };
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return { error: "Invalid email or password", status: 401 };

  const matches = await bcrypt.compare(password, user.password);
  if (!matches) return { error: "Invalid email or password", status: 401 };

  // Checked after the password so a blocked IP can't be used to probe which emails exist.
  if (!IP_EXEMPT_ROLES.includes(user.role) && !(await isIpWhitelisted(ip))) {
    return {
      error: "This network is not authorized to use the app. Contact your admin to whitelist your IP.",
      status: 403,
      code: "IP_NOT_WHITELISTED",
    };
  }

  const token = signToken({ sub: user.id, role: user.role, tokenVersion: user.tokenVersion });
  return { data: { token, user: publicUser(user) } };
}

// Every role is creatable — same rule as the role-switch route, so a newly added role can't be missed here.
const STAFF_ROLES = Object.values(Role) as Role[];
// minimumPremium isn't a plan cost, but shares the same nullable-non-negative-whole-dollar
// validation, so it rides the same parse loop as the four plan costs below.
const PLAN_COST_KEYS = ["levelCost", "gradedCost", "modifiedCost", "giCost", "minimumPremium"] as const;

/** A whole-dollar amount, or null/undefined to leave it unset. Rejects negative or non-numeric input. */
function parsePlanCost(raw: unknown): number | null | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.trunc(n);
}

/** Admin-only — creates a JUNIOR_CLOSER, CLOSER, ADMIN, or CLIENT account directly.
 * For CLIENT accounts, also accepts the per-plan lead cost fields + minimum premium (USD),
 * licensed states, carrier roster, per-state carrier assignment, and online-bank-payment
 * acceptance up front. */
export async function createStaffUser(input: {
  name?: unknown;
  email?: unknown;
  password?: unknown;
  role?: unknown;
  phone?: unknown;
  levelCost?: unknown;
  gradedCost?: unknown;
  modifiedCost?: unknown;
  giCost?: unknown;
  minimumPremium?: unknown;
  acceptsOnlineBankPayment?: unknown;
  states?: unknown;
  carriers?: unknown;
  stateCarriers?: unknown;
}): Promise<ServiceResult<{ user: ReturnType<typeof publicUser> }>> {
  const { name, email, password, role, phone } = input;

  if (!isNonEmptyString(name)) return { error: "Name is required", status: 400 };
  if (!isValidEmail(email)) return { error: "Invalid email", status: 400 };
  if (!isValidPassword(password)) return { error: "Password must be at least 8 characters with an uppercase letter and a number", status: 400 };
  if (typeof role !== "string" || !STAFF_ROLES.includes(role as Role)) return { error: "Invalid role", status: 400 };
  let normalizedPhone: string | undefined;
  if (phone !== undefined && phone !== null && phone !== "") {
    const n = normalizeUsPhone(phone);
    if (!n) return { error: INVALID_PHONE_MESSAGE, status: 400 };
    normalizedPhone = n;
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return { error: "An account with this email already exists", status: 409 };

  // Pricing, states, and carriers only make sense for a CLIENT account — silently
  // ignored for other roles rather than erroring, since the create form only shows
  // these fields for CLIENT.
  const coverage: Record<string, number | null | string[] | boolean> = {};
  let stateCarriersNested: { state: string; carriers: string[] }[] | undefined;
  if (role === "CLIENT") {
    for (const key of PLAN_COST_KEYS) {
      const parsed = parsePlanCost((input as Record<string, unknown>)[key]);
      if (parsed !== undefined) coverage[key] = parsed;
    }

    if (typeof input.acceptsOnlineBankPayment === "boolean") {
      coverage.acceptsOnlineBankPayment = input.acceptsOnlineBankPayment;
    }

    const states = parseStates(input.states);
    if (states && "error" in states) return { error: states.error, status: 400 };
    if (states) coverage.states = states.value;

    const carriers = parseCarriers(input.carriers);
    if (carriers && "error" in carriers) return { error: carriers.error, status: 400 };
    if (carriers) coverage.carriers = carriers.value;

    if (Array.isArray(input.stateCarriers)) {
      const finalStates = states && "value" in states ? states.value : [];
      const nested: { state: string; carriers: string[] }[] = [];
      for (const entry of input.stateCarriers) {
        if (typeof entry !== "object" || entry === null) return { error: "Invalid state-carrier entry", status: 400 };
        const { state, carriers: entryCarriers } = entry as Record<string, unknown>;
        if (typeof state !== "string" || !finalStates.includes(state)) {
          return { error: `Invalid state in carrier assignment: ${String(state)}`, status: 400 };
        }
        // Each state's carriers are independent freehand text, not a subset of the general
        // roster — the same validation as the roster itself, just scoped per state.
        const parsed = parseCarriers(entryCarriers);
        if (parsed && "error" in parsed) return { error: parsed.error, status: 400 };
        nested.push({ state, carriers: parsed?.value ?? [] });
      }
      stateCarriersNested = nested;
    }
  }

  const hashed = await bcrypt.hash(password, SALT_ROUNDS);
  const user = await prisma.user.create({
    data: {
      name,
      email,
      password: hashed,
      phone: normalizedPhone,
      role: role as Role,
      ...coverage,
      ...(stateCarriersNested && stateCarriersNested.length
        ? { stateCarriers: { create: stateCarriersNested } }
        : {}),
    },
    include: { stateCarriers: { select: { state: true, carriers: true } } },
  });

  return { data: { user: publicUser(user) } };
}

export async function changePassword(userId: string, currentPassword: unknown, newPassword: unknown): Promise<ServiceResult<{ user: ReturnType<typeof publicUser> }>> {
  if (typeof currentPassword !== "string") return { error: "Current password is incorrect", status: 400 };

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { error: "User not found", status: 404 };

  const matches = await bcrypt.compare(currentPassword, user.password);
  if (!matches) return { error: "Current password is incorrect", status: 400 };

  if (!isValidPassword(newPassword)) return { error: "Password must be at least 8 characters with an uppercase letter and a number", status: 400 };

  const hashed = await bcrypt.hash(newPassword, SALT_ROUNDS);
  // Bump tokenVersion — invalidates all previously issued tokens for this user.
  const updated = await prisma.user.update({
    where: { id: userId },
    data: { password: hashed, tokenVersion: { increment: 1 } },
  });

  return { data: { user: publicUser(updated) } };
}

/** Admin-only — sets a user's password directly, no current-password check. There is no
 * self-service "forgot password" flow; this is the only way a locked-out account recovers. */
export async function resetPassword(userId: string, newPassword: unknown): Promise<ServiceResult<{ user: ReturnType<typeof publicUser> }>> {
  if (!isValidPassword(newPassword)) return { error: "Password must be at least 8 characters with an uppercase letter and a number", status: 400 };

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return { error: "User not found", status: 404 };

  const hashed = await bcrypt.hash(newPassword, SALT_ROUNDS);
  // Bump tokenVersion — invalidates all previously issued tokens for this user.
  const updated = await prisma.user.update({
    where: { id: userId },
    data: { password: hashed, tokenVersion: { increment: 1 } },
  });

  return { data: { user: publicUser(updated) } };
}

export { publicUser };
