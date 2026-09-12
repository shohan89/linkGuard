import dns from "node:dns";

/**
 * Blocks the crawler from reaching internal/cloud-metadata addresses when a
 * merchant-supplied URL (or one of its redirect hops) resolves there.
 * Checked before every fetch in checkLink's redirect-following loop — a
 * malicious or compromised external site can redirect to an internal IP
 * just as easily as it can host one directly.
 *
 * This resolves the hostname up front and validates that address; the
 * actual fetch() re-resolves DNS itself, so a DNS answer that changes
 * between the two lookups (DNS rebinding) isn't fully closed by this check.
 * That's the standard, practical mitigation for SSRF-via-redirect — closing
 * the rebinding gap outright would require pinning fetch to the exact
 * address we checked, which undici's fetch doesn't expose a hook for.
 */
export class SsrfBlockedError extends Error {
  constructor(hostname: string) {
    super(`Refusing to fetch ${hostname}: resolves to a private/internal address`);
    this.name = "SsrfBlockedError";
  }
}

interface CidrV4 {
  base: number;
  bits: number;
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let result = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    result = (result << 8) | n;
  }
  return result >>> 0;
}

function cidr(base: string, bits: number): CidrV4 {
  return { base: ipv4ToInt(base)! >>> 0, bits };
}

// Private, loopback, link-local (incl. cloud metadata 169.254.0.0/16),
// carrier-grade NAT, and reserved ranges — anything not routable on the
// public internet.
const BLOCKED_V4_RANGES: CidrV4[] = [
  cidr("0.0.0.0", 8),
  cidr("10.0.0.0", 8),
  cidr("100.64.0.0", 10),
  cidr("127.0.0.0", 8),
  cidr("169.254.0.0", 16),
  cidr("172.16.0.0", 12),
  cidr("192.0.0.0", 24),
  cidr("192.168.0.0", 16),
  cidr("198.18.0.0", 15),
  cidr("224.0.0.0", 4),
];

function isBlockedV4(ip: string): boolean {
  const value = ipv4ToInt(ip);
  if (value === null) return false;
  return BLOCKED_V4_RANGES.some(({ base, bits }) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (value & mask) === (base & mask);
  });
}

function isBlockedV6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === "::1" || normalized === "::") return true;
  // IPv4-mapped IPv6 (::ffff:a.b.c.d) — check the embedded v4 address too.
  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isBlockedV4(mapped[1]);
  const firstGroup = normalized.split(":")[0];
  if (/^fe[89ab]/.test(firstGroup)) return true; // fe80::/10 link-local
  if (/^f[cd]/.test(firstGroup)) return true; // fc00::/7 unique-local
  return false;
}

function isBlockedAddress(address: string, family: number): boolean {
  return family === 6 ? isBlockedV6(address) : isBlockedV4(address);
}

/** Throws SsrfBlockedError if `hostname` resolves to any private/internal address. */
export async function assertPublicHostname(hostname: string): Promise<void> {
  let addresses: { address: string; family: number }[];
  try {
    addresses = await dns.promises.lookup(hostname, { all: true, verbatim: true });
  } catch {
    // Unresolvable host — let fetch() itself fail with the usual DNS_ERROR
    // classification rather than us pre-empting it here.
    return;
  }

  if (addresses.some((a) => isBlockedAddress(a.address, a.family))) {
    throw new SsrfBlockedError(hostname);
  }
}
