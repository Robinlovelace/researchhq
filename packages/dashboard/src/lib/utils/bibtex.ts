/**
 * Shared BibTeX generation and blob download helpers.
 *
 * Rendering is delegated to the single canonical implementation in
 * `@researchhq/schema` (`publicationToBibtex` / `publicationsToBibtex`), so
 * citation keys always derive from the first author's SURNAME, escaping is
 * consistent, and colliding cite keys are disambiguated with `a`, `b`, `c`
 * suffixes exactly like the CLI export.
 */
import { publicationToBibtex, publicationsToBibtex } from '@researchhq/schema';
import type { Publication } from '@researchhq/schema';

export { publicationToBibtex, publicationsToBibtex } from '@researchhq/schema';

/**
 * Surname of the first author: the last whitespace-separated token of
 * `authors[0]`, never the given name ("Robin Lovelace" -> "lovelace").
 */
export function firstAuthorSurname(pub: Publication): string {
  const first = pub.authors[0] ?? '';
  const token = first.trim().split(/\s+/).pop() ?? '';
  return token.replace(/[^A-Za-z]/g, '').toLowerCase();
}

/** Deduplicated citation key: `surname{year}{first-title-word}` by default. */
export function citeKeyFor(pub: Publication, used: Set<string>): string {
  const surname = firstAuthorSurname(pub) || 'anon';
  const titleWord =
    pub.title.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ')[0] ?? 'untitled';
  const base = pub.bibtexKey ?? `${surname}${pub.year}${titleWord}`;
  const safeBase = base.replace(/[^A-Za-z0-9-]/g, '');
  let key = safeBase;
  let counter = 2;
  while (used.has(key)) {
    key = `${safeBase}-${counter}`;
    counter++;
  }
  used.add(key);
  return key;
}

/** One formatted BibTeX entry (no trailing separator). */
export function buildBibtexEntry(pub: Publication, used: Set<string>): string {
  return publicationToBibtex(pub, { keyOverride: citeKeyFor(pub, used) });
}

/** Filtered multi-entry export body, or an empty string for no matches. */
export function buildBibtex(pubs: Publication[]): string {
  const body = publicationsToBibtex(pubs);
  return body.length > 0 ? `${body}\n` : '';
}

/**
 * Trigger a client-side file download and release the blob URL 1000 ms after
 * the click, so WebKit/Firefox never race the download against revocation.
 */
export function downloadTextFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
