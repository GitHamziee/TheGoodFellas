import type { Role } from "@prisma/client";
import prisma from "./prisma";

/** Roles that bypass IP whitelisting entirely — ADMIN manages the whitelist itself and needs
 * to reach it from anywhere; CLIENT accounts are external companies with no tie to the office
 * network. Every other role only works from an IP an Admin has explicitly whitelisted, checked
 * at login (auth.service.ts#login) and on every subsequent request (middleware/auth.ts). */
export const IP_EXEMPT_ROLES: Role[] = ["ADMIN", "CLIENT"];

function isIpv4(ip: string): boolean {
  return ip.includes(".") && !ip.includes(":");
}

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

/** Expands IPv6 "::" shorthand and returns the address as a single 128-bit integer, so a
 * prefix comparison is just a bit-shift — avoids pulling in a CIDR library for one use site. */
function ipv6ToBigInt(ip: string): bigint {
  const [head, tail] = ip.split("::");
  const headGroups = head ? head.split(":") : [];
  const tailGroups = tail ? tail.split(":") : [];
  const missing = 8 - headGroups.length - tailGroups.length;
  const groups = ip.includes("::") ? [...headGroups, ...Array(missing).fill("0"), ...tailGroups] : ip.split(":");
  return groups.reduce((acc, g) => (acc << 16n) + BigInt(parseInt(g || "0", 16)), 0n);
}

/** True if `ip` is exactly `entry`, or falls inside `entry` when it's a CIDR range
 * (e.g. "2407:d000:2b:6a93::/64") — a mobile/office ISP typically hands out a stable network
 * prefix but rotates the host portion (IPv6 privacy addresses), so exact-match alone can't
 * whitelist that connection reliably. */
function ipMatchesEntry(ip: string, entry: string): boolean {
  const [base, prefixStr] = entry.split("/");
  if (prefixStr === undefined) return ip === base;

  const prefix = Number(prefixStr);
  if (isIpv4(ip) && isIpv4(base)) {
    const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
    return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask);
  }
  if (!isIpv4(ip) && !isIpv4(base)) {
    const shift = BigInt(128 - prefix);
    return ipv6ToBigInt(ip) >> shift === ipv6ToBigInt(base) >> shift;
  }
  return false;
}

export async function isIpWhitelisted(ip: string): Promise<boolean> {
  if (!ip) return false;
  // Small table (a handful of office/CIDR entries) — fetching all and matching in app code
  // is simpler and cheap enough, and lets a CIDR entry match without a second query shape.
  const entries = await prisma.whitelistedIp.findMany({ select: { ipAddress: true } });
  return entries.some((e) => ipMatchesEntry(ip, e.ipAddress));
}

/** Masks `ip` down to its top `prefixLen` bits and renders it back as a canonical (RFC
 * 5952-style) compressed IPv6 string — used to turn "here's my address right now" into a
 * stable range an admin can actually whitelist once. */
function ipv6NetworkPrefix(ip: string, prefixLen: number): string {
  const shift = BigInt(128 - prefixLen);
  const masked = (ipv6ToBigInt(ip) >> shift) << shift;

  const groups: string[] = [];
  for (let i = 7; i >= 0; i--) {
    groups.push(((masked >> BigInt(i * 16)) & 0xffffn).toString(16));
  }

  let bestStart = -1;
  let bestLen = 0;
  let curStart = -1;
  let curLen = 0;
  for (let i = 0; i < groups.length; i++) {
    if (groups[i] === "0") {
      if (curStart === -1) curStart = i;
      curLen++;
      if (curLen > bestLen) {
        bestLen = curLen;
        bestStart = curStart;
      }
    } else {
      curStart = -1;
      curLen = 0;
    }
  }
  if (bestLen < 2) return groups.join(":");
  return `${groups.slice(0, bestStart).join(":")}::${groups.slice(bestStart + bestLen).join(":")}`;
}

/** What an admin should actually type in to whitelist "this connection" — the exact address
 * for IPv4 (a business line's public IP is normally stable), or the /64 network prefix for
 * IPv6 (the part an ISP actually keeps stable; the host portion rotates under privacy
 * extensions, so whitelisting the full address would silently stop matching within a day). */
export function suggestWhitelistEntry(ip: string): string {
  if (!ip || isIpv4(ip)) return ip;
  return `${ipv6NetworkPrefix(ip, 64)}/64`;
}

/** True for addresses that can never identify a real remote network � loopback, unspecified,
 * link-local and private ranges. Seeing one means the server is looking at its own proxy (or
 * the admin's own machine) rather than the visitor, so there is nothing sensible to whitelist. */
export function isNonRoutableIp(ip: string): boolean {
  if (!ip) return true;
  if (isIpv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const lower = ip.toLowerCase();
  return lower === "::" || lower === "::1" || /^f[cd]/.test(lower) || /^fe[89ab]/.test(lower);
}
