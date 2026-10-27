import { NextFunction, Request, Response, Router } from 'express';
import { apiError, apiSuccess, sendResult } from '../lib/api-response';
import { asyncHandler } from '../lib/async-handler';
import { reportError } from '../lib/rollbar';
import { authenticate, requireRole } from '../middleware/auth';
import * as leadService from '../services/lead.service';
import * as sheetSync from '../services/retention-sheet-sync.service';
import * as retentionHistory from '../services/retention-history.service';

const router = Router();

// ─── Public — Retention intake form (no login) ───────────────────
// Registered ahead of `authenticate` below, so this one route is reachable unauthenticated —
// an external form filled by whoever just worked an AI-sourced call, no account to log
// into. Replaces the old Google Sheet the same data used to be logged into by hand.
router.post(
  '/retention/intake',
  asyncHandler(async (req, res) => {
    const result = await leadService.submitRetentionIntake(req.body ?? {});
    return sendResult(res, result, 'Lead submitted', 201);
  })
);

router.use(authenticate);

// A MANAGER may only act on Closer/Retention leads — Junior-Closer-originated leads are Team
// Lead's. Two hooks between them cover every mutation: router.param for any route with an
// :id segment (req.params is only populated once a route has matched, so a plain
// router.use can't see it), and the body check for batch routes that take leadIds.
async function rejectOutOfManagerScope(
  req: Request,
  res: Response,
  next: NextFunction,
  ids: string[]
): Promise<void> {
  if (req.user!.role !== 'MANAGER' || req.method === 'GET' || ids.length === 0) return next();
  if (!(await leadService.leadsInManagerScope(ids))) {
    apiError(res, 'Forbidden', 403);
    return;
  }
  next();
}

router.param('id', (req, res, next, id) => {
  rejectOutOfManagerScope(req, res, next, [String(id)]).catch(next);
});

router.use(
  asyncHandler(async (req, res, next) => {
    const leadIds: unknown[] = Array.isArray(req.body?.leadIds) ? req.body.leadIds : [];
    await rejectOutOfManagerScope(
      req,
      res,
      next,
      leadIds.filter((id): id is string => typeof id === 'string')
    );
  })
);

// ─── Junior Closer ──────────────────────────────────────────────
router.post(
  '/',
  requireRole('JUNIOR_CLOSER'),
  asyncHandler(async (req, res) => {
    const result = await leadService.submitLead(req.user!.id, req.body ?? {});
    return sendResult(res, result, 'Lead submitted', 201);
  })
);

router.post(
  '/cpl',
  requireRole('JUNIOR_CLOSER'),
  asyncHandler(async (req, res) => {
    const result = await leadService.submitCplLead(req.user!.id, req.body ?? {});
    return sendResult(res, result, 'Lead submitted', 201);
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
    return sendResult(res, result, 'Lead sent back to admin');
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
    return sendResult(res, result, 'Lead sent to admin');
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
    return sendResult(res, result, 'Lead saved as a draft');
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
    return sendResult(res, result, 'Lead sent back to admin');
  })
);

// Closer builds a lead from scratch — self-/AI-sourced calls with no Junior Closer
// involved. Combines junior intake + closer enrichment in one submission.
router.post(
  '/closer',
  requireRole('CLOSER'),
  asyncHandler(async (req, res) => {
    const result = await leadService.createLeadByCloser(req.user!.id, req.body ?? {});
    return sendResult(res, result, 'Lead submitted', 201);
  })
);

// Same as above, but parked as a draft — for a call the closer hasn't finished capturing.
router.post(
  '/closer/draft',
  requireRole('CLOSER'),
  asyncHandler(async (req, res) => {
    const result = await leadService.createDraftByCloser(req.user!.id, req.body ?? {});
    return sendResult(res, result, 'Lead saved as a draft', 201);
  })
);

// ─── Admin ──────────────────────────────────────────────────────
router.get(
  '/queue',
  requireRole('ADMIN', 'MANAGER'),
  asyncHandler(async (req, res) => {
    const leads = await leadService.listQueueForAdmin(req.user!.role as 'ADMIN' | 'MANAGER');
    return apiSuccess(res, { leads });
  })
);

router.get(
  '/all',
  requireRole('ADMIN', 'MANAGER'),
  asyncHandler(async (req, res) => {
    const leads = await leadService.listAllLeadsForAdmin(req.user!.role as 'ADMIN' | 'MANAGER');
    return apiSuccess(res, { leads });
  })
);

