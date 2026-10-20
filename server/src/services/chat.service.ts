import type { Role } from "@prisma/client";
import prisma from "../lib/prisma";
import { canAccessRoom, groupIdOf, isGroupRoom, roomsForUser, ROOM_LABEL, type RoomKey } from "../lib/chat-rooms";
import type { ServiceResult } from "../lib/service-result";


export interface Requester {
  id: string;
  role: Role;
}

/** Max characters in one message — long enough for a paragraph, short enough to bound the row. */
export const MAX_BODY_LENGTH = 4000;
/** Generous for docs/images, bounds disk usage — enforced again at the multer layer in the route. */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
const DEFAULT_PAGE_SIZE = 30;
const MAX_PAGE_SIZE = 100;
const MIN_SEARCH_LENGTH = 2;
const SEARCH_LIMIT = 30;
/** Window around a searched-for message: some context above, the rest of the way down (capped). */
const AROUND_OLDER = 20;
const AROUND_NEWER = 150;

// Sender is joined on every read so the UI can render name/role without a second lookup.
const MESSAGE_INCLUDE = {
  sender: { select: { id: true, name: true, role: true } },
} as const;

type MessageRow = {
  id: string;
  room: string;
  senderId: string;
  body: string;
  editedAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  attachmentName: string | null;
  attachmentType: string | null;
  attachmentSize: number | null;
  sender: { id: string; name: string; role: Role };
};

/** Everything the multer middleware hands the service about an already-saved upload. */
export interface UploadedFile {
  originalName: string;
  mimeType: string;
  size: number;
  /** Filename on disk under server/uploads/chat/ — never sent to the client. */
  diskName: string;
}

/**
 * Wire shape for one message. A soft-deleted message keeps its slot in the timeline but
 * its body — and its attachment, the same way — never leaves the server; the client gets
 * `deleted: true` and renders a tombstone instead.
 */
function publicMessage(m: MessageRow) {
  const attachment =
    !m.deletedAt && m.attachmentName
      ? {
          name: m.attachmentName,
          type: m.attachmentType,
          size: m.attachmentSize,
          // Proxied through the authenticated download route below rather than a direct
          // disk/static URL, so room membership still gates attachments the same way it
          // gates message text.
          url: `/api/chat/attachments/${m.id}`,
        }
      : null;

  return {
    id: m.id,
    room: m.room as RoomKey,
    body: m.deletedAt ? "" : m.body,
    deleted: m.deletedAt !== null,
    edited: m.editedAt !== null,
    createdAt: m.createdAt,
    sender: m.sender,
    attachment,
  };
}

export type PublicMessage = ReturnType<typeof publicMessage>;

/**
 * The rooms this person can open, each with an unread count and a one-line preview.
 * Drives both the sidebar badge and the admin's room switcher.
 */
export async function listRooms(requester: Requester) {
  const rooms = await roomsForUser(requester);
  if (rooms.length === 0) return { rooms: [] };

  const groupIds = rooms.filter(isGroupRoom).map(groupIdOf);
  const [reads, groups, labelRows] = await Promise.all([
    prisma.chatRead.findMany({ where: { userId: requester.id, room: { in: rooms } } }),
    prisma.chatGroup.findMany({
      where: { id: { in: groupIds } },
      select: {
        id: true,
        name: true,
        members: { select: { user: { select: { id: true, name: true, role: true } } } },
      },
    }),
    prisma.chatRoomLabel.findMany(),
  ]);
  const readAt = new Map(reads.map((r) => [r.room, r.lastReadAt]));
  const groupById = new Map(groups.map((g) => [g.id, g]));
  const customLabel = new Map(labelRows.map((l) => [l.room, l.label]));

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

      const group = isGroupRoom(room) ? groupById.get(groupIdOf(room)) : undefined;
      return {
        room,
        label: group ? group.name : (customLabel.get(room) ?? ROOM_LABEL[room as keyof typeof ROOM_LABEL]),
        // Only custom groups carry an explicit roster; built-in channels derive theirs from role.
        members: group ? group.members.map((m) => m.user) : null,
        unread,
        lastMessage: latest ? publicMessage(latest) : null,
      };
    })
  );

  return { rooms: summaries };
}

/** Display name for a room, used in message-list responses. */
export async function labelFor(room: RoomKey): Promise<string> {
  if (isGroupRoom(room)) {
    const group = await prisma.chatGroup.findUnique({ where: { id: groupIdOf(room) }, select: { name: true } });
    return group?.name ?? "Group";
  }
  const custom = await prisma.chatRoomLabel.findUnique({ where: { room } });
  return custom?.label ?? ROOM_LABEL[room as keyof typeof ROOM_LABEL];
}

/**
 * Newest-first page of a room's history, returned oldest-first for direct rendering.
 * `before` is a message id — pass the oldest message you hold to page further back.
 */
