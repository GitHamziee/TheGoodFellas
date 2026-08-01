import { Role } from './user.model';

export type ChatRoomKey = 'CLOSERS' | 'JUNIOR_CLOSERS';

export interface ChatSender {
  id: string;
  name: string;
  role: Role;
}

export interface ChatMessage {
  id: string;
  room: ChatRoomKey;
  /** Empty string when `deleted` — the server never sends a removed message's text. */
  body: string;
  deleted: boolean;
  edited: boolean;
  createdAt: string;
  sender: ChatSender;
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

export const CHAT_ROOM_LABEL: Record<ChatRoomKey, string> = {
  CLOSERS: 'Closers',
  JUNIOR_CLOSERS: 'Junior Closers',
};

/**
 * Mirrors `roomsFor()` on the server — used only to decide what to render (nav item,
 * room switcher). The server re-checks every read and write; this is not the boundary.
 */
export const CHAT_ROOMS_BY_ROLE: Record<Role, ChatRoomKey[]> = {
  CLOSER: ['CLOSERS'],
  JUNIOR_CLOSER: ['JUNIOR_CLOSERS'],
  ADMIN: ['CLOSERS', 'JUNIOR_CLOSERS'],
  CLIENT: [],
};
