import { Router } from 'express';
import { apiError, apiSuccess } from '../lib/api-response';
import { asyncHandler } from '../lib/async-handler';
import { authenticate, requireRole } from '../middleware/auth';
import * as leadService from '../services/lead.service';

const router = Router();
router.use(authenticate);

// ─── Junior Closer ──────────────────────────────────────────────
router.post(
  '/',
  requireRole('JUNIOR_CLOSER'),
  asyncHandler(async (req, res) => {
    const result = await leadService.submitLead(req.user!.id, req.body ?? {});
    if ('error' in result) return apiError(res, result.error, result.status);
    return apiSuccess(res, result.data, 'Lead submitted', 201);
  })
);

router.get(
  '/mine',
  requireRole('JUNIOR_CLOSER'),
  asyncHandler(async (req, res) => {
    const leads = await leadService.listLeadsForJuniorCloser(req.user!.id);
    return apiSuccess(res, { leads });
  })
);

// ─── Closer ─────────────────────────────────────────────────────
router.get(
  '/inbox',
  requireRole('CLOSER'),
  asyncHandler(async (req, res) => {
    const leads = await leadService.listInboxForCloser(req.user!.id);
    return apiSuccess(res, { leads });
  })
);

router.get(
  '/closer-history',
  requireRole('CLOSER'),
  asyncHandler(async (req, res) => {
    const leads = await leadService.listHistoryForCloser(req.user!.id);
    return apiSuccess(res, { leads });
  })
);

router.patch(
  '/:id/enrich',
  requireRole('CLOSER'),
  asyncHandler(async (req, res) => {
    const result = await leadService.enrichAndSubmitLead(req.params.id, req.user!.id, req.body ?? {});
    if ('error' in result) return apiError(res, result.error, result.status);
    return apiSuccess(res, result.data, 'Lead sent to admin');
  })
);

// ─── Admin ──────────────────────────────────────────────────────
router.get(
  '/queue',
  requireRole('ADMIN'),
  asyncHandler(async (_req, res) => {
    const leads = await leadService.listQueueForAdmin();
    return apiSuccess(res, { leads });
  })
);

router.get(
  '/all',
  requireRole('ADMIN'),
  asyncHandler(async (_req, res) => {
    const leads = await leadService.listAllLeadsForAdmin();
    return apiSuccess(res, { leads });
  })
);

router.patch(
  '/:id/assign',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const { clientId } = req.body ?? {};
    if (!clientId) return apiError(res, 'clientId is required', 400);

    const result = await leadService.assignLeadToClient(req.params.id, clientId);
    if ('error' in result) return apiError(res, result.error, result.status);
    return apiSuccess(res, result.data, 'Lead assigned');
  })
);

router.patch(
  '/:id/payment-status',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const { paymentStatus } = req.body ?? {};
    if (paymentStatus !== 'PAID' && paymentStatus !== 'UNPAID') {
      return apiError(res, 'paymentStatus must be PAID or UNPAID', 400);
    }
    const result = await leadService.setLeadPaymentStatus(req.params.id, paymentStatus);
    if ('error' in result) return apiError(res, result.error, result.status);
    return apiSuccess(res, result.data, 'Payment status updated');
  })
);

router.patch(
  '/:id',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const result = await leadService.editLead(req.params.id, req.body ?? {});
    if ('error' in result) return apiError(res, result.error, result.status);
    return apiSuccess(res, result.data, 'Lead updated');
  })
);

// ─── Client ─────────────────────────────────────────────────────
router.get(
  '/assigned',
  requireRole('CLIENT'),
  asyncHandler(async (req, res) => {
    const leads = await leadService.listAssignedPreviewsForClient(req.user!.id);
    return apiSuccess(res, { leads });
  })
);

router.get(
  '/client-history',
  requireRole('CLIENT'),
  asyncHandler(async (req, res) => {
    const leads = await leadService.listHistoryForClient(req.user!.id);
    return apiSuccess(res, { leads });
  })
);

router.patch(
  '/:id/accept',
  requireRole('CLIENT'),
  asyncHandler(async (req, res) => {
    const result = await leadService.acceptLead(req.params.id, req.user!.id);
    if ('error' in result) return apiError(res, result.error, result.status);
    return apiSuccess(res, result.data, 'Lead accepted');
  })
);

router.patch(
  '/:id/reject',
  requireRole('CLIENT'),
  asyncHandler(async (req, res) => {
    const { reason } = req.body ?? {};
    const result = await leadService.rejectLead(req.params.id, req.user!.id, reason);
    if ('error' in result) return apiError(res, result.error, result.status);
    return apiSuccess(res, result.data, 'Lead rejected');
  })
);

// ─── Shared — any authenticated role, ownership + masking enforced in service layer ──
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const result = await leadService.getLeadById(req.params.id, req.user!);
    if ('error' in result) return apiError(res, result.error, result.status);
    return apiSuccess(res, result.data);
  })
);

export default router;
