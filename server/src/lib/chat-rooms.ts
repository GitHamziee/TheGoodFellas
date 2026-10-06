import type { ChatRoom, Role } from "@prisma/client";

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

export function canAccessRoom(role: Role, room: ChatRoom): boolean {
  return roomsFor(role).includes(room);
}

const ROOM_VALUES: readonly string[] = ["CLOSERS", "JUNIOR_CLOSERS", "TEAM_LEADS", "RETENTION"];

/** Narrows an untrusted route/socket param to a real ChatRoom. */
export function parseRoom(value: unknown): ChatRoom | null {
  return typeof value === "string" && ROOM_VALUES.includes(value) ? (value as ChatRoom) : null;
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
export function socketRoom(room: ChatRoom): string {
  return `chat:${room}`;
}
