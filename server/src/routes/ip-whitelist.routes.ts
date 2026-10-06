import { Router } from 'express';
import { apiError, apiSuccess } from '../lib/api-response';
import { asyncHandler } from '../lib/async-handler';
import { authenticate, requireRole } from '../middleware/auth';
import { getClientIp } from '../lib/client-ip';
import { suggestWhitelistEntry } from '../lib/ip-whitelist';
import * as ipWhitelistService from '../services/ip-whitelist.service';

const router = Router();
router.use(authenticate);
router.use(requireRole('ADMIN'));

router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const ips = await ipWhitelistService.listWhitelistedIps();
    return apiSuccess(res, { ips });
  })
);

// Lets an Admin whitelist "this connection" with one click instead of hunting down and
// typing their own IP — most non-technical admins wouldn't otherwise know what to enter,
// let alone that IPv6 needs widening to a /64 to stay stable. Admin-only, so it can only
// ever leak the caller's own network, not anyone else's.
router.get(
  '/detect',
  asyncHandler(async (req, res) => {
    const ip = getClientIp(req);
    return apiSuccess(res, { ip, suggested: suggestWhitelistEntry(ip) });
  })
);

router.post(
  '/',
  asyncHandler(async (req, res) => {
    const result = await ipWhitelistService.addWhitelistedIp(req.body ?? {});
    if ('error' in result) return apiError(res, result.error, result.status);
    return apiSuccess(res, result.data, 'IP whitelisted', 201);
  })
);

router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const result = await ipWhitelistService.deleteWhitelistedIp(req.params.id);
    if ('error' in result) return apiError(res, result.error, result.status);
    return apiSuccess(res, result.data, 'IP removed');
  })
);

export default router;
