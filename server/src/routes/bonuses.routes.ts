import { Router } from 'express';
import { apiSuccess, sendResult } from '../lib/api-response';
import { asyncHandler } from '../lib/async-handler';
import { authenticate, requireRole } from '../middleware/auth';
import prisma from '../lib/prisma';
import * as bonusService from '../services/bonus.service';

const router = Router();
router.use(authenticate);

// A Retention person sees their own bonus only; the user id comes from the token, never the request.
router.get(
  '/retention/mine',
  requireRole('RETENTION'),
  asyncHandler(async (req, res) => {
    const me = await prisma.user.findUnique({ where: { id: req.user!.id }, select: { name: true } });
    return sendResult(res, await bonusService.myReport(req.user!.id, me?.name ?? '', req.query.month));
  })
);

// Everything below is ADMIN only — every figure is PKR across the whole team.
router.use(requireRole('ADMIN'));

router.get(
  '/retention/rules',
  asyncHandler(async (_req, res) => apiSuccess(res, { rules: await bonusService.getRules('RETENTION') }))
);

router.put(
  '/retention/rules',
  asyncHandler(async (req, res) => sendResult(res, await bonusService.updateRules('RETENTION', req.body ?? {}), 'Bonus rules saved'))
);

router.get(
  '/retention/report',
  asyncHandler(async (req, res) => sendResult(res, await bonusService.monthReport('RETENTION', req.query.month)))
);

export default router;