router.get(
  '/charge-backs',
  requireRole('ADMIN', 'MANAGER'),
  asyncHandler(async (req, res) => {
    const leads = await leadService.listChargeBacksForAdmin(req.user!.role as 'ADMIN' | 'MANAGER');
    return apiSuccess(res, { leads });
  })
);

router.get(
  '/cpl',
  requireRole('ADMIN', 'MANAGER'),
  asyncHandler(async (req, res) => {
    const leads = await leadService.listCplLeadsForAdmin(req.user!.role as 'ADMIN' | 'MANAGER');
    return apiSuccess(res, { leads });
  })
);

// Distinct path from the Closer-only '/drafts' above — same router, different role.
router.get(
  '/admin/drafts',
  requireRole('ADMIN', 'MANAGER'),
  asyncHandler(async (req, res) => {
    const leads = await leadService.listDraftsForAdmin(req.user!.role as 'ADMIN' | 'MANAGER');
    return apiSuccess(res, { leads });
  })
);

router.patch(
  '/:id/assign',
  requireRole('ADMIN', 'MANAGER'),
  asyncHandler(async (req, res) => {
    const { clientId } = req.body ?? {};
    if (!clientId || typeof clientId !== 'string') return apiError(res, 'clientId is required', 400);

    const result = await leadService.assignLeadToClient(req.params.id, clientId, req.user!.id);
    return sendResult(res, result, 'Lead assigned');
  })
);

router.patch(
  '/:id/assign-external',
  requireRole('ADMIN', 'MANAGER'),
  asyncHandler(async (req, res) => {
    const { externalClientId } = req.body ?? {};
    if (!externalClientId || typeof externalClientId !== 'string') return apiError(res, 'externalClientId is required', 400);

    const result = await leadService.assignLeadToExternalClient(req.params.id, externalClientId, req.user!.id);
    return sendResult(res, result, 'Lead assigned to external client');
  })
);

router.patch(
  '/:id/return',
  requireRole('ADMIN', 'MANAGER'),
  asyncHandler(async (req, res) => {
    const { target, reason } = req.body ?? {};
    if (target !== 'JUNIOR_CLOSER' && target !== 'CLOSER' && target !== 'RETENTION') {
      return apiError(res, 'target must be JUNIOR_CLOSER, CLOSER, or RETENTION', 400);
    }
    const result = await leadService.returnLeadForEdit(req.params.id, target, reason, req.user!.id);
    return sendResult(res, result, 'Lead sent back for editing');
  })
);

router.patch(
  '/batch-decision',
  requireRole('ADMIN', 'MANAGER'),
  asyncHandler(async (req, res) => {
    const { leadIds, decision, reason } = req.body ?? {};
    const result = await leadService.batchDecideAsAdmin(leadIds, decision, reason, req.user!.id);
    return sendResult(res, result, decision === 'ACCEPT' ? 'Leads approved' : 'Leads declined');
  })
);

router.patch(
  '/batch-payment',
  requireRole('ADMIN', 'MANAGER'),
  asyncHandler(async (req, res) => {
    const { leadIds, pkrAmount, note } = req.body ?? {};
    const result = await leadService.batchMarkPaid(leadIds, pkrAmount, note, req.user!.id);
    return sendResult(res, result, 'Leads marked paid');
  })
);

router.patch(
  '/batch-charge-back',
  requireRole('ADMIN', 'MANAGER'),
  asyncHandler(async (req, res) => {
    const { leadIds, pkrAmount, reason } = req.body ?? {};
    const result = await leadService.batchChargeBack(leadIds, pkrAmount, reason);
    return sendResult(res, result, 'Leads marked charged back');
  })
);

router.patch(
  '/:id/charge-back',
  requireRole('ADMIN', 'MANAGER'),
  asyncHandler(async (req, res) => {
    const { pkrAmount, reason } = req.body ?? {};
    const result = await leadService.markLeadChargedBack(req.params.id, pkrAmount, reason);
    return sendResult(res, result, 'Lead marked charged back');
  })
);

