/**
 * D2DHQ fork: lightweight geo-block for recipient signing pages.
 *
 * sign.d2dhq.com is fronted by Cloudflare; CF tags every inbound request
 * with `CF-IPCountry`. D2DHQ contractor docs are US-only — refusing
 * signing attempts from outside the US closes off a common fraud vector
 * (someone outside the US trying to forge a 1099 contractor agreement).
 *
 * Behavior:
 *   - Header present + country != "US" → throw 403 Response with a plain
 *     text body. Loader-thrown Responses surface as Remix error boundaries.
 *   - Header absent → allow through. This covers local dev and any
 *     non-Cloudflare deployment so the dev loop isn't broken.
 *   - Header == "XX" or "T1" (CF's "anonymized/Tor" markers) → block.
 */
const BLOCKED_SENTINELS = new Set(['XX', 'T1']);

export const enforceUsOnlySigning = (request: Request): void => {
  const country = request.headers.get('cf-ipcountry')?.toUpperCase()?.trim();

  if (!country) {
    return; // No CF header — assume non-CF deploy or local dev. Allow.
  }

  if (BLOCKED_SENTINELS.has(country) || country !== 'US') {
    throw new Response(
      'This signing page is available in the United States only. If you are receiving this in error, contact the document sender.',
      { status: 403, headers: { 'content-type': 'text/plain; charset=utf-8' } },
    );
  }
};
