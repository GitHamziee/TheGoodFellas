import type { Role } from "@prisma/client";
import prisma from "../lib/prisma";
import { emitNotification } from "../realtime/chat-gateway";
import { reportError } from "../lib/rollbar";

export type NotificationKind = "success" | "info" | "warning" | "danger";

/** Which portal page a notification should open, per recipient role. */
const PAGE_PATHS = {
  INBOX: { CLOSER: "/closer/inbox", RETENTION: "/retention/queue" },
  RETURNED: { JUNIOR_CLOSER: "/junior/returned", CLOSER: "/closer/returned", RETENTION: "/retention/queue" },
  ADMIN_LEADS: { ADMIN: "/admin/leads", MANAGER: "/manager/leads" },
  ADMIN_CPL: { ADMIN: "/admin/cpl-leads", MANAGER: "/manager/cpl-leads" },
  CLIENT_CPA: { CLIENT: "/client/cpa-leads" },
  CLIENT_CPL: { CLIENT: "/client/cpl-leads" },
  CHAT: {
    JUNIOR_CLOSER: "/junior/chat",
    CLOSER: "/closer/chat",
    ADMIN: "/admin/chat",
    MANAGER: "/manager/chat",
    CLIENT: "/client/chat",
    TEAM_LEAD: "/team-lead/chat",
    QA_JUNIOR_CLOSER: "/qa-junior/chat",
    QA_CLOSER: "/qa-closer/chat",
    RETENTION: "/retention/chat",
    RETENTION_MANAGER: "/retention-manager/chat",
  },
  HISTORY: { JUNIOR_CLOSER: "/junior/my-leads", CLOSER: "/closer/history" },
} as const satisfies Record<string, Partial<Record<Role, string>>>;

export type NotificationPage = keyof typeof PAGE_PATHS;

export interface NotificationInput {
  kind: NotificationKind;
  title: string;
  message: string;
  page?: NotificationPage;
}

export interface PublicNotification {
  id: string;
  kind: string;
  title: string;
  message: string;
  link: string | null;
  read: boolean;
  createdAt: Date;
}

const toPublic = (n: { id: string; kind: string; title: string; message: string; link: string | null; readAt: Date | null; createdAt: Date }): PublicNotification => ({
  id: n.id,
  kind: n.kind,
  title: n.title,
  message: n.message,
  link: n.link,
  read: n.readAt !== null,
  createdAt: n.createdAt,
});

/**
 * Persists one notification per recipient and pushes it live. Best-effort by design: a failure
 * here must never fail (or roll back) the lead transition that triggered it, so errors are logged
 * and swallowed. Pass `exceptUserId` to avoid notifying the person who just did the action.
 */
export async function notifyUsers(
  userIds: (string | null | undefined)[],
  input: NotificationInput,
  exceptUserId?: string
): Promise<void> {
  try {
    const ids = [...new Set(userIds.filter((id): id is string => !!id && id !== exceptUserId))];
    if (ids.length === 0) return;
    const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, role: true } });
    for (const user of users) {
      const paths = input.page ? (PAGE_PATHS[input.page] as Partial<Record<Role, string>>) : undefined;
      const row = await prisma.notification.create({
        data: { userId: user.id, kind: input.kind, title: input.title, message: input.message, link: paths?.[user.role] ?? null },
      });
      emitNotification(user.id, toPublic(row));
    }
  } catch (err) {
    console.error("[notifications] failed to send", err);
    reportError(err);
  }
}

/** Notifies every account holding one of the given roles (e.g. the admin team). */
export async function notifyRoles(roles: Role[], input: NotificationInput, exceptUserId?: string): Promise<void> {
  try {
    const users = await prisma.user.findMany({ where: { role: { in: roles } }, select: { id: true } });
    await notifyUsers(users.map((u) => u.id), input, exceptUserId);
  } catch (err) {
    console.error("[notifications] failed to resolve recipients", err);
    reportError(err);
  }
}

export async function listForUser(userId: string): Promise<{ items: PublicNotification[]; unread: number }> {
  const [rows, unread] = await Promise.all([
    prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.notification.count({ where: { userId, readAt: null } }),
  ]);
  return { items: rows.map(toPublic), unread };
}

export async function markRead(userId: string, id: string): Promise<void> {
  await prisma.notification.updateMany({ where: { id, userId, readAt: null }, data: { readAt: new Date() } });
}

export async function markAllRead(userId: string): Promise<void> {
  await prisma.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Global cleanup so the table doesn't grow without bound: read notifications are removed
 * once they've been read for a day; unread ones are kept up to 30 days so nothing unseen
 * vanishes. Run daily from index.ts.
 */
export async function pruneOld(): Promise<void> {
  const now = Date.now();
  await prisma.notification.deleteMany({
    where: {
      OR: [
        { readAt: { lt: new Date(now - DAY_MS) } },
        { createdAt: { lt: new Date(now - 30 * DAY_MS) } },
      ],
    },
  });
}
