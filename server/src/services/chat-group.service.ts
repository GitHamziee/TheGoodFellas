import type { Role } from "@prisma/client";
import prisma from "../lib/prisma";
import { GROUP_EXCLUDED_ROLES, groupRoomKey, type RoomKey } from "../lib/chat-rooms";
import { notifyUsers } from "./notification.service";
import type { ServiceResult } from "../lib/service-result";


const MAX_NAME_LENGTH = 60;

/** Everyone an admin may add to a group (never the caller). Drives the picker. */
export async function listGroupCandidates(requesterId: string, everyone = false) {
  const users = await prisma.user.findMany({
    // Editing a built-in channel can involve any role; custom groups keep the exclusion list.
    where: { ...(everyone ? {} : { role: { notIn: [...GROUP_EXCLUDED_ROLES] } }), id: { not: requesterId } },
    select: { id: true, name: true, role: true },
    orderBy: { name: "asc" },
  });
  return { users };
}

/**
 * Creates a group with the creator plus the picked members, all added immediately —
 * no accept step. Each added person gets a notification (persisted + live toast).
 */
export async function createGroup(
  requester: { id: string; name: string; role: Role },
  input: { name: unknown; memberIds: unknown }
): Promise<ServiceResult<{ room: RoomKey; memberIds: string[]; name: string }>> {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (name === "") return { error: "Group name is required", status: 400 };
  if (name.length > MAX_NAME_LENGTH) {
    return { error: `Group name cannot exceed ${MAX_NAME_LENGTH} characters`, status: 400 };
  }

  if (!Array.isArray(input.memberIds) || !input.memberIds.every((id) => typeof id === "string")) {
    return { error: "Members must be a list of user ids", status: 400 };
  }
  const picked = [...new Set((input.memberIds as string[]).filter((id) => id !== requester.id))];
  if (picked.length === 0) return { error: "Pick at least one member", status: 400 };

  const users = await prisma.user.findMany({
    where: { id: { in: picked }, role: { notIn: [...GROUP_EXCLUDED_ROLES] } },
    select: { id: true },
  });
  if (users.length !== picked.length) {
    return { error: "One or more selected people cannot be added to a group", status: 400 };
  }

  const group = await prisma.chatGroup.create({
    data: {
      name,
      createdById: requester.id,
      members: { create: [requester.id, ...picked].map((userId) => ({ userId })) },
    },
  });

  void notifyUsers(picked, {
    kind: "info",
    title: "Added to a group",
    message: `${requester.name} added you to "${name}"`,
    page: "CHAT",
  });

  return { data: { room: groupRoomKey(group.id), memberIds: [requester.id, ...picked], name } };
}

/**
 * Edits a group: rename and/or set the full member list. `memberIds` is the desired roster —
 * the server diffs it against the current one. The requesting admin always stays in (so an
 * edit can never lock you out of your own group), and only *newly added* people have to pass
 * the eligibility check, so a member whose role changed later isn't blocked from staying.
 */
export async function updateGroup(
  requester: { id: string; name: string },
  groupId: string,
  input: { name: unknown; memberIds: unknown }
): Promise<
  ServiceResult<{ room: RoomKey; addedIds: string[]; removedIds: string[]; keptIds: string[] }>
> {
  const group = await prisma.chatGroup.findUnique({
    where: { id: groupId },
    include: { members: { select: { userId: true } } },
  });
  if (!group) return { error: "Group not found", status: 404 };

  let name = group.name;
  if (input.name !== undefined) {
    name = typeof input.name === "string" ? input.name.trim() : "";
    if (name === "") return { error: "Group name is required", status: 400 };
    if (name.length > MAX_NAME_LENGTH) {
      return { error: `Group name cannot exceed ${MAX_NAME_LENGTH} characters`, status: 400 };
    }
  }

  const current = new Set(group.members.map((m) => m.userId));
  let desired = current;
  if (input.memberIds !== undefined) {
    if (!Array.isArray(input.memberIds) || !input.memberIds.every((id) => typeof id === "string")) {
      return { error: "Members must be a list of user ids", status: 400 };
    }
    desired = new Set([...(input.memberIds as string[]), requester.id]);
  }

  const addedIds = [...desired].filter((id) => !current.has(id));
  const removedIds = [...current].filter((id) => !desired.has(id));

  if (addedIds.length > 0) {
    const eligible = await prisma.user.findMany({
      where: { id: { in: addedIds }, role: { notIn: [...GROUP_EXCLUDED_ROLES] } },
      select: { id: true },
    });
    if (eligible.length !== addedIds.length) {
      return { error: "One or more selected people cannot be added to a group", status: 400 };
    }
  }
  if (desired.size < 2) return { error: "A group needs at least one other member", status: 400 };

  await prisma.$transaction([
    prisma.chatGroup.update({ where: { id: groupId }, data: { name } }),
    prisma.chatGroupMember.deleteMany({ where: { groupId, userId: { in: removedIds } } }),
    prisma.chatGroupMember.createMany({ data: addedIds.map((userId) => ({ groupId, userId })) }),
  ]);

  void notifyUsers(addedIds, {
    kind: "info",
    title: "Added to a group",
    message: `${requester.name} added you to "${name}"`,
    page: "CHAT",
  });
  void notifyUsers(removedIds, {
    kind: "warning",
    title: "Removed from a group",
    message: `${requester.name} removed you from "${name}"`,
  });

  return {
    data: {
      room: groupRoomKey(groupId),
      addedIds,
      removedIds,
      keptIds: [...desired].filter((id) => current.has(id)),
    },
  };
}

/**
 * Deletes a group together with its whole history (messages, read cursors). Returns the
 * on-disk attachment names so the route can unlink them after the rows are gone.
 */
export async function deleteGroup(
  requester: { name: string },
  groupId: string
): Promise<ServiceResult<{ room: RoomKey; memberIds: string[]; files: string[] }>> {
  const group = await prisma.chatGroup.findUnique({
    where: { id: groupId },
    include: { members: { select: { userId: true } } },
  });
  if (!group) return { error: "Group not found", status: 404 };

  const room = groupRoomKey(groupId);
  const withFiles = await prisma.chatMessage.findMany({
    where: { room, attachmentPath: { not: null } },
    select: { attachmentPath: true },
  });

  await prisma.$transaction([
    prisma.chatMessage.deleteMany({ where: { room } }),
    prisma.chatRead.deleteMany({ where: { room } }),
    prisma.chatGroup.delete({ where: { id: groupId } }),
  ]);

  const memberIds = group.members.map((m) => m.userId);
  void notifyUsers(memberIds, {
    kind: "warning",
    title: "Group deleted",
    message: `${requester.name} deleted the group "${group.name}"`,
  });

  return {
    data: { room, memberIds, files: withFiles.map((m) => m.attachmentPath!).filter(Boolean) },
  };
}