router.patch(
  '/:id/payment-status',
  requireRole('ADMIN', 'MANAGER'),
  asyncHandler(async (req, res) => {
    const { paymentStatus } = req.body ?? {};
    // Marking a lead PAID must go through /batch-payment so the PKR amount received is
    // always recorded — this endpoint only reverts a mistaken PAID back to UNPAID.
    if (paymentStatus !== 'UNPAID') {
      return apiError(res, 'paymentStatus must be UNPAID — use batch-payment to mark a lead paid', 400);
    }
    const result = await leadService.setLeadPaymentStatus(req.params.id);
    return sendResult(res, result, 'Payment status updated');
  })
);

router.patch(
  '/:id',
  requireRole('ADMIN', 'MANAGER'),
  asyncHandler(async (req, res) => {
    const result = await leadService.editLead(req.params.id, req.body ?? {});
    return sendResult(res, result, 'Lead updated');
  })
);

// ─── Retention (admin-facing) ────────────────────────────────────
router.get(
  '/retention/unassigned',
  requireRole('ADMIN', 'MANAGER'),
  asyncHandler(async (_req, res) => {
    const leads = await leadService.listUnassignedRetentionForAdmin();
    return apiSuccess(res, { leads });
  })
);

router.get(
  '/retention/all',
  requireRole('ADMIN', 'MANAGER'),
  asyncHandler(async (_req, res) => {
    const leads = await leadService.listRetentionAllForAdmin();
    return apiSuccess(res, { leads });
  })
);

// Retention History — full lifecycle of every retention lead. ADMIN/MANAGER only; carries no
// PKR figures. (Not '/retention/history': that path is the Retention role's own history page.)
router.get(
  '/retention/lifecycle',
  requireRole('ADMIN', 'MANAGER'),
  asyncHandler(async (_req, res) => {
    const leads = await retentionHistory.listRetentionHistory();
    return apiSuccess(res, { leads });
  })
);

router.get(
  '/retention/lifecycle/:id',
  requireRole('ADMIN', 'MANAGER'),
  asyncHandler(async (req, res) => {
    const result = await retentionHistory.getRetentionHistory(req.params.id);
    return sendResult(res, result);
  })
);

// Admin-only: the manager scope middleware above would 403 this path for a MANAGER anyway.
router.post(
  '/retention/sync',
  requireRole('ADMIN'),
  asyncHandler(async (req, res) => {
    if (!sheetSync.isSheetSyncConfigured()) return apiError(res, 'Google Sheet sync is not configured', 400);
    try {
      return apiSuccess(res, await sheetSync.syncRetentionSheet(), 'Sync complete');
    } catch (err) {
      reportError(err, req);
      return apiError(res, err instanceof Error ? err.message : 'Sync failed', 502);
    }
  })
);

router.patch(
  '/retention/:id/assign',
  requireRole('ADMIN', 'MANAGER'),
  asyncHandler(async (req, res) => {
    const { retentionId } = req.body ?? {};
    if (!retentionId || typeof retentionId !== 'string') return apiError(res, 'retentionId is required', 400);

    const result = await leadService.assignLeadToRetention(req.params.id, retentionId, req.user!.id);
    return sendResult(res, result, 'Lead assigned');
  })
);

router.patch(
  '/retention/batch-assign',
  requireRole('ADMIN', 'MANAGER'),
  asyncHandler(async (req, res) => {
    const { leadIds, retentionId } = req.body ?? {};
    const result = await leadService.batchAssignToRetention(leadIds, retentionId, req.user!.id);
    return sendResult(res, result, 'Leads assigned');
  })
);

// ─── Retention (retention-facing) ────────────────────────────────
// Retention builds a lead from scratch — same pattern as Closer's '/closer' create route.
router.post(
  '/retention',
  requireRole('RETENTION'),
  asyncHandler(async (req, res) => {
    const result = await leadService.createLeadByRetention(req.user!.id, req.body ?? {});
    return sendResult(res, result, 'Lead submitted', 201);
  })
);

// Same as above, but parked as a draft — for a call the retention person hasn't finished
// capturing yet.
router.post(
  '/retention/draft',
  requireRole('RETENTION'),
  asyncHandler(async (req, res) => {
    const result = await leadService.createDraftByRetention(req.user!.id, req.body ?? {});
    return sendResult(res, result, 'Lead saved as a draft', 201);
  })
);

router.get(
  '/retention/queue',
  requireRole('RETENTION'),
  asyncHandler(async (req, res) => {
    const leads = await leadService.listRetentionQueue(req.user!.id);
    return apiSuccess(res, { leads });
  })
);

