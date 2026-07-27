import bcrypt from "bcrypt";
import type { Role } from "@prisma/client";
import prisma from "../lib/prisma";
import { signToken } from "../lib/jwt";
import { isNonEmptyString, isValidEmail, isValidPassword } from "../lib/validation";

type ServiceResult<T> = { data: T; status?: never } | { error: string; status: number };

const SALT_ROUNDS = 10;

function publicUser(user: { id: string; name: string; email: string; role: Role; phone: string | null }) {
  return { id: user.id, name: user.name, email: user.email, role: user.role, phone: user.phone };
}

/** Self-service registration — always creates a CLIENT account. Staff accounts are admin-created. */
export async function registerClient(input: { name?: unknown; email?: unknown; password?: unknown; phone?: unknown }): Promise<ServiceResult<{ token: string; user: ReturnType<typeof publicUser> }>> {
  const { name, email, password, phone } = input;

  if (!isNonEmptyString(name)) return { error: "Name is required", status: 400 };
  if (!isValidEmail(email)) return { error: "Invalid email", status: 400 };
  if (!isValidPassword(password)) return { error: "Password must be at least 8 characters with an uppercase letter and a number", status: 400 };
  if (phone !== undefined && typeof phone !== "string") return { error: "Invalid phone", status: 400 };

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return { error: "An account with this email already exists", status: 409 };

  const hashed = await bcrypt.hash(password, SALT_ROUNDS);
  const user = await prisma.user.create({
    data: { name, email, password: hashed, phone, role: "CLIENT" },
  });

  const token = signToken({ sub: user.id, role: user.role, tokenVersion: user.tokenVersion });
  return { data: { token, user: publicUser(user) } };
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

const STAFF_ROLES: Role[] = ["JUNIOR_CLOSER", "CLOSER", "ADMIN", "CLIENT"];

/** Admin-only — creates a JUNIOR_CLOSER, CLOSER, ADMIN, or CLIENT account directly. */
export async function createStaffUser(input: { name?: unknown; email?: unknown; password?: unknown; role?: unknown; phone?: unknown }): Promise<ServiceResult<{ user: ReturnType<typeof publicUser> }>> {
  const { name, email, password, role, phone } = input;

  if (!isNonEmptyString(name)) return { error: "Name is required", status: 400 };
  if (!isValidEmail(email)) return { error: "Invalid email", status: 400 };
  if (!isValidPassword(password)) return { error: "Password must be at least 8 characters with an uppercase letter and a number", status: 400 };
  if (typeof role !== "string" || !STAFF_ROLES.includes(role as Role)) return { error: "Invalid role", status: 400 };
  if (phone !== undefined && typeof phone !== "string") return { error: "Invalid phone", status: 400 };

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return { error: "An account with this email already exists", status: 409 };

  const hashed = await bcrypt.hash(password, SALT_ROUNDS);
  const user = await prisma.user.create({ data: { name, email, password: hashed, phone, role: role as Role } });

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

export { publicUser };
