import type { Request } from 'express'
import { env } from '../env.js'
import { isPrivateIp } from '../http/ip.js'

/**
 * §5.4 needs two things this service cannot know on its own: whether an IP
 * belongs to a hosting/VPN ASN (`datacenter_ip`) and which country it is in
 * (`foreign_ip`).
 *
 * Country is free when the site sits behind Cloudflare — it arrives as
 * `CF-IPCountry` — and is read here only when `TRUST_CLOUDFLARE` is on, since
 * otherwise the header is attacker-supplied.
 *
 * ASN classification needs a data source (MaxMind GeoLite2-ASN, IPinfo, or
 * Cloudflare's bot score). v1 ships the seam, not the subscription:
 * `lookupDatacenter` returns false unless you plug one in. Everything else in
 * §5 works without it — this flag only ever adds a badge in the dashboard.
 */

export interface IpIntel {
  country: string | null
  datacenter: boolean
}

export type DatacenterLookup = (ip: string) => Promise<boolean> | boolean

let datacenterLookup: DatacenterLookup = () => false

/** Swap in a real ASN provider at boot: `setDatacenterLookup(maxmindLookup)`. */
export function setDatacenterLookup(lookup: DatacenterLookup): void {
  datacenterLookup = lookup
}

export async function resolveIpIntel(req: Request, ip: string | null): Promise<IpIntel> {
  let country: string | null = null

  if (env.TRUST_CLOUDFLARE) {
    const header = req.headers['cf-ipcountry']
    const value = Array.isArray(header) ? header[0] : header
    // XX = unknown, T1 = Tor exit. Neither says anything about the country.
    if (value && /^[A-Za-z]{2}$/.test(value) && !['XX', 'T1'].includes(value.toUpperCase())) {
      country = value.toUpperCase()
    }
  }

  if (!ip || isPrivateIp(ip)) return { country, datacenter: false }

  try {
    return { country, datacenter: await datacenterLookup(ip) }
  } catch {
    // An intel provider being down must never cost a lead.
    return { country, datacenter: false }
  }
}
