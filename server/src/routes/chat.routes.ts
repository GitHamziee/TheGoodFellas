import { Router } from "express";
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
