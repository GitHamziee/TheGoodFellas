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

// State Sheet — every CLOSER/TEAM_LEAD/ADMIN can see which clients cover which states
// and the carriers available there. Registered ahead of the generic "/:id" below so the
// literal path wins the match.
router.get(
  "/state-sheet",
  requireRole("ADMIN", "CLOSER", "TEAM_LEAD"),
  asyncHandler(async (_req, res) => {
    const clients = await userService.listClientCoverage();
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
    const { name, email, password, role, phone, levelCost, gradedCost, modifiedCost, giCost, states, carriers } =
      req.body ?? {};
    if (!role) return apiError(res, "Role is required", 400);

    const result = await authService.createStaffUser({
      name,
      email,
      password,
      role,
      phone,
      levelCost,
      gradedCost,
      modifiedCost,
      giCost,
      states,
      carriers,
    });
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

// Only meaningful for CLIENT accounts — the four per-plan (Level/Graded/Modified/GI)
// lead costs shown on the create form and editable afterward from the account detail modal.
router.patch(
  "/:id/pricing",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const result = await userService.updateClientPricing(req.params.id, req.body ?? {});
    if ("error" in result) return apiError(res, result.error, result.status);
    return apiSuccess(res, result.data, "Pricing updated");
  })
);

// Only meaningful for CLIENT accounts — licensed states + carriers, the data set the
// future State Sheet page reads (state -> clients -> carriers available there).
router.patch(
  "/:id/coverage",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const result = await userService.updateClientCoverage(req.params.id, req.body ?? {});
    if ("error" in result) return apiError(res, result.error, result.status);
    return apiSuccess(res, result.data, "Coverage updated");
  })
);

// There is no self-service "forgot password" — an Admin resets it directly here.
router.patch(
  "/:id/reset-password",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const { newPassword } = req.body ?? {};
    const result = await authService.resetPassword(req.params.id, newPassword);
    if ("error" in result) return apiError(res, result.error, result.status);
    return apiSuccess(res, result.data, "Password reset");
  })
);

export default router;
