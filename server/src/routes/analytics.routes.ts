import { Router } from 'express';
import { apiSuccess } from '../lib/api-response';
import { asyncHandler } from '../lib/async-handler';
import { authenticate, requireRole } from '../middleware/auth';
import * as analyticsService from '../services/analytics.service';

const router = Router();
router.use(authenticate, requireRole('ADMIN'));

router.get(
  '/junior-closers',
  asyncHandler(async (_req, res) => {
    const rows = await analyticsService.juniorCloserAnalytics();
    return apiSuccess(res, { rows });
  })
);

router.get(
  '/closers',
  asyncHandler(async (_req, res) => {
    const rows = await analyticsService.closerAnalytics();
    return apiSuccess(res, { rows });
  })
);

router.get(
  '/overall',
  asyncHandler(async (_req, res) => {
    const overall = await analyticsService.overallAnalytics();
    return apiSuccess(res, { overall });
  })
);

export default router;
