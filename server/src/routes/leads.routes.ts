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

router.post(
  '/cpl',
  requireRole('JUNIOR_CLOSER'),
  asyncHandler(async (req, res) => {
    const result = await leadService.submitCplLead(req.user!.id, req.body ?? {});
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

router.get(
  '/returned/mine',
  requireRole('JUNIOR_CLOSER'),
  asyncHandler(async (req, res) => {
    const leads = await leadService.listReturnedForJuniorCloser(req.user!.id);
    return apiSuccess(res, { leads });
  })
);

router.patch(
  '/:id/resubmit-intake',
  requireRole('JUNIOR_CLOSER'),
  asyncHandler(async (req, res) => {
    const result = await leadService.resubmitByJuniorCloser(req.params.id, req.user!.id, req.body ?? {});
    if ('error' in result) return apiError(res, result.error, result.status);
    return apiSuccess(res, result.data, 'Lead sent back to admin');
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

router.get(
  '/drafts',
  requireRole('CLOSER'),
  asyncHandler(async (req, res) => {
    const leads = await leadService.listDraftsForCloser(req.user!.id);
    return apiSuccess(res, { leads });
  })
);

router.patch(
  '/:id/draft',
  requireRole('CLOSER'),
  asyncHandler(async (req, res) => {
    const result = await leadService.saveLeadAsDraft(req.params.id, req.user!.id, req.body ?? {});
    if ('error' in result) return apiError(res, result.error, result.status);
    return apiSuccess(res, result.data, 'Lead saved as a draft');
  })
);

router.get(
  '/returned/closer',
  requireRole('CLOSER'),
  asyncHandler(async (req, res) => {
    const leads = await leadService.listReturnedForCloser(req.user!.id);
    return apiSuccess(res, { leads });
  })
);

router.patch(
  '/:id/resubmit-enrichment',
  requireRole('CLOSER'),
  asyncHandler(async (req, res) => {
    const result = await leadService.resubmitByCloser(req.params.id, req.user!.id, req.body ?? {});
    if ('error' in result) return apiError(res, result.error, result.status);
    return apiSuccess(res, result.data, 'Lead sent back to admin');
  })
);

// Closer builds a lead from scratch — self-/AI-sourced calls with no Junior Closer
// involved. Combines junior intake + closer enrichment in one submission.
router.post(
  '/closer',
  requireRole('CLOSER'),
  asyncHandler(async (req, res) => {
    const result = await leadService.createLeadByCloser(req.user!.id, req.body ?? {});
    if ('error' in result) return apiError(res, result.error, result.status);
    return apiSuccess(res, result.data, 'Lead submitted', 201);
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

router.get(
  '/charge-backs',
  requireRole('ADMIN'),
  asyncHandler(async (_req, res) => {
    const leads = await leadService.listChargeBacksForAdmin();
    return apiSuccess(res, { leads });
  })
);

router.get(
  '/cpl',
  requireRole('ADMIN'),
  asyncHandler(async (_req, res) => {
    const leads = await leadService.listCplLeadsForAdmin();
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
  '/:id/assign-external',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const { externalClientId } = req.body ?? {};
    if (!externalClientId) return apiError(res, 'externalClientId is required', 400);

    const result = await leadService.assignLeadToExternalClient(req.params.id, externalClientId);
    if ('error' in result) return apiError(res, result.error, result.status);
    return apiSuccess(res, result.data, 'Lead assigned to external client');
  })
);

router.patch(
  '/:id/return',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const { target, reason } = req.body ?? {};
    if (target !== 'JUNIOR_CLOSER' && target !== 'CLOSER') {
      return apiError(res, 'target must be JUNIOR_CLOSER or CLOSER', 400);
    }
    const result = await leadService.returnLeadForEdit(req.params.id, target, reason);
    if ('error' in result) return apiError(res, result.error, result.status);
    return apiSuccess(res, result.data, 'Lead sent back for editing');
  })
);

router.patch(
  '/batch-payment',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const { leadIds, pkrAmount, note } = req.body ?? {};
    const result = await leadService.batchMarkPaid(leadIds, pkrAmount, note);
    if ('error' in result) return apiError(res, result.error, result.status);
    return apiSuccess(res, result.data, 'Leads marked paid');
  })
);

router.patch(
  '/:id/charge-back',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const { pkrAmount, reason } = req.body ?? {};
    const result = await leadService.markLeadChargedBack(req.params.id, pkrAmount, reason);
    if ('error' in result) return apiError(res, result.error, result.status);
    return apiSuccess(res, result.data, 'Lead marked charged back');
  })
);

router.patch(
  '/:id/payment-status',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    const { paymentStatus } = req.body ?? {};
    // Marking a lead PAID must go through /batch-payment so the PKR amount received is
    // always recorded — this endpoint only reverts a mistaken PAID back to UNPAID.
    if (paymentStatus !== 'UNPAID') {
      return apiError(res, 'paymentStatus must be UNPAID — use batch-payment to mark a lead paid', 400);
    }
    const result = await leadService.setLeadPaymentStatus(req.params.id);
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

// ─── Team Lead ──────────────────────────────────────────────────
router.get(
  '/team-lead/submitted',
  requireRole('TEAM_LEAD'),
  asyncHandler(async (_req, res) => {
    const leads = await leadService.listSubmittedForTeamLead();
    return apiSuccess(res, { leads });
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
