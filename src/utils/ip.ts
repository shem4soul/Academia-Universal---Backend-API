/** IP allowlist matching for IPv4 addresses/CIDRs and exact IPv6 addresses. */

const v4ToInt = (ip: string) => ip.split('.').reduce((n, part) => (n << 8) + Number(part), 0) >>> 0;
const isV4 = (ip: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(ip);

/** Strips the IPv4-mapped IPv6 prefix Node uses (::ffff:1.2.3.4). */
export const normaliseIp = (ip?: string | null) => (ip ?? '').replace(/^::ffff:/, '');

export function ipAllowed(ipRaw: string | undefined | null, allowlist: string[]) {
  if (!allowlist.length) return true;
  const ip = normaliseIp(ipRaw);
  if (!ip) return false;
  return allowlist.some((entry) => {
    const [range, bitsStr] = entry.split('/');
    if (!bitsStr) return normaliseIp(range) === ip;
    if (!isV4(range) || !isV4(ip)) return false;
    const bits = Number(bitsStr);
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return (v4ToInt(range) & mask) === (v4ToInt(ip) & mask);
  });
}
