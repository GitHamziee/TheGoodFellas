import { Router } from 'express';
import { apiError, apiSuccess } from '../lib/api-response';
import { asyncHandler } from '../lib/async-handler';
import { authenticate, requireRole } from '../middleware/auth';
import * as externalClientService from '../services/external-client.service';

const router = Router();
router.use(authenticate);
router.use(requireRole('ADMIN'));

router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const externalClients = await externalClientService.listExternalClients();
    return apiSuccess(res, { externalClients });
  })
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const result = await externalClientService.createExternalClient(req.body ?? {});
    if ('error' in result) return apiError(res, result.error, result.status);
    return apiSuccess(res, result.data, 'External client created', 201);
  })
);

router.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const result = await externalClientService.updateExternalClient(req.params.id, req.body ?? {});
    if ('error' in result) return apiError(res, result.error, result.status);
    return apiSuccess(res, result.data, 'External client updated');
  })
);

export default router;
