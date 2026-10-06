import { Router } from 'express';
import { apiSuccess } from '../lib/api-response';
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
  asyncHandler(async (_req, res) => {
    const rows = await analyticsService.juniorCloserAnalytics();
    return apiSuccess(res, { rows });
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

// Admin-only — visibility into parked closer drafts, not part of Team Lead's oversight scope.
router.get(
  '/drafts',
  requireRole('ADMIN', 'MANAGER'),
  asyncHandler(async (_req, res) => {
    const drafts = await analyticsService.draftsAnalytics();
    return apiSuccess(res, { drafts });
  })
);

// Admin-only — chargeback/revenue-loss reporting, same "business totals" category as /overall.
router.get(
  '/charge-backs',
  requireRole('ADMIN', 'MANAGER'),
  asyncHandler(async (_req, res) => {
    const chargeBacks = await analyticsService.chargeBackAnalytics();
    return apiSuccess(res, { chargeBacks });
  })
);

// ─── QA Reports — internal quality metrics from LeadReview/CallReview. Shared with Team
// Lead like the outcome analytics above (no revenue/expense data in these either).
router.get(
  '/qa-junior-closers',
  requireRole('ADMIN', 'MANAGER', 'TEAM_LEAD'),
  asyncHandler(async (_req, res) => {
    const rows = await analyticsService.qaJuniorAnalytics();
    return apiSuccess(res, { rows });
  })
);

router.get(
  '/qa-closers',
  requireRole('ADMIN', 'MANAGER', 'TEAM_LEAD'),
  asyncHandler(async (_req, res) => {
    const rows = await analyticsService.qaCloserAnalytics();
    return apiSuccess(res, { rows });
  })
);

router.get(
  '/call-reviews-junior',
  requireRole('ADMIN', 'MANAGER', 'TEAM_LEAD'),
  asyncHandler(async (_req, res) => {
    const issues = await analyticsService.callReviewJuniorAnalytics();
    return apiSuccess(res, { issues });
  })
);

router.get(
  '/call-reviews-closer',
  requireRole('ADMIN', 'MANAGER', 'TEAM_LEAD'),
  asyncHandler(async (_req, res) => {
    const issues = await analyticsService.callReviewCloserAnalytics();
    return apiSuccess(res, { issues });
  })
);

export default router;
