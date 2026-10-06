import type { NextFunction, Request, Response } from "express";
import type { Role } from "@prisma/client";
import { verifyToken } from "../lib/jwt";
import { apiError } from "../lib/api-response";
import { getClientIp } from "../lib/client-ip";
import { IP_EXEMPT_ROLES, isIpWhitelisted } from "../lib/ip-whitelist";
import prisma from "../lib/prisma";

/** Verifies the bearer JWT and attaches { id, role, tokenVersion } to req.user. Also re-checks
 * the caller's IP against the whitelist on every request (not just at login) — see
 * lib/ip-whitelist.ts — so a session started in the office stops working the moment the device
 * leaves it. The client's authInterceptor logs the user out on the resulting IP_NOT_WHITELISTED
 * code exactly like it does on a 401. */
export async function authenticate(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) return apiError(res, "Unauthorized", 401);

  try {
    const payload = verifyToken(token);

    // tokenVersion check invalidates already-issued tokens on password/role change.
    const user = await prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, role: true, tokenVersion: true },
    });

    if (!user || user.tokenVersion !== payload.tokenVersion) {
      return apiError(res, "Session expired, please log in again", 401);
    }

    if (!IP_EXEMPT_ROLES.includes(user.role) && !(await isIpWhitelisted(getClientIp(req)))) {
      // TEMP DEBUG — remove once IP whitelisting is confirmed working end-to-end.
      console.log("[ip-whitelist] blocked", {
        detectedIp: getClientIp(req),
        xForwardedFor: req.headers["x-forwarded-for"],
        rawSocketIp: req.socket.remoteAddress,
      });
      return apiError(
        res,
        "This network is not authorized to use the app. Contact your admin to whitelist your IP.",
        403,
        "IP_NOT_WHITELISTED"
      );
    }

    req.user = { id: user.id, role: user.role, tokenVersion: user.tokenVersion };
    next();
  } catch {
    return apiError(res, "Unauthorized", 401);
  }
}

/** Role gate — use after authenticate(). */
export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return apiError(res, "Unauthorized", 401);
    if (!roles.includes(req.user.role)) return apiError(res, "Forbidden", 403);
    next();
  };
}
