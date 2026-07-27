import { Router } from "express";
import type { Role } from "@prisma/client";
import { apiError, apiSuccess } from "../lib/api-response";
import { asyncHandler } from "../lib/async-handler";
import { authenticate, requireRole } from "../middleware/auth";
import * as authService from "../services/auth.service";
import * as userService from "../services/user.service";

const router = Router();
router.use(authenticate);

// Junior closers need the closer list for the "select a closer" field at submission.
router.get(
  "/closers",
  requireRole("JUNIOR_CLOSER", "ADMIN"),
  asyncHandler(async (_req, res) => {
    const closers = await userService.listClosers();
    return apiSuccess(res, { closers });
  })
);

// Admins need the client list for the "assign to client" step.
router.get(
  "/clients",
  requireRole("ADMIN"),
  asyncHandler(async (_req, res) => {
    const clients = await userService.listClients();
    return apiSuccess(res, { clients });
  })
);

router.get(
  "/",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const role = req.query.role as Role | undefined;
    const users = await userService.listUsers(role);
    return apiSuccess(res, { users });
  })
);

router.get(
  "/:id",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const user = await userService.getUserById(req.params.id);
    if (!user) return apiError(res, "User not found", 404);
    return apiSuccess(res, { user });
  })
);

router.post(
  "/",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const { name, email, password, role, phone } = req.body ?? {};
    if (!role) return apiError(res, "Role is required", 400);

    const result = await authService.createStaffUser({ name, email, password, role, phone });
    if ("error" in result) return apiError(res, result.error, result.status);
    return apiSuccess(res, result.data, "User created", 201);
  })
);

router.patch(
  "/:id/role",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const { role } = req.body ?? {};
    if (!role) return apiError(res, "Role is required", 400);

    const user = await userService.updateUserRole(req.params.id, role);
    return apiSuccess(res, { user }, "Role updated");
  })
);

export default router;
