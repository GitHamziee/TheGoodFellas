import prisma from '../lib/prisma';
import { isNonEmptyString } from '../lib/validation';

type ServiceResult<T> = { data: T; status?: never } | { error: string; status: number };

const SELECT = { id: true, ipAddress: true, label: true, createdAt: true } as const;

// Loose IPv4/IPv6 shape check, with an optional CIDR suffix (e.g. "2407:d000:2b:6a93::/64")
// — not exhaustive, just enough to catch an obvious typo before it silently never matches a
// real request. A CIDR range matters because mobile/office ISPs commonly hand out a stable
// network prefix but rotate the host portion (IPv6 privacy addresses).
const IP_PATTERN = /^((\d{1,3}\.){3}\d{1,3}|[0-9a-fA-F:]+)(\/\d{1,3})?$/;

function isValidPrefixLength(ipAddress: string): boolean {
  const [base, prefixStr] = ipAddress.split('/');
  if (prefixStr === undefined) return true;
  const prefix = Number(prefixStr);
  const max = base.includes('.') ? 32 : 128;
  return Number.isInteger(prefix) && prefix >= 0 && prefix <= max;
}

export async function listWhitelistedIps() {
  return prisma.whitelistedIp.findMany({ select: SELECT, orderBy: { createdAt: 'desc' } });
}

export async function addWhitelistedIp(input: { ipAddress?: unknown; label?: unknown }): Promise<ServiceResult<{ ip: unknown }>> {
  const { ipAddress, label } = input;

  if (!isNonEmptyString(ipAddress) || !IP_PATTERN.test(ipAddress.trim()) || !isValidPrefixLength(ipAddress.trim())) {
    return { error: 'Enter a valid IP address or CIDR range (e.g. 2407:d000:2b:6a93::/64)', status: 400 };
  }
  if (label !== undefined && label !== null && typeof label !== 'string') {
    return { error: 'Invalid label', status: 400 };
  }

  const cleanIp = ipAddress.trim();
  const existing = await prisma.whitelistedIp.findUnique({ where: { ipAddress: cleanIp } });
  if (existing) return { error: 'This IP is already whitelisted', status: 409 };

  const ip = await prisma.whitelistedIp.create({
    data: { ipAddress: cleanIp, label: isNonEmptyString(label) ? label.trim() : null },
    select: SELECT,
  });

  return { data: { ip } };
}

export async function deleteWhitelistedIp(id: string): Promise<ServiceResult<{ id: string }>> {
  const existing = await prisma.whitelistedIp.findUnique({ where: { id } });
  if (!existing) return { error: 'IP not found', status: 404 };

  await prisma.whitelistedIp.delete({ where: { id } });
  return { data: { id } };
}
