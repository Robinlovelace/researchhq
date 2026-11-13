import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { normalizeJournalId } from '@researchhq/schema';

export interface OpenAlexClientOptions {
  apiKey?: string;
  mailto?: string;
  baseUrl?: string;
}

export interface RawOpenAlexAuthor {
  id: string;
  orcid?: string | null;
  display_name: string;
  works_count: number;
  cited_by_count: number;
  summary_stats?: {
    '2yr_mean_citedness'?: number;
    h_index?: number;
    i10_index?: number;
  };
  last_known_institutions?: Array<{
    display_name?: string;
  }>;
}

export interface RawOpenAlexSource {
  id: string;
  display_name: string;
  issn_l?: string | null;
  issn?: string[] | null;
  type?: string | null;
  host_organization_name?: string | null;
  is_oa?: boolean;
  is_in_doaj?: boolean;
  apc_usd?: number | null;
  homepage_url?: string | null;
  works_count?: number;
  cited_by_count?: number;
  summary_stats?: {
    '2yr_mean_citedness'?: number;
    h_index?: number;
    i10_index?: number;
  };
}

export interface RawOpenAlexLocation {
  is_oa?: boolean;
  landing_page_url?: string | null;
  pdf_url?: string | null;
  version?: string | null;
  source?: {
    id?: string | null;
    display_name?: string | null;
    issn_l?: string | null;
    issn?: string[] | null;
    is_oa?: boolean;
    is_in_doaj?: boolean;
    type?: string | null;
    host_organization_name?: string | null;
  } | null;
}

export interface RawOpenAlexWork {
  id: string;
  doi?: string | null;
  title?: string | null;
  display_name?: string | null;
  publication_year?: number | null;
  publication_date?: string | null;
  type?: string | null;
  cited_by_count?: number;
  fwci?: number | null;
  counts_by_year?: Array<{ year: number; cited_by_count: number }>;
  open_access?: {
    is_oa?: boolean;
    oa_status?: string | null;
    oa_url?: string | null;
  };
  primary_location?: RawOpenAlexLocation | null;
  locations?: RawOpenAlexLocation[];
  authorships?: Array<{
    author_position?: string;
    author?: {
      id?: string;
      display_name?: string;
      orcid?: string | null;
    };
  }>;
  topics?: Array<{
    display_name?: string;
  }>;
  abstract_inverted_index?: Record<string, number[]> | null;
}

/** All valid ORCID formats: bare, https://orcid.org/ and orcid: prefixed, 0000- and 0009- prefixes, X checksums. */
const ORCID_PATTERN = /^(?:https?:\/\/orcid\.org\/|orcid:)?(\d{4}-\d{4}-\d{4}-\d{3}[\dX])$/i;

/**
 * Extract a bare ORCID (for example '0009-0001-1234-5678') from a bare,
 * URL-prefixed, or 'orcid:'-prefixed value; null when the value is not an
 * ORCID.
 */
export function parseOrcid(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = ORCID_PATTERN.exec(value.trim());
  return match ? (match[1] ?? null) : null;
}

/**
 * Resolve OPENALEX_API_KEY from explicit arg, environment variable, or
 * (only when RESEARCHHQ_SECRET_PROVIDER is exactly 'bws') the local Bitwarden
 * Secrets Manager CLI. External users never get ~/.hermes read implicitly.
 * Never logs or exposes secret values in error messages.
 */
