import type { NextFunction, Request, Response } from "express";
import type { Role } from "@prisma/client";
import { verifyToken } from "../lib/jwt";
import { apiError } from "../lib/api-response";
import prisma from "../lib/prisma";

/** Verifies the bearer JWT and attaches { id, role, tokenVersion } to req.user. */
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
