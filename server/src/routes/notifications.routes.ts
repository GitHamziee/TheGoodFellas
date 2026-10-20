import { Router } from "express";
import { apiSuccess } from "../lib/api-response";
import { asyncHandler } from "../lib/async-handler";
import { authenticate } from "../middleware/auth";
import * as notificationService from "../services/notification.service";

const router = Router();
router.use(authenticate);

router.get(
  "/",
  asyncHandler(async (req, res) => {
    return apiSuccess(res, await notificationService.listForUser(req.user!.id));
  })
);

router.patch(
  "/read-all",
  asyncHandler(async (req, res) => {
    await notificationService.markAllRead(req.user!.id);
    return apiSuccess(res, { ok: true });
  })
);

router.patch(
  "/:id/read",
  asyncHandler(async (req, res) => {
    await notificationService.markRead(req.user!.id, String(req.params.id));
    return apiSuccess(res, { ok: true });
  })
);

export default router;
