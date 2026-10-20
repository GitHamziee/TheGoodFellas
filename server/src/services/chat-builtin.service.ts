import type { ChatRoom, Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { ROOM_LABEL, parseRoom, rolesWithRoom, roomsFor, type RoomKey } from "../lib/chat-rooms";
import { notifyUsers } from "./notification.service";
import type { ServiceResult } from "../lib/service-result";


const MAX_NAME_LENGTH = 60;

/**
 * Admin edits to the built-in channels (Closers, Junior Closers, ...). Their membership still
 * comes from role; an edit is stored as a rename plus the smallest per-person override:
 * adding someone the role rule doesn't cover, or excluding someone it does.
 */

function builtinRoom(value: unknown): ChatRoom | null {
  const room = parseRoom(value);
  return room && !room.startsWith("g_") ? (room as ChatRoom) : null;
}

/** Everyone who can currently open a built-in channel: role rule, adjusted by overrides. */
async function builtinRoster(room: ChatRoom) {
  const overrides = await prisma.chatRoomOverride.findMany({ where: { room } });
  const denied = overrides.filter((o) => !o.allowed).map((o) => o.userId);
  const added = overrides.filter((o) => o.allowed).map((o) => o.userId);
  return prisma.user.findMany({
    where: {
      OR: [{ role: { in: rolesWithRoom(room) }, id: { notIn: denied } }, { id: { in: added } }],
    },
    select: { id: true, name: true, role: true },
    orderBy: { name: "asc" },
  });
}

export async function getBuiltinRoster(
  roomParam: unknown
): Promise<ServiceResult<{ room: ChatRoom; label: string; members: Awaited<ReturnType<typeof builtinRoster>> }>> {
  const room = builtinRoom(roomParam);
  if (!room) return { error: "Unknown channel", status: 404 };
  const custom = await prisma.chatRoomLabel.findUnique({ where: { room } });
  return { data: { room, label: custom?.label ?? ROOM_LABEL[room], members: await builtinRoster(room) } };
}

export async function updateBuiltin(
  requester: { id: string; name: string },
  roomParam: unknown,
  input: { name: unknown; memberIds: unknown }
): Promise<ServiceResult<{ room: RoomKey; addedIds: string[]; removedIds: string[]; keptIds: string[] }>> {
  const room = builtinRoom(roomParam);
  if (!room) return { error: "Unknown channel", status: 404 };

  let label: string | null = null;
  if (input.name !== undefined) {
    label = typeof input.name === "string" ? input.name.trim() : "";
    if (label === "") return { error: "Channel name is required", status: 400 };
    if (label.length > MAX_NAME_LENGTH) {
      return { error: `Channel name cannot exceed ${MAX_NAME_LENGTH} characters`, status: 400 };
    }
  }

  const roster = await builtinRoster(room);
  const current = new Set(roster.map((u) => u.id));
  let desired = current;
  if (input.memberIds !== undefined) {
    if (!Array.isArray(input.memberIds) || !input.memberIds.every((id) => typeof id === "string")) {
      return { error: "Members must be a list of user ids", status: 400 };
    }
    // The editing admin always stays in, so an edit can't lock you out.
    desired = new Set([...(input.memberIds as string[]), requester.id]);
  }
  const addedIds = [...desired].filter((id) => !current.has(id));
  const removedIds = [...current].filter((id) => !desired.has(id));

  const users = await prisma.user.findMany({
    where: { id: { in: [...addedIds, ...removedIds] } },
    select: { id: true, role: true },
  });
  if (users.length !== addedIds.length + removedIds.length) {
    return { error: "One or more selected people were not found", status: 400 };
  }
  const byRole = new Map(users.map((u) => [u.id, u.role]));
  const roleHas = (id: string) => (roomsFor(byRole.get(id)!) as string[]).includes(room);

  const ops: Prisma.PrismaPromise<unknown>[] = [
    ...addedIds.map((userId) =>
      roleHas(userId)
        ? prisma.chatRoomOverride.deleteMany({ where: { room, userId } })
        : prisma.chatRoomOverride.upsert({
            where: { room_userId: { room, userId } },
            create: { room, userId, allowed: true },
            update: { allowed: true },
          })
    ),
    ...removedIds.map((userId) =>
      roleHas(userId)
        ? prisma.chatRoomOverride.upsert({
            where: { room_userId: { room, userId } },
            create: { room, userId, allowed: false },
            update: { allowed: false },
          })
        : prisma.chatRoomOverride.deleteMany({ where: { room, userId } })
    ),
  ];
  if (label !== null) {
    ops.push(
      label === ROOM_LABEL[room]
        ? prisma.chatRoomLabel.deleteMany({ where: { room } })
        : prisma.chatRoomLabel.upsert({ where: { room }, create: { room, label }, update: { label } })
    );
  }
  await prisma.$transaction(ops);

  const shownName = label ?? ROOM_LABEL[room];
  void notifyUsers(addedIds, {
    kind: "info",
    title: "Added to a channel",
    message: `${requester.name} added you to "${shownName}"`,
    page: "CHAT",
  });
  void notifyUsers(removedIds, {
    kind: "warning",
    title: "Removed from a channel",
    message: `${requester.name} removed you from "${shownName}"`,
  });

  return { data: { room, addedIds, removedIds, keptIds: [...desired].filter((id) => current.has(id)) } };
}
