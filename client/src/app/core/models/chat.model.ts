import { Role } from './user.model';

export type ChatRoomKey = 'CLOSERS' | 'JUNIOR_CLOSERS' | 'TEAM_LEADS' | 'RETENTION';

export interface ChatSender {
  id: string;
  name: string;
  role: Role;
}

export interface ChatAttachment {
  name: string;
  /** MIME type — drives whether the bubble shows an inline image preview or a file chip. */
  type: string | null;
  size: number | null;
  /** Relative API path — always fetched through HttpClient (so the auth header attaches),
   * never used directly as an <img>/<a> src. */
  url: string;
}

export interface ChatMessage {
  id: string;
  room: ChatRoomKey;
  /** Empty string when `deleted`, or when the message is a bare file upload with no caption. */
  body: string;
  deleted: boolean;
  edited: boolean;
  createdAt: string;
  sender: ChatSender;
  /** Null when `deleted` too — the server drops the file the same way it drops the body text. */
  attachment: ChatAttachment | null;
}

export interface ChatRoomSummary {
  room: ChatRoomKey;
  unread: number;
  lastMessage: ChatMessage | null;
}

export interface TypingUser {
  userId: string;
  name: string;
}

// Display names only — mirrors server/src/lib/chat-rooms.ts's ROOM_LABEL. The ChatRoomKey
// values themselves stay TEAM_LEADS/RETENTION; only what's shown to the user changed.
export const CHAT_ROOM_LABEL: Record<ChatRoomKey, string> = {
  CLOSERS: 'Closers',
  JUNIOR_CLOSERS: 'Junior Closers',
  TEAM_LEADS: 'Management',
  RETENTION: 'Retention Department',
};

/**
 * Mirrors `roomsFor()` on the server — used only to decide what to render (nav item,
 * room switcher). The server re-checks every read and write; this is not the boundary.
 */
export const CHAT_ROOMS_BY_ROLE: Record<Role, ChatRoomKey[]> = {
  CLOSER: ['CLOSERS'],
  JUNIOR_CLOSER: ['JUNIOR_CLOSERS'],
  // Oversees both roles, so it sits in both of their channels (Closer, Junior Closer, and
  // Admin) plus its own channel for team-lead-to-team-lead + admin.
  TEAM_LEAD: ['CLOSERS', 'JUNIOR_CLOSERS', 'TEAM_LEADS'],
  RETENTION: ['RETENTION'],
  ADMIN: ['CLOSERS', 'JUNIOR_CLOSERS', 'TEAM_LEADS', 'RETENTION'],
  // Same access as ADMIN — the Clients/Team/External Clients/Expenses exclusion is
  // page-level, not a chat restriction.
  MANAGER: ['CLOSERS', 'JUNIOR_CLOSERS', 'TEAM_LEADS', 'RETENTION'],
  CLIENT: [],
  // Internal metrics roles, not part of team chat — see server/src/lib/chat-rooms.ts.
  QA_JUNIOR_CLOSER: [],
  QA_CLOSER: [],
};
