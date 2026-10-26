import { Router, type Request, type Response } from 'express';
import { apiError, apiSuccess } from '../lib/api-response';
import type { QaLane } from '../services/analytics.service';
import { asyncHandler } from '../lib/async-handler';
import { authenticate, requireRole } from '../middleware/auth';
import * as analyticsService from '../services/analytics.service';

const router = Router();
router.use(authenticate);

// Team Lead gets performance analytics for both roles it oversees — no revenue/expenses
// data lives in these two endpoints anyway, so no masking is needed beyond the role gate.
router.get(
  '/junior-closers',
  requireRole('ADMIN', 'MANAGER', 'TEAM_LEAD'),
  asyncHandler(async (req, res) => {
    const from = new Date(String(req.query.from ?? ''));
    const to = new Date(String(req.query.to ?? ''));
    const range = !isNaN(from.getTime()) && !isNaN(to.getTime()) ? { from, to } : undefined;
    const rows = await analyticsService.juniorCloserAnalytics(range);
    return apiSuccess(res, { rows });
  })
);

router.get(
  '/junior-closers/:id',
  requireRole('ADMIN', 'MANAGER', 'TEAM_LEAD'),
  asyncHandler(async (req, res) => {
    const detail = await analyticsService.juniorCloserDetail(String(req.params.id));
    if (!detail) return apiError(res, 'Junior closer not found', 404);
    return apiSuccess(res, { detail });
  })
);

router.get(
  '/closers',
  requireRole('ADMIN', 'MANAGER', 'TEAM_LEAD'),
  asyncHandler(async (_req, res) => {
    const rows = await analyticsService.closerAnalytics();
    return apiSuccess(res, { rows });
  })
);

// Admin-only — Retention isn't in Team Lead's oversight scope (Junior Closer/Closer only).
router.get(
  '/retention',
  requireRole('ADMIN', 'MANAGER'),
  asyncHandler(async (_req, res) => {
    const rows = await analyticsService.retentionAnalytics();
    return apiSuccess(res, { rows });
  })
);

// Admin-only — revenue by plan type, same "business totals" category as /overall, so
// kept out of the Team Lead's module even though /closers itself is shared with them.
router.get(
  '/closers/plans',
  requireRole('ADMIN', 'MANAGER'),
  asyncHandler(async (_req, res) => {
    const rows = await analyticsService.closerPlanAnalytics();
    return apiSuccess(res, { rows });
  })
);

// Admin-only — revenue by plan type, same "business totals" category as /overall.
router.get(
  '/clients/plans',
  requireRole('ADMIN', 'MANAGER'),
  asyncHandler(async (_req, res) => {
    const rows = await analyticsService.clientPlanAnalytics();
    return apiSuccess(res, { rows });
  })
);

// Admin-only — includes payment/business totals, out of scope for Team Lead's module.
router.get(
  '/overall',
  requireRole('ADMIN', 'MANAGER'),
  asyncHandler(async (_req, res) => {
    const overall = await analyticsService.overallAnalytics();
    return apiSuccess(res, { overall });
  })
);

// Chargeback reporting — PKR amounts stripped for MANAGER inside chargeBackAnalytics.
router.get(
  '/charge-backs',
  requireRole('ADMIN', 'MANAGER'),
  asyncHandler(async (req, res) => {
    const chargeBacks = await analyticsService.chargeBackAnalytics(req.user!.role as 'ADMIN' | 'MANAGER');
    return apiSuccess(res, { chargeBacks });
  })
);

// ─── QA Reports — detail rows behind the Transfer / Live Call reports. Shared with Team Lead
// for the junior lane only (no revenue/expense data in these either); the closer lane is
// enforced here, not just hidden in the client nav.
function parseLane(req: Request, res: Response): QaLane | null {
  const lane = req.params.lane;
  if (lane !== 'junior' && lane !== 'closer') {
    apiError(res, "lane must be 'junior' or 'closer'", 400);
    return null;
  }
  if (lane === 'closer' && req.user!.role === 'TEAM_LEAD') {
    apiError(res, 'Forbidden', 403);
    return null;
  }
  return lane;
}

router.get(
  '/qa-transfer/:lane',
  requireRole('ADMIN', 'MANAGER', 'TEAM_LEAD'),
  asyncHandler(async (req, res) => {
    const lane = parseLane(req, res);
    if (!lane) return;
    return apiSuccess(res, { detail: await analyticsService.qaTransferDetail(lane) });
  })
);

router.get(
  '/call-reviews/:lane',
  requireRole('ADMIN', 'MANAGER', 'TEAM_LEAD'),
  asyncHandler(async (req, res) => {
    const lane = parseLane(req, res);
    if (!lane) return;
    return apiSuccess(res, { detail: await analyticsService.callReviewDetail(lane) });
  })
);

export default router;
