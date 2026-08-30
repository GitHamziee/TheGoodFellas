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
// QA_CLOSER needs it for the "who is this call review about" picker on their Write a
// Review page.
router.get(
  "/closers",
  requireRole("JUNIOR_CLOSER", "ADMIN", "QA_CLOSER"),
  asyncHandler(async (_req, res) => {
    const closers = await userService.listClosers();
    return apiSuccess(res, { closers });
  })
);

// QA_JUNIOR_CLOSER's own "who is this call review about" picker.
router.get(
  "/junior-closers",
  requireRole("QA_JUNIOR_CLOSER"),
  asyncHandler(async (_req, res) => {
    const juniorClosers = await userService.listJuniorClosers();
    return apiSuccess(res, { juniorClosers });
  })
);

// Admin needs it for the "assign to retention person" dropdown; Retention needs it for the
// Retention queue's "filter by teammate" dropdown.
router.get(
  "/retention",
  requireRole("ADMIN", "RETENTION"),
  asyncHandler(async (_req, res) => {
    const retention = await userService.listRetention();
    return apiSuccess(res, { retention });
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

// Basic account info (name/email/phone) — any role. Separate from /:id/role, /:id/pricing
// etc., which each own a narrower, role-scoped slice of the account.
router.patch(
  "/:id",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const { name, email, phone } = req.body ?? {};
    const result = await userService.updateUserProfile(req.params.id, { name, email, phone });
    if ("error" in result) return apiError(res, result.error, result.status);
    return apiSuccess(res, result.data, "Account updated");
  })
);

router.post(
  "/",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const {
      name,
      email,
      password,
      role,
      phone,
      levelCost,
      gradedCost,
      modifiedCost,
      giCost,
      minimumPremium,
      acceptsOnlineBankPayment,
      states,
      carriers,
      stateCarriers,
    } = req.body ?? {};
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
      minimumPremium,
      acceptsOnlineBankPayment,
      states,
      carriers,
      stateCarriers,
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

// Only meaningful for CLIENT accounts — licensed states + carrier roster + online-bank-
// payment acceptance, the data set the State Sheet page reads (state -> clients -> carriers
// available there).
router.patch(
  "/:id/coverage",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const result = await userService.updateClientCoverage(req.params.id, req.body ?? {});
    if ("error" in result) return apiError(res, result.error, result.status);
    return apiSuccess(res, result.data, "Coverage updated");
  })
);

// Only meaningful for CLIENT accounts — which of a client's roster carriers apply in one
// specific licensed state (e.g. Sunrise writes NRG in Alaska but MPG in Alabama).
router.patch(
  "/:id/state-carriers",
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const result = await userService.updateClientStateCarriers(req.params.id, req.body ?? {});
    if ("error" in result) return apiError(res, result.error, result.status);
    return apiSuccess(res, result.data, "Carrier availability updated");
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
