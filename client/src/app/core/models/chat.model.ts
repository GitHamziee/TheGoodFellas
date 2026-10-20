import { Role } from './user.model';

/** A built-in channel name, or `g_<id>` for an admin-created group. */
export type ChatRoomKey = string;

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
  label: string;
  /** Explicit roster for custom groups; null for the built-in role-derived channels. */
  members: ChatSender[] | null;
  unread: number;
  lastMessage: ChatMessage | null;
}

export interface TypingUser {
  userId: string;
  name: string;
}

// Display names only — mirrors server/src/lib/chat-rooms.ts's ROOM_LABEL. The ChatRoomKey
// values themselves stay TEAM_LEADS/RETENTION; only what's shown to the user changed.
export const CHAT_ROOM_LABEL: Record<string, string> = {
  CLOSERS: 'Closers',
  JUNIOR_CLOSERS: 'Junior Closers',
  TEAM_LEADS: 'Management',
  RETENTION: 'Retention Department',
};

/** Roles an admin cannot add to a custom group — mirrors GROUP_EXCLUDED_ROLES on the server. */
export interface GroupCandidate {
  id: string;
  name: string;
  role: Role;
}
