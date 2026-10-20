import fs from "fs";
import path from "path";
import crypto from "crypto";
import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import multer from "multer";
import { apiError, apiSuccess, sendResult } from "../lib/api-response";
import prisma from "../lib/prisma";
import { asyncHandler } from "../lib/async-handler";
import { authenticate, requireRole } from "../middleware/auth";
import { canAccessRoom, parseRoom } from "../lib/chat-rooms";
import { emitGroupChanged, emitGroupCreated, emitGroupDeleted, emitMessageCreated, emitMessageUpdated } from "../realtime/chat-gateway";
import * as chatService from "../services/chat.service";
import * as chatGroupService from "../services/chat-group.service";
import * as chatBuiltinService from "../services/chat-builtin.service";

const router = Router();
router.use(authenticate);

/**
 * Writes go over HTTP, not the socket: it reuses `authenticate`, the { data } / { error }
 * contract and real status codes, and keeps validation in one place. The socket is a
 * one-way fan-out channel for what the REST call already persisted.
 */

// ─── Attachments ────────────────────────────────────────────────
// No type restriction — "all type of files and docs" was the explicit ask — just a size
// cap so one upload can't exhaust disk. Stored under a randomized on-disk name (never the
// original filename) so a crafted filename can't escape the upload directory or collide
// with another upload; the real filename only ever appears in the DB row and download headers.
const UPLOAD_DIR = path.join(__dirname, "../../uploads/chat");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOAD_DIR),
    filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: chatService.MAX_ATTACHMENT_BYTES },
});

/** Wraps multer so a rejected upload (too large, malformed multipart) comes back as this
 * API's normal { error } shape instead of falling through to the generic 500 handler. */
function handleUpload(field: string) {
  const middleware = upload.single(field);
  return (req: Request, res: Response, next: NextFunction) => {
    middleware(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          const maxMb = Math.floor(chatService.MAX_ATTACHMENT_BYTES / (1024 * 1024));
          return apiError(res, `File is too large — ${maxMb}MB max`, 400);
        }
        return apiError(res, err.message, 400);
      }
      if (err) return next(err);
      next();
    });
  };
}

/** Same channel check sendFileMessage makes, but run before multer so a request for a room
 * the caller can't post in is refused without its file ever being written to disk. */
const requireRoomAccess = asyncHandler(async (req, res, next) => {
  const room = parseRoom(req.params.room);
  if (!room) return apiError(res, "Unknown channel", 404);
  if (!(await canAccessRoom(req.user!, room))) {
    return apiError(res, "You do not have access to this channel", 403);
  }
  return next();
});

router.post(
  "/:room/messages/file",
  requireRoomAccess,
  handleUpload("file"),
  asyncHandler(async (req, res) => {
    const room = parseRoom(req.params.room);
    if (!room) return apiError(res, "Unknown channel", 404);
    if (!req.file) return apiError(res, "A file is required", 400);

    const result = await chatService.sendFileMessage(
      room,
      req.user!,
      {
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        size: req.file.size,
        diskName: req.file.filename,
      },
      req.body?.body
    );
    if ("error" in result) return apiError(res, result.error, result.status);

    emitMessageCreated(room, result.data.message);
    return apiSuccess(res, result.data, undefined, 201);
  })
);

router.get(
  "/attachments/:messageId",
  asyncHandler(async (req, res) => {
    const result = await chatService.getAttachment(req.params.messageId, req.user!);
    if ("error" in result) return apiError(res, result.error, result.status);

    const filePath = path.join(UPLOAD_DIR, result.data.diskName);
    return res.download(filePath, result.data.originalName, (err) => {
      // download() has already started writing the response by the time this fires for a
      // mid-stream failure — only reachable case for an error here is really "file missing".
      if (err && !res.headersSent) apiError(res, "Attachment not found", 404);
    });
  })
);

// Which channels the caller can open, with unread counts. CLIENT gets an empty list.
router.get(
  "/rooms",
  asyncHandler(async (req, res) => {
    const result = await chatService.listRooms(req.user!);
    return apiSuccess(res, result);
  })
);

// Admin-only: who can be added to a custom group, and creating one.
router.get(
  "/group-candidates",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => apiSuccess(res, await chatGroupService.listGroupCandidates(req.user!.id, req.query.all === "1")))
);