router.patch(
  '/retention/:id/submit',
  requireRole('RETENTION'),
  asyncHandler(async (req, res) => {
    const result = await leadService.enrichAndSubmitRetentionLead(req.params.id, req.user!.id, req.body ?? {});
    return sendResult(res, result, 'Lead sent to admin');
  })
);

router.patch(
  '/retention/:id/draft',
  requireRole('RETENTION'),
  asyncHandler(async (req, res) => {
    const result = await leadService.saveRetentionLeadAsDraft(req.params.id, req.user!.id, req.body ?? {});
    return sendResult(res, result, 'Lead saved as a draft');
  })
);

// Callback: only the person who marked it sees the lead until they remove it (see
// markRetentionCallback in lead.service.ts).
router.patch(
  '/retention/:id/callback',
  requireRole('RETENTION'),
  asyncHandler(async (req, res) => {
    const result = await leadService.markRetentionCallback(req.params.id, req.user!.id);
    return sendResult(res, result, 'Lead marked as a callback');
  })
);

router.delete(
  '/retention/:id/callback',
  requireRole('RETENTION'),
  asyncHandler(async (req, res) => {
    const result = await leadService.removeRetentionCallback(req.params.id, req.user!.id);
    return sendResult(res, result, 'Callback removed');
  })
);

router.get(
  '/retention/history',
  requireRole('RETENTION'),
  asyncHandler(async (_req, res) => {
    const leads = await leadService.listRetentionHistory();
    return apiSuccess(res, { leads });
  })
);

// ─── Team Lead ──────────────────────────────────────────────────
router.get(
  '/team-lead/leads',
  requireRole('TEAM_LEAD'),
  asyncHandler(async (_req, res) => {
    const leads = await leadService.listLeadsForTeamLead();
    return apiSuccess(res, { leads });
  })
);

// ─── QA ─────────────────────────────────────────────────────────
router.get(
  '/qa/junior-queue',
  requireRole('QA_JUNIOR_CLOSER'),
  asyncHandler(async (_req, res) => {
    const leads = await leadService.listQaJuniorQueue();
    return apiSuccess(res, { leads });
  })
);

router.get(
  '/qa/junior-history',
  requireRole('QA_JUNIOR_CLOSER'),
  asyncHandler(async (req, res) => {
    const reviews = await leadService.listQaJuniorHistory(req.user!.id);
    return apiSuccess(res, { reviews });
  })
);

router.get(
  '/qa/closer-queue',
  requireRole('QA_CLOSER'),
  asyncHandler(async (_req, res) => {
    const leads = await leadService.listQaCloserQueue();
    return apiSuccess(res, { leads });
  })
);

router.get(
  '/qa/closer-history',
  requireRole('QA_CLOSER'),
  asyncHandler(async (req, res) => {
    const reviews = await leadService.listQaCloserHistory(req.user!.id);
    return apiSuccess(res, { reviews });
  })
);

router.patch(
  '/:id/qa-review',
  requireRole('QA_JUNIOR_CLOSER', 'QA_CLOSER'),
  asyncHandler(async (req, res) => {
    const result = await leadService.submitQaReview(
      req.params.id,
      req.user! as { id: string; role: 'QA_JUNIOR_CLOSER' | 'QA_CLOSER' },
      req.body ?? {}
    );
    return sendResult(res, result, 'Review recorded', 201);
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
  '/:id/client-edit',
  requireRole('CLIENT'),
  asyncHandler(async (req, res) => {
    const result = await leadService.editAssignedLeadByClient(req.params.id, req.user!.id, req.body ?? {});
    return sendResult(res, result, 'Lead updated');
  })
);

router.patch(
  '/:id/accept',
  requireRole('CLIENT'),
  asyncHandler(async (req, res) => {
    const result = await leadService.acceptLead(req.params.id, req.user!.id);
    return sendResult(res, result, 'Lead approved');
  })
);

router.patch(
  '/:id/reject',
  requireRole('CLIENT'),
  asyncHandler(async (req, res) => {
    const { reason } = req.body ?? {};
    const result = await leadService.rejectLead(req.params.id, req.user!.id, reason);
    return sendResult(res, result, 'Lead declined');
  })
);

// ─── Shared — any authenticated role, ownership + masking enforced in service layer ──
router.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const result = await leadService.getLeadById(req.params.id, req.user!);
    return sendResult(res, result);
  })
);

export default router;