export function resolveOpenAlexApiKey(explicitKey?: string): string | undefined {
  const fromArg = explicitKey?.trim();
  if (fromArg && !fromArg.startsWith('${')) return fromArg;

  const fromEnv = process.env.OPENALEX_API_KEY?.trim();
  if (fromEnv && !fromEnv.startsWith('${')) return fromEnv;

  // Opt-in convenience fallback for workstations using Bitwarden Secrets
  // Manager (`~/.hermes/bin/bws`); gated so external users never have
  // ~/.hermes probed, and only BWS_ACCESS_TOKEN is ever copied into childEnv.
  if (process.env.RESEARCHHQ_SECRET_PROVIDER !== 'bws') return undefined;
  const bwsBin = join(homedir(), '.hermes', 'bin', 'bws');
  const hermesEnvPath = join(homedir(), '.hermes', '.env');
  if (!existsSync(bwsBin)) return undefined;

  let bwsToken = process.env.BWS_ACCESS_TOKEN?.trim() || '';
  if (!bwsToken && existsSync(hermesEnvPath)) {
    const lines = readFileSync(hermesEnvPath, 'utf8').split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
      const idx = trimmed.indexOf('=');
      const k = trimmed.slice(0, idx).trim();
      if (k !== 'BWS_ACCESS_TOKEN') continue;
      bwsToken = trimmed
        .slice(idx + 1)
        .trim()
        .replace(/^['"]|['"]$/g, '');
      break;
    }
  }
  if (!bwsToken) return undefined;

  const childEnv: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    BWS_ACCESS_TOKEN: bwsToken,
  };
  const explicitSecretId = process.env.OPENALEX_BWS_SECRET_ID?.trim();

  try {
    if (explicitSecretId) {
      const out = execFileSync(bwsBin, ['secret', 'get', explicitSecretId], {
        env: childEnv,
        encoding: 'utf8',
        timeout: 15_000,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      const parsed = JSON.parse(out) as { value?: string };
      return parsed.value?.trim() || undefined;
    }
    const out = execFileSync(bwsBin, ['secret', 'list'], {
      env: childEnv,
      encoding: 'utf8',
      timeout: 15_000,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const parsed = JSON.parse(out) as Array<{ key?: string; value?: string }>;
    const found = parsed.find((item) => item.key === 'OPENALEX_API_KEY');
    return found?.value?.trim() || undefined;
  } catch {
    return undefined;
  }
}

export function reconstructAbstract(invertedIndex?: Record<string, number[]> | null): string | null {
  if (!invertedIndex || typeof invertedIndex !== 'object') return null;
  let maxPos = -1;
  const byPos = new Map<number, string>();
  for (const [word, positions] of Object.entries(invertedIndex)) {
    if (!Array.isArray(positions)) continue;
    for (const pos of positions) {
      if (typeof pos === 'number' && pos >= 0) {
        byPos.set(pos, word);
        if (pos > maxPos) maxPos = pos;
      }
    }
  }
  if (maxPos < 0) return null;
  const words: string[] = [];
  for (let i = 0; i <= maxPos; i++) {
    const w = byPos.get(i);
    if (w) words.push(w);
  }
  const joined = words.join(' ').trim();
  return joined.length > 0 ? joined : null;
}

export function normalizeDoi(doi?: string | null): string | null {
  if (!doi) return null;
  let cleaned = doi.trim().toLowerCase();
  for (const prefix of ['https://doi.org/', 'http://doi.org/', 'http://dx.doi.org/', 'https://dx.doi.org/', 'doi:']) {
    if (cleaned.startsWith(prefix)) {
      cleaned = cleaned.slice(prefix.length);
    }
  }
  return cleaned || null;
}

/**
 * Unified with normalizeJournalId from @researchhq/schema (same
 * '&'/'and' handling, no length truncation) so venue slugs, journal ids, and
 * dashboard joins never drift apart.
 */
export function slugifyVenue(name: string): string {
  return normalizeJournalId(name);
}

/** Strip an optional leading 'the ' (slug form 'the-') from a normalized name. */
function stripLeadingThe(slug: string): string {
  return slug.startsWith('the-') && slug.length > 4 ? slug.slice(4) : slug;
}

/**
 * Whether an OpenAlex source record is a canonical match for the given journal
 * name or ISSN: normalized title (with optional leading 'the ' ignored) or
 * ISSN must match. No fuzzy fallbacks: an unrelated most-cited hit is never
 * accepted.
 */
export function matchesCanonicalJournal(
  name: string,
  issn: string | undefined,
  source: RawOpenAlexSource,
): boolean {
  const target = slugifyVenue(name);
  const targetBare = stripLeadingThe(target);
  if (target !== '') {
    const slug = slugifyVenue(source.display_name ?? '');
    if (slug === target || (targetBare !== '' && stripLeadingThe(slug) === targetBare)) {
      return true;
    }
  }
  if (issn) {
    const wanted = issn.trim().toLowerCase();
    for (const candidate of source.issn ?? []) {
      if (candidate.trim().toLowerCase() === wanted) return true;
    }
  }
  return false;
}

export class OpenAlexClient {
  private readonly apiKey?: string;
  private readonly mailto: string;
  private readonly baseUrl: string;

  constructor(options: OpenAlexClientOptions = {}) {
    this.apiKey = resolveOpenAlexApiKey(options.apiKey);
    this.mailto = options.mailto || 'researchhq@users.noreply.github.com';
    this.baseUrl = (options.baseUrl || 'https://api.openalex.org').replace(/\/+$/, '');
  }

  private async getJson<T>(pathAndQuery: string): Promise<T> {
    const url = new URL(`${this.baseUrl}${pathAndQuery}`);
    url.searchParams.set('mailto', this.mailto);
    if (this.apiKey) {
      url.searchParams.set('api_key', this.apiKey);
    }

    let lastStatus = 0;
    for (let attempt = 0; attempt < 3; attempt++) {
      const resp = await fetch(url, {
        headers: {
          Accept: 'application/json',
          'User-Agent': `ResearchHQ/0.1 (${this.mailto})`
        },
        signal: AbortSignal.timeout(30_000)
      });
      lastStatus = resp.status;
      if (resp.ok) {
        return (await resp.json()) as T;
      }
      if (resp.status === 401 || resp.status === 403) {
        throw new Error(
          `OpenAlex returned HTTP ${resp.status} for ${url.pathname}. Set OPENALEX_API_KEY (free key from https://openalex.org/settings/api).`
        );
      }
      if (attempt < 2 && (resp.status === 429 || resp.status >= 500)) {
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
        continue;
      }
      throw new Error(`OpenAlex request failed with HTTP ${resp.status} for ${url.pathname}`);
    }
    throw new Error(`OpenAlex request failed with HTTP ${lastStatus}`);
  }

  async fetchAuthor(authorIdOrOrcid: string): Promise<RawOpenAlexAuthor> {
    const orcid = parseOrcid(authorIdOrOrcid);
    const id = orcid ? `https://orcid.org/${orcid}` : authorIdOrOrcid;
    return this.getJson<RawOpenAlexAuthor>(`/authors/${encodeURIComponent(id)}`);
  }

  async fetchAuthorWorks(authorShortId: string): Promise<RawOpenAlexWork[]> {
    const shortId = authorShortId.split('/').pop() || authorShortId;
    const works: RawOpenAlexWork[] = [];
    let cursor: string | null = '*';
    while (cursor) {
      const page: { results?: RawOpenAlexWork[]; meta?: { next_cursor?: string | null } } =
        await this.getJson(
          `/works?filter=authorships.author.id:${encodeURIComponent(shortId)}&per-page=200&cursor=${encodeURIComponent(cursor)}`
        );
      const batch = page.results || [];
      works.push(...batch);
      cursor = batch.length > 0 ? (page.meta?.next_cursor ?? null) : null;
    }
    return works;
  }

  async fetchSourcesByIds(sourceShortIds: string[]): Promise<Map<string, RawOpenAlexSource>> {
    const out = new Map<string, RawOpenAlexSource>();
    const unique = Array.from(
      new Set(sourceShortIds.map((s) => s.split('/').pop() || s).filter(Boolean))
    );
    for (let i = 0; i < unique.length; i += 40) {
      const chunk = unique.slice(i, i + 40);
      const res = await this.getJson<{ results?: RawOpenAlexSource[] }>(
        `/sources?filter=openalex:${chunk.join('|')}&per-page=50`
      );
      for (const src of res.results || []) {
        const shortId = src.id.split('/').pop() || src.id;
        out.set(shortId, src);
      }
    }
    return out;
  }

  /**
   * Resolve a journal by title (or ISSN) against OpenAlex. A source counts
   * only when its normalized title (with optional leading 'the ' stripped)
   * or its ISSN matches; among the matches the record with the highest
   * works_count wins so legacy low-work ISSN stubs never shadow the canonical
   * journal. When nothing matches, null is returned: an unrelated most-cited
   * search hit is never used as a fallback.
   */
  async searchCanonicalJournal(name: string, issn?: string): Promise<RawOpenAlexSource | null> {
    const collected: RawOpenAlexSource[] = [];
    if (issn) {
      try {
        const byIssn = await this.getJson<{ results?: RawOpenAlexSource[] }>(
          `/sources?filter=issn:${encodeURIComponent(issn)}&per-page=5`
        );
        collected.push(...(byIssn.results ?? []));
      } catch {
        // Fall through to the title search; matching still applies.
      }
    }
    try {
      const res = await this.getJson<{ results?: RawOpenAlexSource[] }>(
        `/sources?search=${encodeURIComponent(name)}&per-page=10`
      );
      collected.push(...(res.results ?? []));
    } catch {
      // Return whatever matches from the records collected so far.
    }

    const seen = new Set<string>();
    const matches = collected.filter((source) => {
      const key = source.id ?? JSON.stringify(source).slice(0, 64);
      if (seen.has(key)) return false;
      seen.add(key);
      return matchesCanonicalJournal(name, issn, source);
    });
    matches.sort((a, b) => (b.works_count || 0) - (a.works_count || 0));
    return matches[0] ?? null;
  }

  /** Shared article filter for topical venue discovery (suggest-journals). */
  private static worksFilter(minYear: number): string {
    return `type:article,primary_location.source.type:journal,from_publication_date:${minYear}-01-01`;
  }

  /**
   * Group recent journal articles matching a BM25 query by their publishing
   * source. Returns the 50 largest groups (by article count) so mega-journal
   * volume can be size-dampened downstream rather than truncated here.
   */
  async groupWorksBySource(
    query: string,
    minYear: number,
  ): Promise<Array<{ sourceId: string; displayName: string; count: number }>> {
    const res = await this.getJson<{
      group_by?: Array<{ key?: string | null; key_display_name?: string | null; count?: number }>;
    }>(
      `/works?search=${encodeURIComponent(query)}&filter=${OpenAlexClient.worksFilter(minYear)}&group_by=primary_location.source.id`,
    );
    const out: Array<{ sourceId: string; displayName: string; count: number }> = [];
    for (const group of res.group_by ?? []) {
      const key = group.key ?? '';
      const shortId = key.split('/').pop() ?? '';
      if (shortId === '' || shortId === 'unknown' || shortId === 'deleted') continue;
      out.push({
        sourceId: shortId,
        displayName: group.key_display_name ?? '',
        count: group.count ?? 0,
      });
    }
    out.sort((a, b) => b.count - a.count);
    return out.slice(0, 50);
  }

  /**
   * Fetch the nearest (BM25-ranked) recent journal articles for a query. The
   * result order is the ranking signal: position-weighted topical scoring in
   * suggest-journals relies on index 0 being the closest match.
   */
  async searchNearestWorks(query: string, minYear: number, perPage = 50): Promise<RawOpenAlexWork[]> {
    const res = await this.getJson<{ results?: RawOpenAlexWork[] }>(
      `/works?search=${encodeURIComponent(query)}&filter=${OpenAlexClient.worksFilter(minYear)}&per-page=${perPage}`,
    );
    return res.results ?? [];
  }

  /**
   * Fetch works by DOI in chunks of 40 (OpenAlex filter length limit) so a
   * bibliography of cited papers can be resolved in a handful of requests.
   * DOIs are normalized and deduped before chunking.
   */
  async fetchWorksByDois(dois: string[]): Promise<RawOpenAlexWork[]> {
    const unique = Array.from(
      new Set(dois.map((d) => normalizeDoi(d)).filter((d): d is string => d !== null)),
    );
    const works: RawOpenAlexWork[] = [];
    for (let i = 0; i < unique.length; i += 40) {
      const chunk = unique.slice(i, i + 40).filter((d) => !/[|,]/.test(d));
      if (chunk.length === 0) continue;
      const filterExpr = `doi:${chunk.join('|')}`;
      const res = await this.getJson<{ results?: RawOpenAlexWork[] }>(
        `/works?filter=${encodeURIComponent(filterExpr)}&per-page=50`,
      );
      works.push(...(res.results ?? []));
    }
    return works;
  }
}
