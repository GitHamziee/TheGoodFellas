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
 *   TEAM_LEAD     → TEAM_LEADS only (its own channel — not CLOSERS/JUNIOR_CLOSERS)
 *   ADMIN         → all three (this is how each group talks to admin)
 *   CLIENT        → none (clients are outside the org, no chat access at all)
 */
export function roomsFor(role: Role): ChatRoom[] {
  switch (role) {
    case "CLOSER":
      return ["CLOSERS"];
    case "JUNIOR_CLOSER":
      return ["JUNIOR_CLOSERS"];
    case "TEAM_LEAD":
      return ["TEAM_LEADS"];
    case "ADMIN":
      return ["CLOSERS", "JUNIOR_CLOSERS", "TEAM_LEADS"];
    case "CLIENT":
      return [];
  }
}

export function canAccessRoom(role: Role, room: ChatRoom): boolean {
  return roomsFor(role).includes(room);
}

const ROOM_VALUES: readonly string[] = ["CLOSERS", "JUNIOR_CLOSERS", "TEAM_LEADS"];

/** Narrows an untrusted route/socket param to a real ChatRoom. */
export function parseRoom(value: unknown): ChatRoom | null {
  return typeof value === "string" && ROOM_VALUES.includes(value) ? (value as ChatRoom) : null;
}

export const ROOM_LABEL: Record<ChatRoom, string> = {
  CLOSERS: "Closers",
  JUNIOR_CLOSERS: "Junior Closers",
  TEAM_LEADS: "Team Leads",
};

/** Socket.IO room name — namespaced so it can't collide with any future per-user room. */
export function socketRoom(room: ChatRoom): string {
  return `chat:${room}`;
}
