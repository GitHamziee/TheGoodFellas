import jwt from "jsonwebtoken";
import { env } from "./env";
import type { Role } from "@prisma/client";

export interface JwtPayload {
  sub: string; // user id
  role: Role;
  tokenVersion: number;
}

export function signToken(payload: JwtPayload): string {
  return jwt.sign(payload, env.jwtSecret, { expiresIn: env.jwtExpiresIn as jwt.SignOptions["expiresIn"] });
}

export function verifyToken(token: string): JwtPayload {
  return jwt.verify(token, env.jwtSecret) as JwtPayload;
}

/** True for a bad, expired or not-yet-valid token — an expected auth failure, not a bug. */
export function isTokenError(err: unknown): boolean {
  return err instanceof jwt.JsonWebTokenError;
}
