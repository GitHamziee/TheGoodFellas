import { Router } from 'express';
import { apiError, apiSuccess } from '../lib/api-response';
import { asyncHandler } from '../lib/async-handler';
import { authenticate, requireRole } from '../middleware/auth';
import * as callReviewService from '../services/call-review.service';

const router = Router();
router.use(authenticate);

router.post(
  '/',
  requireRole('QA_JUNIOR_CLOSER', 'QA_CLOSER'),
  asyncHandler(async (req, res) => {
    const result = await callReviewService.submitCallReview(
      req.user! as { id: string; role: 'QA_JUNIOR_CLOSER' | 'QA_CLOSER' },
      req.body ?? {}
    );
    if ('error' in result) return apiError(res, result.error, result.status);
    return apiSuccess(res, result.data, 'Review recorded', 201);
  })
);

router.get(
  '/leads',
  requireRole('QA_JUNIOR_CLOSER', 'QA_CLOSER'),
  asyncHandler(async (req, res) => {
    const result = await callReviewService.listLeadsForReviewee(
      req.user! as { id: string; role: 'QA_JUNIOR_CLOSER' | 'QA_CLOSER' },
      req.query.revieweeId
    );
    if ('error' in result) return apiError(res, result.error, result.status);
    return apiSuccess(res, result.data);
  })
);

router.get(
  '/mine',
  requireRole('QA_JUNIOR_CLOSER', 'QA_CLOSER'),
  asyncHandler(async (req, res) => {
    const reviews = await callReviewService.listMineForReviewer(req.user!.id);
    return apiSuccess(res, { reviews });
  })
);

router.get(
  '/',
  requireRole('ADMIN'),
  asyncHandler(async (_req, res) => {
    const reviews = await callReviewService.listAllForAdmin();
    return apiSuccess(res, { reviews });
  })
);

export default router;
