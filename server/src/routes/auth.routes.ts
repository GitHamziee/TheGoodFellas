import { Router } from "express";
import prisma from "../lib/prisma";
import { apiError, apiSuccess } from "../lib/api-response";
import { asyncHandler } from "../lib/async-handler";
import { authenticate, requireRole } from "../middleware/auth";
import { getClientIp } from "../lib/client-ip";
import * as authService from "../services/auth.service";

const router = Router();

// No self-registration — every account (including Client) is created by an Admin via
// POST /api/users. See auth.service.ts#resetPassword for the password-recovery story.
router.post(
  "/login",
  asyncHandler(async (req, res) => {
    const { email, password } = req.body ?? {};
    if (!email || !password) return apiError(res, "Email and password are required", 400);

    const clientIp = getClientIp(req);
    const result = await authService.login(email, password, clientIp);
    if ("error" in result) {
      // TEMP DEBUG — remove once IP whitelisting is confirmed working end-to-end.
      if (result.code === "IP_NOT_WHITELISTED") {
        console.log("[ip-whitelist] login blocked", {
          detectedIp: clientIp,
          xForwardedFor: req.headers["x-forwarded-for"],
          rawSocketIp: req.socket.remoteAddress,
        });
      }
      return apiError(res, result.error, result.status, result.code);
    }
    return apiSuccess(res, result.data);
  })
);

router.get(
  "/me",
  authenticate,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id },
      select: { id: true, name: true, email: true, role: true, phone: true },
    });
    if (!user) return apiError(res, "User not found", 404);
    return apiSuccess(res, { user });
  })
);

// Self-service password change is Admin/Manager only — every other role gets their
// password reset by an Admin via PATCH /api/users/:id/reset-password instead.
router.post(
  "/change-password",
  authenticate,
  requireRole("ADMIN", "MANAGER"),
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.body ?? {};
    if (!currentPassword || !newPassword) return apiError(res, "Both current and new password are required", 400);

    const result = await authService.changePassword(req.user!.id, currentPassword, newPassword);
    if ("error" in result) return apiError(res, result.error, result.status);
    return apiSuccess(res, result.data, "Password updated");
  })
);

export default router;