router.post(
  "/groups",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const me = await prisma.user.findUniqueOrThrow({
      where: { id: req.user!.id },
      select: { id: true, name: true, role: true },
    });
    const result = await chatGroupService.createGroup(me, {
      name: req.body?.name,
      memberIds: req.body?.memberIds,
    });
    if ("error" in result) return apiError(res, result.error, result.status);

    emitGroupCreated(result.data.room, result.data.memberIds);
    return apiSuccess(res, { room: result.data.room, name: result.data.name }, undefined, 201);
  })
);

const adminIdentity = (id: string) =>
  prisma.user.findUniqueOrThrow({ where: { id }, select: { id: true, name: true, role: true } });

router.patch(
  "/groups/:id",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const me = await adminIdentity(req.user!.id);
    const result = await chatGroupService.updateGroup(me, req.params.id, {
      name: req.body?.name,
      memberIds: req.body?.memberIds,
    });
    if ("error" in result) return apiError(res, result.error, result.status);

    const { room, addedIds, removedIds, keptIds } = result.data;
    emitGroupChanged(room, addedIds, removedIds, keptIds);
    return apiSuccess(res, { room });
  })
);
router.get(
  "/builtin/:room/roster",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const result = await chatBuiltinService.getBuiltinRoster(req.params.room);
    return sendResult(res, result);
  })
);

router.patch(
  "/builtin/:room",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const me = await adminIdentity(req.user!.id);
    const result = await chatBuiltinService.updateBuiltin(me, req.params.room, {
      name: req.body?.name,
      memberIds: req.body?.memberIds,
    });
    if ("error" in result) return apiError(res, result.error, result.status);

    const { room, addedIds, removedIds, keptIds } = result.data;
    emitGroupChanged(room, addedIds, removedIds, keptIds);
    return apiSuccess(res, { room });
  })
);


router.delete(
  "/groups/:id",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const me = await adminIdentity(req.user!.id);
    const result = await chatGroupService.deleteGroup(me, req.params.id);
    if ("error" in result) return apiError(res, result.error, result.status);

    emitGroupDeleted(result.data.room, result.data.memberIds);
    // Rows are gone; clear the uploaded files too, ignoring any already missing.
    for (const file of result.data.files) fs.promises.unlink(path.join(UPLOAD_DIR, file)).catch(() => undefined);
    return apiSuccess(res, { room: result.data.room });
  })
);

router.get(
  "/search",
  asyncHandler(async (req, res) => {
    // Optional ?room= scopes the search to one channel (the in-conversation search box).
    const room = req.query.room === undefined ? undefined : parseRoom(String(req.query.room));
    if (req.query.room !== undefined && !room) return apiError(res, "Unknown channel", 404);

    const result = await chatService.searchMessages(req.user!, req.query.q, room ?? undefined);
    return sendResult(res, result);
  })
);

router.get(
  "/:room/messages",
  asyncHandler(async (req, res) => {
    const room = parseRoom(req.params.room);
    if (!room) return apiError(res, "Unknown channel", 404);

    const result = await chatService.listMessages(room, req.user!, {
      before: req.query.before,
      limit: req.query.limit,
      around: req.query.around,
    });
    if ("error" in result) return apiError(res, result.error, result.status);
    return apiSuccess(res, { ...result.data, room, label: await chatService.labelFor(room) });
  })
);

router.post(
  "/:room/messages",
  asyncHandler(async (req, res) => {
    const room = parseRoom(req.params.room);
    if (!room) return apiError(res, "Unknown channel", 404);

    const result = await chatService.sendMessage(room, req.user!, req.body?.body);
    if ("error" in result) return apiError(res, result.error, result.status);

    emitMessageCreated(room, result.data.message);
    return apiSuccess(res, result.data, undefined, 201);
  })
);

router.patch(
  "/messages/:id",
  asyncHandler(async (req, res) => {
    const result = await chatService.editMessage(req.params.id, req.user!, req.body?.body);
    if ("error" in result) return apiError(res, result.error, result.status);

    emitMessageUpdated(result.data.message.room, result.data.message);
    return apiSuccess(res, result.data);
  })
);

router.delete(
  "/messages/:id",
  asyncHandler(async (req, res) => {
    const result = await chatService.deleteMessage(req.params.id, req.user!);
    if ("error" in result) return apiError(res, result.error, result.status);

    emitMessageUpdated(result.data.message.room, result.data.message);
    return apiSuccess(res, result.data);
  })
);

router.post(
  "/:room/read",
  asyncHandler(async (req, res) => {
    const room = parseRoom(req.params.room);
    if (!room) return apiError(res, "Unknown channel", 404);

    const result = await chatService.markRead(room, req.user!);
    return sendResult(res, result);
  })
);

export default router;
