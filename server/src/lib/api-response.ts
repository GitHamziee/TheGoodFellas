import type { Response } from "express";

/** Consistent success response — { data, message } */
export function apiSuccess(res: Response, data: unknown, message?: string, status = 200) {
  return res.status(status).json({ data, ...(message ? { message } : {}) });
}

/** Consistent error response — { error }. `code` is an optional machine-readable tag (e.g.
 * "IP_NOT_WHITELISTED") for the small set of errors a client needs to branch on beyond the
 * HTTP status — most callers omit it and get the plain { error } shape. */
export function apiError(res: Response, message: string, status = 400, code?: string) {
  return res.status(status).json({ error: message, ...(code ? { code } : {}) });
}
