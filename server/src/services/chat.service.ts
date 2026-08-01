import type { ChatRoom, Role } from "@prisma/client";
import prisma from "../lib/prisma";
import { canAccessRoom, roomsFor } from "../lib/chat-rooms";

type ServiceResult<T> = { data: T; status?: never } | { error: string; status: number };

export interface Requester {
  id: string;
  role: Role;
}

/** Max characters in one message — long enough for a paragraph, short enough to bound the row. */
export const MAX_BODY_LENGTH = 4000;
const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 100;

// Sender is joined on every read so the UI can render name/role without a second lookup.
const MESSAGE_INCLUDE = {
  sender: { select: { id: true, name: true, role: true } },
} as const;

type MessageRow = {
  id: string;
  room: ChatRoom;
  senderId: string;
  body: string;
  editedAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  sender: { id: string; name: string; role: Role };
};

/**
 * Wire shape for one message. A soft-deleted message keeps its slot in the timeline but
 * its body never leaves the server — the client gets `deleted: true` and renders a tombstone.
 */
function publicMessage(m: MessageRow) {
  return {
    id: m.id,
    room: m.room,
    body: m.deletedAt ? "" : m.body,
    deleted: m.deletedAt !== null,
    edited: m.editedAt !== null,
    createdAt: m.createdAt,
    sender: m.sender,
  };
}

export type PublicMessage = ReturnType<typeof publicMessage>;

/**
 * The rooms this person can open, each with an unread count and a one-line preview.
 * Drives both the sidebar badge and the admin's room switcher.
 */
export async function listRooms(requester: Requester) {
  const rooms = roomsFor(requester.role);
  if (rooms.length === 0) return { rooms: [] };

  const reads = await prisma.chatRead.findMany({
    where: { userId: requester.id, room: { in: rooms } },
  });
  const readAt = new Map(reads.map((r) => [r.room, r.lastReadAt]));

  const summaries = await Promise.all(
    rooms.map(async (room) => {
      const since = readAt.get(room);
      const [unread, latest] = await Promise.all([
        prisma.chatMessage.count({
          where: {
            room,
            deletedAt: null,
            // Your own messages never count as unread.
            senderId: { not: requester.id },
            ...(since ? { createdAt: { gt: since } } : {}),
          },
        }),
        prisma.chatMessage.findFirst({
          where: { room, deletedAt: null },
          orderBy: { createdAt: "desc" },
          include: MESSAGE_INCLUDE,
        }),
      ]);

      return {
        room,
        unread,
        lastMessage: latest ? publicMessage(latest) : null,
      };
    })
  );

  return { rooms: summaries };
}

/**
 * Newest-first page of a room's history, returned oldest-first for direct rendering.
 * `before` is a message id — pass the oldest message you hold to page further back.
 */
