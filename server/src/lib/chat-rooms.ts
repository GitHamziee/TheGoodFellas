import type { ChatRoom, Role } from "@prisma/client";
import prisma from "./prisma";

/** A built-in channel name, or `g_<ChatGroup.id>` for an admin-created group. */
export type RoomKey = ChatRoom | `g_${string}`;

/**
 * The whole access model for chat lives here.
 *
 * Membership is *derived from role*, never stored per-user and never taken from the
 * request — the client tells us which room it wants to read, and we check it against
 * this, exactly like lead.service.ts#getLeadById is the chokepoint for lead masking.
 *
 *   CLOSER        → CLOSERS only
 *   JUNIOR_CLOSER → JUNIOR_CLOSERS only
 *   TEAM_LEAD     → CLOSERS + JUNIOR_CLOSERS + TEAM_LEADS — oversees both roles, so it
 *                   sits in both of their channels (talks to Closer, Junior Closer, and
 *                   Admin there) plus its own channel, labelled "Management" (Team Lead +
 *                   Manager + Admin — see ROOM_LABEL below)
 *   RETENTION     → RETENTION only, labelled "Retention Department" (Retention + Manager
 *                   + Admin — same pattern as TEAM_LEADS)
 *   ADMIN         → all four (this is how each group talks to admin)
 *   MANAGER       → all four, same as ADMIN (everything but Clients/Team/External
 *                   Clients/Expenses — chat isn't part of that exclusion)
 *   CLIENT        → none (clients are outside the org, no chat access at all)
 *   QA_JUNIOR_CLOSER, QA_CLOSER → none (internal metrics roles, not part of team chat)
 */
export function roomsFor(role: Role): ChatRoom[] {
  switch (role) {
    case "CLOSER":
      return ["CLOSERS"];
    case "JUNIOR_CLOSER":
      return ["JUNIOR_CLOSERS"];
    case "TEAM_LEAD":
      return ["CLOSERS", "JUNIOR_CLOSERS", "TEAM_LEADS"];
    case "RETENTION":
      return ["RETENTION"];
    case "ADMIN":
    case "MANAGER":
      return ["CLOSERS", "JUNIOR_CLOSERS", "TEAM_LEADS", "RETENTION"];
    case "CLIENT":
    case "QA_JUNIOR_CLOSER":
    case "QA_CLOSER":
      return [];
  }
}

const BUILTIN_ROOMS: readonly string[] = ["CLOSERS", "JUNIOR_CLOSERS", "TEAM_LEADS", "RETENTION"];
const GROUP_PREFIX = "g_";

export const isGroupRoom = (room: string): room is `g_${string}` => room.startsWith(GROUP_PREFIX);
export const groupRoomKey = (groupId: string): RoomKey => `${GROUP_PREFIX}${groupId}`;
export const groupIdOf = (room: string): string => room.slice(GROUP_PREFIX.length);

/**
 * Roles an admin can NOT add to a custom group — they already have their own team channels.
 * Everyone else (other admins, managers, team leads, clients) is eligible. Single source of
 * truth: the group-candidates list and group creation both read this.
 */
export const GROUP_EXCLUDED_ROLES: readonly Role[] = [
  "JUNIOR_CLOSER",
  "CLOSER",
  "QA_JUNIOR_CLOSER",
  "QA_CLOSER",
  "RETENTION",
];

const ALL_ROLES: Role[] = [
  "JUNIOR_CLOSER",
  "CLOSER",
  "ADMIN",
  "CLIENT",
  "TEAM_LEAD",
  "QA_JUNIOR_CLOSER",
  "QA_CLOSER",
  "RETENTION",
  "MANAGER",
];

/** Roles whose built-in rule includes this channel. */
export function rolesWithRoom(room: ChatRoom): Role[] {
  return ALL_ROLES.filter((r) => roomsFor(r).includes(room));
}

/**
 * Built-in channels (role rule, adjusted by per-person admin overrides) plus every custom
 * group this user belongs to.
 */
export async function roomsForUser(user: { id: string; role: Role }): Promise<RoomKey[]> {
  const [memberships, overrides] = await Promise.all([
    prisma.chatGroupMember.findMany({
      where: { userId: user.id },
      select: { groupId: true },
      orderBy: { addedAt: "asc" },
    }),
    prisma.chatRoomOverride.findMany({ where: { userId: user.id } }),
  ]);
  const denied = new Set(overrides.filter((o) => !o.allowed).map((o) => o.room));
  const extra = overrides.filter((o) => o.allowed).map((o) => o.room as ChatRoom);
  const builtin = [...new Set([...roomsFor(user.role), ...extra])].filter((r) => !denied.has(r));
  return [...builtin, ...memberships.map((m) => groupRoomKey(m.groupId))];
}

/** Built-in rooms follow the role rule unless an admin override says otherwise; a group needs a membership row. */
export async function canAccessRoom(user: { id: string; role: Role }, room: string): Promise<boolean> {
  if (isGroupRoom(room)) {
    const member = await prisma.chatGroupMember.findUnique({
      where: { groupId_userId: { groupId: groupIdOf(room), userId: user.id } },
      select: { userId: true },
    });
    return member !== null;
  }
  if (!BUILTIN_ROOMS.includes(room)) return false;
  const override = await prisma.chatRoomOverride.findUnique({
    where: { room_userId: { room, userId: user.id } },
    select: { allowed: true },
  });
  if (override) return override.allowed;
  return (roomsFor(user.role) as string[]).includes(room);
}

/** Narrows an untrusted route/socket param to a well-formed room key (access is checked separately). */
export function parseRoom(value: unknown): RoomKey | null {
  if (typeof value !== "string") return null;
  if (BUILTIN_ROOMS.includes(value)) return value as ChatRoom;
  return /^g_[A-Za-z0-9]+$/.test(value) ? (value as RoomKey) : null;
}

// Display names only — the ChatRoom enum values themselves (TEAM_LEADS, RETENTION) stay
// as-is so this isn't a data migration, just a relabel. TEAM_LEADS -> "Management" reflects
// who's actually in it (Team Lead + Manager + Admin); RETENTION -> "Retention Department"
// per the same request, membership already being exactly Admin/Manager/Retention below.
export const ROOM_LABEL: Record<ChatRoom, string> = {
  CLOSERS: "Closers",
  JUNIOR_CLOSERS: "Junior Closers",
  TEAM_LEADS: "Management",
  RETENTION: "Retention Department",
};

/** Socket.IO room name — namespaced so it can't collide with any future per-user room. */
export function socketRoom(room: RoomKey): string {
  return `chat:${room}`;
}
