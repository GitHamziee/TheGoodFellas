import type { Response } from "express";

/** Consistent success response — { data, message } */
export function apiSuccess(res: Response, data: unknown, message?: string, status = 200) {
  return res.status(status).json({ data, ...(message ? { message } : {}) });
}

/** Consistent error response — { error } */
export function apiError(res: Response, message: string, status = 400) {
  return res.status(status).json({ error: message });
}