export async function listMessages(
  room: ChatRoom,
  requester: Requester,
  opts: { before?: unknown; limit?: unknown } = {}
): Promise<ServiceResult<{ messages: PublicMessage[]; hasMore: boolean }>> {
  if (!canAccessRoom(requester.role, room)) {
    return { error: "You do not have access to this channel", status: 403 };
  }

  const limit = Math.min(
    Number.isFinite(Number(opts.limit)) && Number(opts.limit) > 0 ? Number(opts.limit) : DEFAULT_PAGE_SIZE,
    MAX_PAGE_SIZE
  );

  let cursorDate: Date | undefined;
  if (typeof opts.before === "string" && opts.before !== "") {
    const anchor = await prisma.chatMessage.findUnique({
      where: { id: opts.before },
      select: { createdAt: true, room: true },
    });
    // Ignore a cursor pointing at another room rather than leaking that it exists.
    if (anchor && anchor.room === room) cursorDate = anchor.createdAt;
  }

  // Fetch one extra to detect whether an older page exists.
  const rows = await prisma.chatMessage.findMany({
    where: { room, ...(cursorDate ? { createdAt: { lt: cursorDate } } : {}) },
    orderBy: { createdAt: "desc" },
    take: limit + 1,
    include: MESSAGE_INCLUDE,
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  return { data: { messages: page.reverse().map(publicMessage), hasMore } };
}

export async function sendMessage(
  room: ChatRoom,
  requester: Requester,
  body: unknown
): Promise<ServiceResult<{ message: PublicMessage }>> {
  if (!canAccessRoom(requester.role, room)) {
    return { error: "You do not have access to this channel", status: 403 };
  }
  if (typeof body !== "string") return { error: "Message is required", status: 400 };

  const trimmed = body.trim();
  if (trimmed === "") return { error: "Message cannot be empty", status: 400 };
  if (trimmed.length > MAX_BODY_LENGTH) {
    return { error: `Message cannot exceed ${MAX_BODY_LENGTH} characters`, status: 400 };
  }

  const created = await prisma.chatMessage.create({
    data: { room, senderId: requester.id, body: trimmed },
    include: MESSAGE_INCLUDE,
  });

  // Sending is an implicit read — otherwise your own message leaves the room "unread".
  await touchRead(room, requester.id, created.createdAt);

  return { data: { message: publicMessage(created) } };
}

export async function editMessage(
  id: string,
  requester: Requester,
  body: unknown
): Promise<ServiceResult<{ message: PublicMessage }>> {
  const existing = await prisma.chatMessage.findUnique({ where: { id } });
  if (!existing || !canAccessRoom(requester.role, existing.room)) {
    return { error: "Message not found", status: 404 };
  }
  // Editing is author-only — admins can remove a message but never rewrite someone's words.
  if (existing.senderId !== requester.id) return { error: "You can only edit your own messages", status: 403 };
  if (existing.deletedAt) return { error: "This message was deleted", status: 400 };

  if (typeof body !== "string") return { error: "Message is required", status: 400 };
  const trimmed = body.trim();
  if (trimmed === "") return { error: "Message cannot be empty", status: 400 };
  if (trimmed.length > MAX_BODY_LENGTH) {
    return { error: `Message cannot exceed ${MAX_BODY_LENGTH} characters`, status: 400 };
  }

  const updated = await prisma.chatMessage.update({
    where: { id },
    data: { body: trimmed, editedAt: new Date() },
    include: MESSAGE_INCLUDE,
  });

  return { data: { message: publicMessage(updated) } };
}

/** Author can delete their own; ADMIN can delete anything in a room they belong to (moderation). */
export async function deleteMessage(
  id: string,
  requester: Requester
): Promise<ServiceResult<{ message: PublicMessage }>> {
  const existing = await prisma.chatMessage.findUnique({ where: { id } });
  if (!existing || !canAccessRoom(requester.role, existing.room)) {
    return { error: "Message not found", status: 404 };
  }

  const isAuthor = existing.senderId === requester.id;
  if (!isAuthor && requester.role !== "ADMIN") {
    return { error: "You can only delete your own messages", status: 403 };
  }
  if (existing.deletedAt) {
    // Already gone — return it as-is so a double-click is a no-op, not an error.
    const current = await prisma.chatMessage.findUniqueOrThrow({ where: { id }, include: MESSAGE_INCLUDE });
    return { data: { message: publicMessage(current) } };
  }

  const updated = await prisma.chatMessage.update({
    where: { id },
    data: { deletedAt: new Date() },
    include: MESSAGE_INCLUDE,
  });

  return { data: { message: publicMessage(updated) } };
}

export async function markRead(
  room: ChatRoom,
  requester: Requester
): Promise<ServiceResult<{ room: ChatRoom; lastReadAt: Date }>> {
  if (!canAccessRoom(requester.role, room)) {
    return { error: "You do not have access to this channel", status: 403 };
  }

  const lastReadAt = new Date();
  await touchRead(room, requester.id, lastReadAt);
  return { data: { room, lastReadAt } };
}

async function touchRead(room: ChatRoom, userId: string, at: Date) {
  await prisma.chatRead.upsert({
    where: { userId_room: { userId, room } },
    create: { userId, room, lastReadAt: at },
    update: { lastReadAt: at },
  });
}
