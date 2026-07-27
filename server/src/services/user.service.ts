import type { Role } from "@prisma/client";
import prisma from "../lib/prisma";

const PUBLIC_SELECT = { id: true, name: true, email: true, role: true, phone: true, createdAt: true } as const;

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
