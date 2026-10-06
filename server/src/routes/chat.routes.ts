import fs from "fs";
import path from "path";
import crypto from "crypto";
import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import multer from "multer";
import { apiError, apiSuccess } from "../lib/api-response";
import { asyncHandler } from "../lib/async-handler";
import { authenticate } from "../middleware/auth";
import { parseRoom, ROOM_LABEL } from "../lib/chat-rooms";
import { emitMessageCreated, emitMessageUpdated } from "../realtime/chat-gateway";
import * as chatService from "../services/chat.service";

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

router.post(
  "/:room/messages/file",
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

router.get(
  "/:room/messages",
  asyncHandler(async (req, res) => {
    const room = parseRoom(req.params.room);
    if (!room) return apiError(res, "Unknown channel", 404);

    const result = await chatService.listMessages(room, req.user!, {
      before: req.query.before,
      limit: req.query.limit,
    });
    if ("error" in result) return apiError(res, result.error, result.status);
    return apiSuccess(res, { ...result.data, room, label: ROOM_LABEL[room] });
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
    if ("error" in result) return apiError(res, result.error, result.status);
    return apiSuccess(res, result.data);
  })
);

export default router;
