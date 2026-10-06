import type { Request } from "express";

/** Real client IP for this request — respects Express's `trust proxy` setting (env.trustProxy),
 * so this only reflects X-Forwarded-For when the server is explicitly configured to trust the
 * proxy in front of it. Normalizes the IPv4-mapped-IPv6 form Node reports on dual-stack sockets
 * (e.g. "::ffff:203.0.113.42") down to plain IPv4 so it matches what an admin would type in. */
export function getClientIp(req: Request): string {
  const ip = req.ip ?? req.socket.remoteAddress ?? "";
  return ip.startsWith("::ffff:") ? ip.slice(7) : ip;
}
