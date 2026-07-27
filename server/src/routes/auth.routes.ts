import { Router } from "express";
import prisma from "../lib/prisma";
import { apiError, apiSuccess } from "../lib/api-response";
import { asyncHandler } from "../lib/async-handler";
import { authenticate } from "../middleware/auth";
import * as authService from "../services/auth.service";

const router = Router();

router.post(
  "/register",
  asyncHandler(async (req, res) => {
    const { name, email, password, phone } = req.body ?? {};
    const result = await authService.registerClient({ name, email, password, phone });
    if ("error" in result) return apiError(res, result.error, result.status);
    return apiSuccess(res, result.data, "Account created", 201);
  })
);

router.post(
  "/login",
  asyncHandler(async (req, res) => {
    const { email, password } = req.body ?? {};
    if (!email || !password) return apiError(res, "Email and password are required", 400);

    const result = await authService.login(email, password);
    if ("error" in result) return apiError(res, result.error, result.status);
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

router.post(
  "/change-password",
  authenticate,
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = req.body ?? {};
    if (!currentPassword || !newPassword) return apiError(res, "Both current and new password are required", 400);

    const result = await authService.changePassword(req.user!.id, currentPassword, newPassword);
    if ("error" in result) return apiError(res, result.error, result.status);
    return apiSuccess(res, result.data, "Password updated");
  })
);

export default router;