export async function listMessages(
  room: RoomKey,
  requester: Requester,
  opts: { before?: unknown; limit?: unknown; around?: unknown } = {}
): Promise<ServiceResult<{ messages: PublicMessage[]; hasMore: boolean; hasNewer: boolean }>> {
  if (!(await canAccessRoom(requester, room))) {
    return { error: "You do not have access to this channel", status: 403 };
  }

  // Jump-to-message (from search): a window centred on the target instead of the newest page.
  if (typeof opts.around === "string" && opts.around !== "") {
    const anchor = await prisma.chatMessage.findUnique({
      where: { id: opts.around },
      select: { createdAt: true, room: true },
    });
    if (anchor && anchor.room === room) {
      const [older, newer] = await Promise.all([
        prisma.chatMessage.findMany({
          where: { room, createdAt: { lt: anchor.createdAt } },
          orderBy: { createdAt: "desc" },
          take: AROUND_OLDER + 1,
          include: MESSAGE_INCLUDE,
        }),
        prisma.chatMessage.findMany({
          where: { room, createdAt: { gte: anchor.createdAt } },
          orderBy: { createdAt: "asc" },
          take: AROUND_NEWER + 1,
          include: MESSAGE_INCLUDE,
        }),
      ]);
      const hasMore = older.length > AROUND_OLDER;
      const hasNewer = newer.length > AROUND_NEWER;
      const rows = [...older.slice(0, AROUND_OLDER).reverse(), ...newer.slice(0, AROUND_NEWER)];
      return { data: { messages: rows.map(publicMessage), hasMore, hasNewer } };
    }
    // Unknown / other-room id: fall through to the normal newest page.
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

  return { data: { messages: page.reverse().map(publicMessage), hasMore, hasNewer: false } };
}

/**
 * Case-insensitive search across every channel the caller belongs to (message text and
 * attachment filenames). Membership comes from roomsFor(), the same chokepoint as everything
 * else, so a role can never search a channel it cannot open. Newest matches first.
 */
export async function searchMessages(
  requester: Requester,
  query: unknown,
  room?: RoomKey
): Promise<ServiceResult<{ results: PublicMessage[] }>> {
  if (room && !(await canAccessRoom(requester, room))) {
    return { error: "You do not have access to this channel", status: 403 };
  }

  const term = typeof query === "string" ? query.trim().slice(0, 100) : "";
  const rooms = room ? [room] : await roomsForUser(requester);
  if (term.length < MIN_SEARCH_LENGTH || rooms.length === 0) return { data: { results: [] } };

  const rows = await prisma.chatMessage.findMany({
    where: {
      room: { in: rooms },
      deletedAt: null,
      OR: [
        { body: { contains: term, mode: "insensitive" } },
        { attachmentName: { contains: term, mode: "insensitive" } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: SEARCH_LIMIT,
    include: MESSAGE_INCLUDE,
  });

  return { data: { results: rows.map(publicMessage) } };
}

export async function sendMessage(
  room: RoomKey,
  requester: Requester,
  body: unknown
): Promise<ServiceResult<{ message: PublicMessage }>> {
  if (!(await canAccessRoom(requester, room))) {
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

/**
 * Sends a file/doc as its own message — the caption is optional, unlike sendMessage's body,
 * since "just a file, no comment" is the common case. The route has already saved the file
 * to disk (via multer) by the time this runs; this only ever touches the DB row.
 */
export async function sendFileMessage(
  room: RoomKey,
  requester: Requester,
  file: UploadedFile,
  caption: unknown
): Promise<ServiceResult<{ message: PublicMessage }>> {
  if (!(await canAccessRoom(requester, room))) {
    return { error: "You do not have access to this channel", status: 403 };
  }

  const trimmedCaption = typeof caption === "string" ? caption.trim() : "";
  if (trimmedCaption.length > MAX_BODY_LENGTH) {
    return { error: `Message cannot exceed ${MAX_BODY_LENGTH} characters`, status: 400 };
  }

  const created = await prisma.chatMessage.create({
    data: {
      room,
      senderId: requester.id,
      body: trimmedCaption,
      attachmentName: file.originalName,
      attachmentType: file.mimeType,
      attachmentSize: file.size,
      attachmentPath: file.diskName,
    },
    include: MESSAGE_INCLUDE,
  });

  await touchRead(room, requester.id, created.createdAt);

  return { data: { message: publicMessage(created) } };
}

/**
 * Resolves an attachment download — the same room-membership + not-deleted check that
 * gates message text gates the file behind it, since the file never leaves the server
 * except through this route.
 */
export async function getAttachment(
  messageId: string,
  requester: Requester
): Promise<ServiceResult<{ diskName: string; originalName: string; mimeType: string | null }>> {
  const message = await prisma.chatMessage.findUnique({ where: { id: messageId } });
  if (!message || message.deletedAt || !message.attachmentPath || !message.attachmentName) {
    return { error: "Attachment not found", status: 404 };
  }
  if (!(await canAccessRoom(requester, message.room))) {
    return { error: "You do not have access to this channel", status: 403 };
  }

  return {
    data: {
      diskName: message.attachmentPath,
      originalName: message.attachmentName,
      mimeType: message.attachmentType,
    },
  };
}

export async function editMessage(
  id: string,
  requester: Requester,
  body: unknown
): Promise<ServiceResult<{ message: PublicMessage }>> {
  const existing = await prisma.chatMessage.findUnique({ where: { id } });
  if (!existing || !(await canAccessRoom(requester, existing.room))) {
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
  if (!existing || !(await canAccessRoom(requester, existing.room))) {
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
  room: RoomKey,
  requester: Requester
): Promise<ServiceResult<{ room: RoomKey; lastReadAt: Date }>> {
  if (!(await canAccessRoom(requester, room))) {
    return { error: "You do not have access to this channel", status: 403 };
  }

  const lastReadAt = new Date();
  await touchRead(room, requester.id, lastReadAt);
  return { data: { room, lastReadAt } };
}

async function touchRead(room: RoomKey, userId: string, at: Date) {
  await prisma.chatRead.upsert({
    where: { userId_room: { userId, room } },
    create: { userId, room, lastReadAt: at },
    update: { lastReadAt: at },
  });
}
