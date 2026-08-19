import bcrypt from "bcrypt";
import type { Role } from "@prisma/client";
import prisma from "../lib/prisma";
import { signToken } from "../lib/jwt";
import { isNonEmptyString, isValidEmail, isValidPassword } from "../lib/validation";
import { parseCarriers, parseStates } from "../lib/client-coverage";

type ServiceResult<T> = { data: T; status?: never } | { error: string; status: number };

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
  states?: string[];
  carriers?: string[];
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
    states: user.states ?? [],
    carriers: user.carriers ?? [],
  };
}

export async function login(email: unknown, password: unknown): Promise<ServiceResult<{ token: string; user: ReturnType<typeof publicUser> }>> {
  if (typeof email !== "string" || typeof password !== "string") {
    return { error: "Invalid email or password", status: 401 };
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) return { error: "Invalid email or password", status: 401 };

  const matches = await bcrypt.compare(password, user.password);
  if (!matches) return { error: "Invalid email or password", status: 401 };

  const token = signToken({ sub: user.id, role: user.role, tokenVersion: user.tokenVersion });
  return { data: { token, user: publicUser(user) } };
}

const STAFF_ROLES: Role[] = ["JUNIOR_CLOSER", "CLOSER", "ADMIN", "CLIENT", "TEAM_LEAD"];
const PLAN_COST_KEYS = ["levelCost", "gradedCost", "modifiedCost", "giCost"] as const;

/** A whole-dollar amount, or null/undefined to leave it unset. Rejects negative or non-numeric input. */
function parsePlanCost(raw: unknown): number | null | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const n = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.trunc(n);
}

/** Admin-only — creates a JUNIOR_CLOSER, CLOSER, ADMIN, or CLIENT account directly.
 * For CLIENT accounts, also accepts the four per-plan lead cost fields (USD) up front. */
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
  states?: unknown;
  carriers?: unknown;
}): Promise<ServiceResult<{ user: ReturnType<typeof publicUser> }>> {
  const { name, email, password, role, phone } = input;

  if (!isNonEmptyString(name)) return { error: "Name is required", status: 400 };
  if (!isValidEmail(email)) return { error: "Invalid email", status: 400 };
  if (!isValidPassword(password)) return { error: "Password must be at least 8 characters with an uppercase letter and a number", status: 400 };
  if (typeof role !== "string" || !STAFF_ROLES.includes(role as Role)) return { error: "Invalid role", status: 400 };
  if (phone !== undefined && typeof phone !== "string") return { error: "Invalid phone", status: 400 };

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return { error: "An account with this email already exists", status: 409 };

  // Pricing, states, and carriers only make sense for a CLIENT account — silently
  // ignored for other roles rather than erroring, since the create form only shows
  // these fields for CLIENT.
  const coverage: Record<string, number | null | string[]> = {};
  if (role === "CLIENT") {
    for (const key of PLAN_COST_KEYS) {
      const parsed = parsePlanCost((input as Record<string, unknown>)[key]);
      if (parsed !== undefined) coverage[key] = parsed;
    }

    const states = parseStates(input.states);
    if (states && "error" in states) return { error: states.error, status: 400 };
    if (states) coverage.states = states.value;

    const carriers = parseCarriers(input.carriers);
    if (carriers && "error" in carriers) return { error: carriers.error, status: 400 };
    if (carriers) coverage.carriers = carriers.value;
  }

  const hashed = await bcrypt.hash(password, SALT_ROUNDS);
  const user = await prisma.user.create({
    data: { name, email, password: hashed, phone, role: role as Role, ...coverage },
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
