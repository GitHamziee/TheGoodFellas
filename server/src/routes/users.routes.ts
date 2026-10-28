import { Router } from "express";
import { Role } from "@prisma/client";

const isRole = (value: unknown): value is Role =>
  typeof value === "string" && (Object.values(Role) as string[]).includes(value);
import { apiError, apiSuccess, sendResult } from "../lib/api-response";
import { asyncHandler } from "../lib/async-handler";
import { authenticate, requireRole } from "../middleware/auth";
import * as authService from "../services/auth.service";
import * as userService from "../services/user.service";

const router = Router();
router.use(authenticate);

// Manager runs People but must not be able to promote themselves or take over a privileged
// account: ADMIN and MANAGER accounts are off limits as targets, and neither role can be granted.
const MANAGER_FORBIDDEN_ROLES: Role[] = ["ADMIN", "MANAGER"];

router.param("id", (req, res, next, id) => {
  if (req.user!.role !== "MANAGER" || req.method === "GET") return next();
  userService
    .getUserById(id)
    .then((target) => {
      if (target && MANAGER_FORBIDDEN_ROLES.includes(target.role)) {
        return apiError(res, "Managers cannot modify Admin or Manager accounts", 403);
      }
      return next();
    })
    .catch(next);
});

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

// Admin/Manager need it for the "assign to retention person" dropdown; Retention needs it
// for the Retention queue's "filter by teammate" dropdown.
router.get(
  "/retention",
  requireRole("ADMIN", "MANAGER", "RETENTION"),
  asyncHandler(async (_req, res) => {
    const retention = await userService.listRetention();
    return apiSuccess(res, { retention });
  })
);

// Admin/Manager need the client list for the "assign to client" step. Closer/Retention
// need it for the optional "suggested client" hint on their own lead forms.
router.get(
  "/clients",
  requireRole("ADMIN", "MANAGER", "CLOSER", "RETENTION"),
  asyncHandler(async (_req, res) => {
    const clients = await userService.listClients();
    return apiSuccess(res, { clients });
  })
);

// State Sheet — every CLOSER/TEAM_LEAD/RETENTION/ADMIN/MANAGER can see which clients cover
// which states and the carriers available there. Registered ahead of the generic "/:id"
// below so the literal path wins the match.
router.get(
  "/state-sheet",
  requireRole("ADMIN", "MANAGER", "CLOSER", "TEAM_LEAD", "RETENTION"),
  asyncHandler(async (_req, res) => {
    const clients = await userService.listClientCoverage();
    return apiSuccess(res, { clients });
  })
);

router.get(
  "/",
  requireRole("ADMIN", "MANAGER"),
  asyncHandler(async (req, res) => {
    const role = req.query.role;
    if (role !== undefined && !isRole(role)) return apiError(res, "Invalid role", 400);
    const users = await userService.listUsers(role);
    return apiSuccess(res, { users });
  })
);

router.get(
  "/:id",
  requireRole("ADMIN", "MANAGER"),
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
  requireRole("ADMIN", "MANAGER"),
  asyncHandler(async (req, res) => {
    const { name, email, phone } = req.body ?? {};
    const result = await userService.updateUserProfile(req.params.id, { name, email, phone });
    return sendResult(res, result, "Account updated");
  })
);

router.post(
  "/",
  requireRole("ADMIN", "MANAGER"),
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
    if (req.user!.role === "MANAGER" && MANAGER_FORBIDDEN_ROLES.includes(role)) {
      return apiError(res, "Managers cannot create Admin or Manager accounts", 403);
    }

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
    return sendResult(res, result, "User created", 201);
  })
);

router.patch(
  "/:id/role",
  requireRole("ADMIN", "MANAGER"),
  asyncHandler(async (req, res) => {
    const { role } = req.body ?? {};
    if (!role) return apiError(res, "Role is required", 400);
    if (!isRole(role)) return apiError(res, "Invalid role", 400);
    if (req.user!.role === "MANAGER" && MANAGER_FORBIDDEN_ROLES.includes(role)) {
      return apiError(res, "Managers cannot grant Admin or Manager roles", 403);
    }
    if (!(await userService.getUserById(req.params.id))) return apiError(res, "User not found", 404);

    const user = await userService.updateUserRole(req.params.id, role);
    return apiSuccess(res, { user }, "Role updated");
  })
);

// Only meaningful for CLIENT accounts — the four per-plan (Level/Graded/Modified/GI)
// lead costs shown on the create form and editable afterward from the account detail modal.
router.patch(
  "/:id/pricing",
  requireRole("ADMIN", "MANAGER"),
  asyncHandler(async (req, res) => {
    const result = await userService.updateClientPricing(req.params.id, req.body ?? {});
    return sendResult(res, result, "Pricing updated");
  })
);

// Only meaningful for CLIENT accounts — licensed states + carrier roster + online-bank-
// payment acceptance, the data set the State Sheet page reads (state -> clients -> carriers
// available there).
router.patch(
  "/:id/coverage",
  requireRole("ADMIN", "MANAGER"),
  asyncHandler(async (req, res) => {
    const result = await userService.updateClientCoverage(req.params.id, req.body ?? {});
    return sendResult(res, result, "Coverage updated");
  })
);

// Only meaningful for CLIENT accounts — which of a client's roster carriers apply in one
// specific licensed state (e.g. Sunrise writes NRG in Alaska but MPG in Alabama).
router.patch(
  "/:id/state-carriers",
  requireRole("ADMIN", "MANAGER"),
  asyncHandler(async (req, res) => {
    const result = await userService.updateClientStateCarriers(req.params.id, req.body ?? {});
    return sendResult(res, result, "Carrier availability updated");
  })
);

// There is no self-service "forgot password" — an Admin resets it directly here.
router.patch(
  "/:id/reset-password",
  requireRole("ADMIN", "MANAGER"),
  asyncHandler(async (req, res) => {
    const { newPassword } = req.body ?? {};
    const result = await authService.resetPassword(req.params.id, newPassword);
    return sendResult(res, result, "Password reset");
  })
);

export default router;
