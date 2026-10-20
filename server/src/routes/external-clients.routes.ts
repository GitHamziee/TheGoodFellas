import { Router } from 'express';
import { apiSuccess, sendResult } from '../lib/api-response';
import { asyncHandler } from '../lib/async-handler';
import { authenticate, requireRole } from '../middleware/auth';
import * as externalClientService from '../services/external-client.service';

const router = Router();
router.use(authenticate);

// List is also how Manager's "Assign External" dropdown (on Queue/CPA/CPL Leads) is
// populated — Manager can hand a lead to an external client without being able to manage
// the roster itself, so only this one is opened up beyond ADMIN.
router.get(
  '/',
  requireRole('ADMIN', 'MANAGER'),
  asyncHandler(async (_req, res) => {
    const externalClients = await externalClientService.listExternalClients();
    return apiSuccess(res, { externalClients });
  })
);

router.use(requireRole('ADMIN'));

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const result = await externalClientService.createExternalClient(req.body ?? {});
    return sendResult(res, result, 'External client created', 201);
  })
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const result = await externalClientService.updateExternalClient(req.params.id, req.body ?? {});
    return sendResult(res, result, 'External client updated');
  })
);

export default router;
