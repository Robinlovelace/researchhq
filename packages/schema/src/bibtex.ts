/**
 * BibTeX export helpers: escape BibTeX/LaTeX special characters and render
 * publications as `@article`/`@book`/`@incollection`/`@techreport`/`@misc`
 * entries with unique cite keys of the form `surnameYEARfirsttitleword`
 * (for example `lovelace2016propensity`, disambiguated with `a`, `b`, `c`...).
 */
import type { Publication } from './schemas.js';

/** Characters that must be escaped inside BibTeX field values. */
const BIBTEX_ESCAPES: Record<string, string> = {
  '\\': '\\textbackslash{}',
  '{': '\\{',
  '}': '\\}',
  '&': '\\&',
  '%': '\\%',
  '$': '\\$',
  '_': '\\_',
  '#': '\\#',
  '^': '\\^{}',
  '~': '\\~{}',
};

/** Escape `\ { } & % $ _ # ^ ~` so the text survives BibTeX and LaTeX parsing. */
export function escapeBibtex(text: string): string {
  return text.replace(/[\\{}&%$#_^~]/g, (ch) => BIBTEX_ESCAPES[ch] ?? ch);
}

/** Strip diacritics and non-ASCII-letter characters for cite keys. */
function asciiLower(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

/** Extract the surname of an author string ('Robin Lovelace' or 'Lovelace, Robin'). */
function authorSurname(author: string | undefined): string {
  if (!author) return '';
  const trimmed = author.trim();
  const fromComma = trimmed.includes(',') ? trimmed.split(',')[0] : trimmed.split(/\s+/).pop();
  return asciiLower(fromComma ?? '');
}

/**
 * Stable cite key: first author's SURNAME + year + first significant title
 * word (diacritics folded first), e.g. `lovelace2016propensity`. An explicit
 * `bibtexKey` on the publication always wins.
 */
export function bibtexKeyFor(pub: Publication): string {
  if (pub.bibtexKey) return pub.bibtexKey;
  const normalizedTitle = pub.title
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9\s]/g, ' ');
  const words = normalizedTitle.trim().split(/\s+/).filter(Boolean);
  const word = words.find((w) => w.length >= 4) ?? words[0] ?? 'untitled';
  return `${authorSurname(pub.authors[0]) || 'unknown'}${pub.year}${word.toLowerCase()}`;
}

function bibtexEntryType(pub: Publication): string {
  switch (pub.type) {
    case 'article':
      return 'article';
    case 'book':
      return 'book';
    case 'book-chapter':
      return 'incollection';
    case 'report':
      return 'techreport';
    default:
      // preprint, software, other
      return 'misc';
  }
}

function venueFieldFor(entryType: string): string {
  switch (entryType) {
    case 'article':
      return 'journal';
    case 'incollection':
      return 'booktitle';
    case 'book':
      return 'publisher';
    case 'techreport':
      return 'institution';
    default:
      return 'howpublished';
  }
}

function cleanSingleUrl(rawUrl: string | null | undefined): string | null {
  if (!rawUrl) return null;
  const first = rawUrl.trim().split(/\s+/)[0];
  return first && /^https?:\/\//i.test(first) ? first : first || null;
}

export interface BibtexExportOptions {
  /** Include `note = {N citations (OpenAlex)}` on entries with citations > 0 (default: false). */
  includeCitationNote?: boolean;
  /** Override cite key (used internally when deduplicating colliding keys). */
  keyOverride?: string;
}

/** Render a single publication as a BibTeX entry string. */
export function publicationToBibtex(pub: Publication, options?: BibtexExportOptions): string {
  const entryType = bibtexEntryType(pub);
  const venueField = venueFieldFor(entryType);
  const fields: string[] = [
    `author = {${escapeBibtex(pub.authors.join(' and '))}}`,
    `title = {${escapeBibtex(pub.title)}}`,
  ];
  if (pub.venue) {
    fields.push(`${venueField} = {${escapeBibtex(pub.venue)}}`);
  }
  fields.push(`year = {${String(pub.year)}}`);
  if (pub.doi) fields.push(`doi = {${pub.doi}}`);
  const singleUrl = cleanSingleUrl(pub.url);
  if (singleUrl) fields.push(`url = {${singleUrl}}`);
  if (pub.abstract) fields.push(`abstract = {${escapeBibtex(pub.abstract)}}`);
  if (options?.includeCitationNote === true && pub.citations > 0) {
    fields.push(`note = {${String(pub.citations)} citations (OpenAlex)}`);
  }
  const citeKey = options?.keyOverride ?? bibtexKeyFor(pub);
  return `@${entryType}{${citeKey},\n${fields.map((f) => `  ${f}`).join(',\n')}\n}`;
}

/** Convert 0 -> 'a', 1 -> 'b', ..., 25 -> 'z', 26 -> 'aa'. */
function collisionSuffix(index: number): string {
  let n = index;
  let out = '';
  do {
    out = String.fromCharCode(97 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

/**
 * Render many publications as BibTeX entries separated by blank lines,
 * disambiguating duplicate cite keys with `a`, `b`, `c` suffixes so BibTeX
 * and biber never drop colliding entries.
 */
export function publicationsToBibtex(
  pubs: readonly Publication[],
  options?: Omit<BibtexExportOptions, 'keyOverride'>,
): string {
  const counts = new Map<string, number>();
  for (const pub of pubs) {
    const base = bibtexKeyFor(pub);
    counts.set(base, (counts.get(base) ?? 0) + 1);
  }
  const used = new Set<string>();
  const nextIdx = new Map<string, number>();

  return pubs
    .map((pub) => {
      const base = bibtexKeyFor(pub);
      let key = base;
      if ((counts.get(base) ?? 0) > 1 || used.has(key)) {
        let idx = nextIdx.get(base) ?? 0;
        let candidate = `${base}${collisionSuffix(idx)}`;
        while (used.has(candidate)) {
          idx += 1;
          candidate = `${base}${collisionSuffix(idx)}`;
        }
        nextIdx.set(base, idx + 1);
        key = candidate;
      }
      used.add(key);
      return publicationToBibtex(pub, { ...options, keyOverride: key });
    })
    .join('\n\n');
}
