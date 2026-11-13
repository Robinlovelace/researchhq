/**
 * Safe external URL helpers for user- and export-sourced links.
 *
 * Every external <a href> that renders data from the portfolio snapshot must
 * pass through these helpers so `javascript:`, `data:`, and malformed values
 * can never become live hrefs.
 */

const SAFE_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * Returns a sanitized http(s) URL string, or null when the input is empty,
 * malformed, or uses a non-http(s) protocol (javascript:, data:, mailto:, ...).
 * Only the first whitespace-separated token is considered, so trailing
 * prose glued onto an exported URL cannot hijack the link target.
 */
export function safeHref(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;
  const token = raw.trim().split(/\s+/)[0] ?? '';
  if (!token) return null;
  try {
    const parsed = new URL(token);
    if (!SAFE_PROTOCOLS.has(parsed.protocol)) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

/**
 * Returns an https://doi.org link for a DOI string, or null when the DOI is
 * empty or contains whitespace (which would produce a broken link).
 */
export function doiHref(doi: string | null | undefined): string | null {
  if (typeof doi !== 'string') return null;
  const clean = doi.trim();
  if (!clean || /\s/.test(clean)) return null;
  return `https://doi.org/${encodeURI(clean)}`;
}
