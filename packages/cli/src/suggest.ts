/**
 * suggest-journals: publisher-neutral target journal recommendation.
 *
 * Combines four OpenAlex-backed signals (BM25 nearest works, grouped article
 * counts, a cited-DOI bibliography, and the author's own publication record)
 * with the local curated journal-metrics.yaml file into a 0..100 fit score,
 * then optionally writes the top candidates back into planned-papers.yaml as
 * validated TargetJournalCandidate entries.
 */
import { existsSync, readFileSync } from 'node:fs';
import {
  normalizeJournalId,
  type PlannedPaper,
  type ResearchHqConfig,
  type TargetJournalCandidate,
} from '@researchhq/schema';
import { ensureJournalMetricStubEntries, setPlannedPaperTargetJournals } from './ideas.js';
import {
  OpenAlexClient,
  normalizeDoi,
  type OpenAlexClientOptions,
  type RawOpenAlexSource,
  type RawOpenAlexWork,
} from './openalex.js';
import {
  loadConfig,
  loadCuratedJournals,
  loadPlannedPapers,
  resolveInstancePaths,
  validateInstance,
  type CuratedJournal,
} from './sync.js';

// ---------------------------------------------------------------------------
// Client port (OpenAlexClient or a mock in tests; zero live calls in tests)
// ---------------------------------------------------------------------------

/**
 * Client surface consumed by suggestJournals. OpenAlexClient satisfies it
 * structurally; fetchAuthor/fetchAuthorWorks are optional so tests can mock
 * only the three works/sourcing methods and skip the author publication bonus.
 */
export interface SuggestOpenAlexPort {
  groupWorksBySource(
    query: string,
    minYear: number,
  ): Promise<Array<{ sourceId: string; displayName: string; count: number }>>;
  searchNearestWorks(query: string, minYear: number, perPage?: number): Promise<RawOpenAlexWork[]>;
  fetchWorksByDois(dois: string[]): Promise<RawOpenAlexWork[]>;
  fetchSourcesByIds(sourceShortIds: string[]): Promise<Map<string, RawOpenAlexSource>>;
  fetchAuthor?(authorIdOrOrcid: string): Promise<{ id: string }>;
  fetchAuthorWorks?(authorShortId: string): Promise<RawOpenAlexWork[]>;
}

// ---------------------------------------------------------------------------
// Search term and cited-DOI extraction
// ---------------------------------------------------------------------------

/** Generic words that carry no venue signal for OpenAlex BM25 queries. */
const STOPWORDS: ReadonlySet<string> = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'of', 'in', 'on', 'to', 'for', 'with', 'from', 'by', 'at',
  'as', 'is', 'are', 'was', 'were', 'be', 'been', 'being', 'it', 'its', 'this', 'that', 'these',
  'those', 'their', 'there', 'here', 'we', 'our', 'us', 'you', 'your', 'they', 'them', 'he', 'she',
  'his', 'her', 'not', 'no', 'can', 'could', 'may', 'might', 'will', 'would', 'shall', 'should',
  'must', 'have', 'has', 'had', 'do', 'does', 'did', 'doing', 'using', 'use', 'used', 'via',
  'into', 'onto', 'over', 'under', 'between', 'among', 'across', 'within', 'without', 'through',
  'during', 'after', 'before', 'above', 'below', 'than', 'then', 'when', 'where', 'which', 'while',
  'who', 'whom', 'why', 'how', 'what', 'whether', 'also', 'such', 'more', 'most', 'much', 'many',
  'some', 'any', 'each', 'both', 'all', 'few', 'other', 'others', 'only', 'own', 'same', 'so',
  'too', 'very', 'just', 'about', 'against', 'because', 'how', 'towards', 'toward', 'upon',
  'paper', 'papers', 'study', 'studies', 'research', 'article', 'articles', 'new', 'novel',
  'approach', 'approaches', 'framework', 'based', 'analysis', 'results', 'methods', 'method',
  'data', 'models', 'model', 'first', 'second', 'third', 'however', 'therefore', 'thus', 'hence',
]);

/**
 * Extract up to maxTerms discriminative lowercase search terms: URLs and
 * punctuation are stripped, stopwords and pure numbers are dropped, and the
 * remaining tokens keep their order of appearance. The output is designed to
 * be space-joined into a clean OpenAlex BM25 query.
 */
export function extractSearchTerms(
  inputs: Array<string | null | undefined>,
  maxTerms = 20,
): string[] {
  const text = inputs.filter((s): s is string => typeof s === 'string' && s.trim() !== '').join(' ');
  const stripped = text
    .replace(/https?:\/\/\S+/gi, ' ')
    .replace(/\bdoi:?\s*10\.\d{4,9}\/\S+/gi, ' ')
    .replace(/[^A-Za-z0-9-]+/g, ' ');
  const terms: string[] = [];
  for (const raw of stripped.split(/\s+/)) {
    const term = raw.toLowerCase().replace(/^-+|-+$/g, '');
    if (term.length < 3 || term.length > 40) continue;
    if (/^\d+$/.test(term)) continue;
    if (STOPWORDS.has(term)) continue;
    if (!terms.includes(term)) terms.push(term);
    if (terms.length >= maxTerms) break;
  }
  return terms;
}

const DOI_PATTERN = /\b(10\.\d{4,9}\/[^\s,;"'`)\]}>]+)/gi;

/**
 * Extract cited DOIs from free text (keyCitations strings, abstracts, bib
 * bodies): any 10.xxxx/... token, normalized and deduplicated. Trailing
 * punctuation that often follows a DOI in prose is stripped.
 */
export function extractCitedDois(texts: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  for (const text of texts) {
    if (!text) continue;
    DOI_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = DOI_PATTERN.exec(text)) !== null) {
      const cleaned = match[1]?.replace(/[.,;]+$/, '') ?? '';
      const doi = normalizeDoi(cleaned);
      if (doi && !out.includes(doi)) out.push(doi);
    }
  }
  return out;
}

export interface BibEntry {
  key: string;
  doi: string | null;
}

/**
 * Parse BibTeX entries into (citation key, doi) pairs. The doi field may use
 * braces or quotes: 'doi = {10.x/y}' or doi = "10.x/y".
 */
export function parseBibEntries(bibText: string): BibEntry[] {
  const out: BibEntry[] = [];
  const entryPattern = /@(\w+)\s*\{\s*([^,\s{}]+)\s*,/g;
  const matches: Array<{ key: string; start: number; end: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = entryPattern.exec(bibText)) !== null) {
    matches.push({
      key: match[2] ?? '',
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  for (let i = 0; i < matches.length; i++) {
    const entry = matches[i];
    if (!entry) continue;
    const bodyEnd = i + 1 < matches.length ? (matches[i + 1]?.start ?? bibText.length) : bibText.length;
    const body = bibText.slice(entry.end, bodyEnd);
    const doiMatch = /doi\s*=\s*(?:\{([^}]*)\}|"([^"]*)"|'([^']*)')/i.exec(body);
    const doiRaw = doiMatch?.[1] ?? doiMatch?.[2] ?? doiMatch?.[3] ?? null;
    out.push({ key: entry.key, doi: doiRaw ? normalizeDoi(doiRaw) : null });
  }
  return out;
}

const CITEKEY_PATTERN = /@([A-Za-z][\w:.-]*)/g;

/**
 * Resolve the bibliography DOIs for suggest-journals: direct DOIs found in
 * the keyCitations strings plus, when a .bib file is provided, the DOIs of
 * the @citekey entries referenced there (or all bib entries when no cited key
 * matches the bib). Results are normalized and deduplicated.
 */
export function extractCitedDoisForSuggest(
  keyCitations: string[],
  bibText: string | null,
): string[] {
  const dois = extractCitedDois(keyCitations);
  if (!bibText) return dois;

  const entries = parseBibEntries(bibText);
  const referencedKeys = new Set<string>();
  for (const citation of keyCitations) {
    CITEKEY_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = CITEKEY_PATTERN.exec(citation)) !== null) {
      const key = match[1]?.toLowerCase();
      if (key) referencedKeys.add(key);
    }
  }
  const referenced = entries.filter(
    (e) => e.doi !== null && referencedKeys.has(e.key.toLowerCase()),
  );
  // If keyCitations explicitly referenced @citekeys, use ONLY those matched entries
  // (never silently dump an entire multi-thousand-entry Zotero library when 0 keys matched).
  // In --title mode (no @citekeys), accept focused manuscript .bib files (<= 60 entries).
  const candidateEntries =
    referencedKeys.size > 0 ? referenced : entries.length <= 60 ? entries : [];
  const bibDois = candidateEntries
    .map((e) => e.doi)
    .filter((d): d is string => d !== null);
  for (const doi of bibDois) {
    if (!dois.includes(doi)) dois.push(doi);
  }
  return dois;
}

// ---------------------------------------------------------------------------
// Options, result shapes, and scoring
// ---------------------------------------------------------------------------

export interface SuggestJournalsOptions {
  /** Instance directory (default '.'). */
  dir?: string;
  /** Planned paper slug: inputs are read from its title/summary/gap/methodology/citations. */
  slug?: string;
  /** Free title (used when no --slug is given). */
  title?: string;
  /** Free abstract or summary text. */
  abstract?: string;
  /** Optional BibTeX file whose cited DOIs seed the bibliography signal. */
  bibPath?: string;
  /** Keep only open access sources. */
  oaOnly?: boolean;
  /** Keep only diamond OA (no-APC) sources. */
  diamondOnly?: boolean;
  /** Keep only DOAJ-indexed sources. */
  doajOnly?: boolean;
  /** Keep only sources with a known APC of at most this many USD. */
  maxApcUsd?: number;
  /** Oldest publication year for the topical window (default: current year - 5). */
  minYear?: number;
  /** Maximum venues to report (default 8, clamped to 1..25). */
  limit?: number;
  /** Write the top candidates into planned-papers.yaml (requires --slug). */
  writeTargets?: boolean;
}

export interface SuggestJournalCandidate {
  journalId: string;
  journalName: string;
  openalexSourceId: string | null;
  fitScore: number;
  /** Topical component (0..45, or 0..75 when no bibliography resolved). */
  topicalScore: number;
  /** Bibliography component (0..30, 0 when no cited DOIs resolved). */
  bibliographyScore: number;
  /** Local scope-tag and prior-publication component (0..15). */
  localScore: number;
  /** Open science hygiene component (0..10). */
  hygieneScore: number;
  fitRationale: string;
  pros: string[];
  cons: string[];
  warnings: string[];
  oa: {
    isOa: boolean | null;
    isInDoaj: boolean | null;
    oaModel: CuratedJournal['oaModel'] | null;
    apcUsd: number | null;
    sjrQuartile: CuratedJournal['sjrQuartile'] | null;
  };
  authorPublishedCount: number;
  targetCandidate: TargetJournalCandidate | null;
}

export interface SuggestResult {
  query: string;
  minYear: number;
  citedDoiCount: number;
  resolvedDoiCount: number;
  candidates: SuggestJournalCandidate[];
  warnings: string[];
  wroteTargets: boolean;
  paperSlug: string | null;
}

const DOAJ_WARNING =
  'Not listed in DOAJ: verify with Think.Check.Submit before submitting';

function sourceShortId(id?: string | null): string {
  if (!id) return '';
  return id.split('/').pop() || '';
}

function stripLeadingThe(slug: string): string {
  return slug.startsWith('the-') && slug.length > 4 ? slug.slice(4) : slug;
}

/** Merge curated journals into lookup maps keyed by source id, ISSN, and slug. */
function buildCuratedLookup(curated: CuratedJournal[]): {
  bySourceId: Map<string, CuratedJournal>;
  byIssn: Map<string, CuratedJournal>;
  bySlug: Map<string, CuratedJournal>;
} {
  const bySourceId = new Map<string, CuratedJournal>();
  const byIssn = new Map<string, CuratedJournal>();
  const bySlug = new Map<string, CuratedJournal>();
  for (const entry of curated) {
    const sourceId = sourceShortId(entry.openalexSourceId ?? null);
    if (sourceId) bySourceId.set(sourceId, entry);
    for (const issn of entry.issn ?? []) {
      byIssn.set(issn.trim().toLowerCase(), entry);
    }
    const idSlug = normalizeJournalId(entry.id);
    const nameSlug = normalizeJournalId(entry.name);
    for (const slug of [idSlug, stripLeadingThe(idSlug), nameSlug, stripLeadingThe(nameSlug)]) {
      if (slug) bySlug.set(slug, entry);
    }
  }
  return { bySourceId, byIssn, bySlug };
}

/** Load the author's per-venue publication counts (best-effort; 0 on failure). */
async function loadAuthorPublishedCounts(
  client: SuggestOpenAlexPort,
  config: ResearchHqConfig,
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const identifier =
    config.sync?.openalexAuthorId ??
    config.author.openalexId ??
    config.sync?.orcid ??
    config.author.orcid;
  if (!identifier || typeof identifier !== 'string' || identifier.trim() === '') return counts;
  if (!client.fetchAuthorWorks) return counts;
  try {
    const short = sourceShortId(identifier.trim());
    let authorShortId: string;
    if (/^A\d+$/i.test(short)) {
      authorShortId = short;
    } else if (client.fetchAuthor) {
      const author = await client.fetchAuthor(identifier.trim());
      authorShortId = sourceShortId(author.id);
    } else {
      return counts;
    }
    const works = await client.fetchAuthorWorks(authorShortId);
    for (const work of works) {
      const sourceId = sourceShortId(work.primary_location?.source?.id);
      if (!sourceId) continue;
      counts.set(sourceId, (counts.get(sourceId) ?? 0) + 1);
    }
  } catch {
    // The prior-publication bonus is optional: never fail the suggestion run.
  }
  return counts;
}

/**
 * Run the publisher-neutral journal suggestion pipeline. All OpenAlex access
 * goes through the provided client (a real OpenAlexClient by default) so
 * retries, api_key handling, and error redaction apply automatically.
 */
export async function suggestJournals(
  options: SuggestJournalsOptions,
  clientOverride?: SuggestOpenAlexPort,
): Promise<SuggestResult> {
  if (!options.slug && !options.title) {
    throw new Error('suggest-journals requires --slug or --title (what should the journals fit?)');
  }
  if (options.writeTargets && !options.slug) {
    throw new Error('--write-targets requires --slug so the targets have somewhere to be written');
  }

  const dir = options.dir ?? '.';
  const config = loadConfig(dir);
  const paths = resolveInstancePaths(dir, config);
  const plannedPapers = loadPlannedPapers(paths.plannedPapers);
  const curated = loadCuratedJournals(paths.journalMetrics);

  let paper: PlannedPaper | null = null;
  if (options.slug) {
    paper = plannedPapers.find((p) => p.slug === options.slug) ?? null;
    if (!paper) {
      const known = plannedPapers.map((p) => p.slug).join(', ');
      throw new Error(
        `No planned paper with slug '${options.slug}' in ${paths.plannedPapers}` +
          (known ? ` (known slugs: ${known})` : ''),
      );
    }
  }

  const title = paper?.title ?? options.title ?? '';
  const summaryText = paper?.summary ?? '';
  const gapText = paper?.scientificGapFilled ?? '';
  const methodologyText = (paper?.methodologyHighlights ?? []).join(' ');
  const abstractText = options.abstract ?? '';
  const keyCitations = paper?.keyCitations ?? [];

  const titleTerms = extractSearchTerms([title], 6);
  const queryTerms = extractSearchTerms([
    title,
    summaryText,
    gapText,
    methodologyText,
    abstractText,
  ]);
  if (queryTerms.length === 0) {
    throw new Error(
      'Could not build a search query: provide a title or abstract with discriminative terms',
    );
  }
  // OpenAlex /works?search= applies implicit Boolean AND across space-separated
  // tokens; 4-5 core title tokens give high precision, with OR fallback if too narrow.
  const focusedQuery = (titleTerms.length >= 2 ? titleTerms.slice(0, 5) : queryTerms.slice(0, 5)).join(' ');
  const broadOrQuery = queryTerms.slice(0, 8).join(' OR ');
  let query = focusedQuery;

  let bibText: string | null = null;
  if (options.bibPath) {
    if (!existsSync(options.bibPath)) {
      throw new Error(`--bib file not found: ${options.bibPath}`);
    }
    bibText = readFileSync(options.bibPath, 'utf8');
  }
  const citedDois = extractCitedDoisForSuggest(keyCitations, bibText);

  const currentYear = new Date().getFullYear();
  const minYear = options.minYear ?? currentYear - 5;
  const limit = Math.min(25, Math.max(1, Math.round(options.limit ?? 8)));

  const client: SuggestOpenAlexPort = clientOverride ?? new OpenAlexClient();
  let [groups, nearestWorks, citedWorks, authorPublishedCounts] = await Promise.all([
    client.groupWorksBySource(query, minYear),
    client.searchNearestWorks(query, minYear, 50),
    citedDois.length > 0 ? client.fetchWorksByDois(citedDois) : Promise.resolve([]),
    loadAuthorPublishedCounts(client, config),
  ]);
  if (nearestWorks.length < 10 && broadOrQuery !== query) {
    query = broadOrQuery;
    [groups, nearestWorks] = await Promise.all([
      client.groupWorksBySource(query, minYear),
      client.searchNearestWorks(query, minYear, 50),
    ]);
  }

  // Position-weighted topical signal from the 50 nearest works.
  const nearestScoreBySource = new Map<string, number>();
  for (let i = 0; i < nearestWorks.length; i++) {
    const work = nearestWorks[i];
    if (!work) continue;
    const sourceId = sourceShortId(work.primary_location?.source?.id);
    if (!sourceId) continue;
    nearestScoreBySource.set(
      sourceId,
      (nearestScoreBySource.get(sourceId) ?? 0) + 1 / Math.log2(i + 2),
    );
  }

  // Recent-article volume per source from the group_by aggregation.
  const groupCountBySource = new Map<string, number>();
  for (const group of groups) {
    if (group.count > 0) groupCountBySource.set(group.sourceId, group.count);
  }

  // Bibliography signal: cited works landing in each candidate venue.
  const citedHitsBySource = new Map<string, number>();
  for (const work of citedWorks) {
    const sourceId = sourceShortId(work.primary_location?.source?.id);
    if (!sourceId) continue;
    citedHitsBySource.set(sourceId, (citedHitsBySource.get(sourceId) ?? 0) + 1);
  }

  // Candidate sources come from the topical evidence (nearest works and
  // group_by); curated-only venues with zero topical evidence are never
  // suggested just because they exist in journal-metrics.yaml.
  const candidateSourceIds = new Set<string>([
    ...nearestScoreBySource.keys(),
    ...groupCountBySource.keys(),
    ...citedHitsBySource.keys(),
  ]);
  const sourceRecords = await client.fetchSourcesByIds(Array.from(candidateSourceIds));

  const curatedLookup = buildCuratedLookup(curated);
  const bibliographyApplies = citedDois.length > 0 && citedWorks.length > 0;
  const topicalWeight = bibliographyApplies ? 45 : 75;
  const maxCitedHits = Math.max(0, ...citedHitsBySource.values());
  const maxNearest = Math.max(0, ...nearestScoreBySource.values());
  let maxGroupDampened = 0;

  interface WorkingCandidate {
    source: RawOpenAlexSource;
    curated: CuratedJournal | null;
    nearestScore: number;
    groupCount: number;
    groupDampened: number;
    citedHits: number;
    authorPublishedCount: number;
  }
  const working: WorkingCandidate[] = [];
  for (const source of sourceRecords.values()) {
    if (source.type !== 'journal') continue;
    const sourceId = sourceShortId(source.id);
    const worksCount = source.works_count ?? 0;
    const groupCount = groupCountBySource.get(sourceId) ?? 0;
    // Size-dampened volume so mega-journals never dominate by raw count.
    const groupDampened = groupCount / Math.pow(Math.max(worksCount, 500), 0.55);
    const issnMatch = (source.issn ?? [])
      .map((i) => i.trim().toLowerCase())
      .map((i) => curatedLookup.byIssn.get(i))
      .find(Boolean);
    const slug = normalizeJournalId(source.display_name ?? '');
    working.push({
      source,
      curated:
        curatedLookup.bySourceId.get(sourceId) ??
        issnMatch ??
        curatedLookup.bySlug.get(slug) ??
        curatedLookup.bySlug.get(stripLeadingThe(slug)) ??
        null,
      nearestScore: nearestScoreBySource.get(sourceId) ?? 0,
      groupCount,
      groupDampened,
      citedHits: citedHitsBySource.get(sourceId) ?? 0,
      authorPublishedCount: authorPublishedCounts.get(sourceId) ?? 0,
    });
    if (groupDampened > maxGroupDampened) {
      // Track the dampened maximum for normalization below.
      maxGroupDampened = groupDampened;
    }
  }

  const candidates: SuggestJournalCandidate[] = [];
  for (const item of working) {
    const source = item.source;
    const curatedEntry = item.curated;
    const sourceId = sourceShortId(source.id);
    const isOa = source.is_oa ?? null;
    const isInDoaj = source.is_in_doaj ?? null;
    const apcUsd = source.apc_usd ?? null;
    const oaModel = curatedEntry?.oaModel ?? null;
    const sjrQuartile = curatedEntry?.sjrQuartile ?? null;

    // Filters (applied before scoring so the reported set respects them).
    if (options.oaOnly && !(isOa === true || oaModel === 'diamond' || oaModel === 'gold')) {
      continue;
    }
    const isDiamond = oaModel === 'diamond' || (isOa === true && apcUsd === 0);
    if (options.diamondOnly && !isDiamond) continue;
    if (options.doajOnly && isInDoaj !== true) continue;
    const effectiveApc = isDiamond ? 0 : apcUsd;
    if (
      options.maxApcUsd !== undefined &&
      (effectiveApc === null || effectiveApc > options.maxApcUsd)
    ) {
      continue;
    }

    const warnings: string[] = [];
    if (isOa === true && isInDoaj !== true && oaModel !== 'diamond') {
      warnings.push(DOAJ_WARNING);
    }

    // Topical: normalized blend of position-weighted nearest-work hits and
    // size-dampened recent-article volume.
    const nearestNorm = maxNearest > 0 ? item.nearestScore / maxNearest : 0;
    const groupNorm = maxGroupDampened > 0 ? item.groupDampened / maxGroupDampened : 0;
    const topicalRaw = (nearestNorm + groupNorm) / 2;
    const topicalScore = Math.min(topicalWeight, Math.round(topicalWeight * topicalRaw));

    // Bibliography: log-scaled share of the best-matching venue.
    const bibliographyScore =
      bibliographyApplies && maxCitedHits > 0
        ? Math.min(30, Math.round(30 * (Math.log1p(item.citedHits) / Math.log1p(maxCitedHits))))
        : 0;

    // Local scope and familiarity.
    const queryTermSet = new Set(queryTerms);
    const matchedTags = (curatedEntry?.scopeTags ?? []).filter((tag) =>
      tag
        .toLowerCase()
        .split(/[-_\s]+/)
        .some((token) => token.length >= 3 && queryTermSet.has(token)),
    );
    const scopeScore = Math.min(10, matchedTags.length * 5);
    const familiarityBonus =
      item.authorPublishedCount >= 8 ? 5 : item.authorPublishedCount >= 3 ? 3 : item.authorPublishedCount >= 1 ? 1 : 0;
    const localScore = Math.min(15, scopeScore + familiarityBonus);

    // Open science hygiene.
    const doajOrQualityHybrid =
      isInDoaj === true || (oaModel === 'hybrid' && (sjrQuartile === 'Q1' || sjrQuartile === 'Q2'));
    const hygieneScore = Math.min(10, (isDiamond ? 5 : 0) + (doajOrQualityHybrid ? 3 : 0));

    const fitScore = Math.min(
      100,
      topicalScore + bibliographyScore + localScore + hygieneScore,
    );

    const pros: string[] = [];
    const cons: string[] = [];
    if (isDiamond) pros.push('Diamond OA (no article processing charge)');
    else if (isOa === true) pros.push('Open access');
    if (isInDoaj === true) pros.push('DOAJ indexed');
    if (matchedTags.length > 0) pros.push(`Curated scope match: ${matchedTags.join(', ')}`);
    if (item.authorPublishedCount > 0) {
      pros.push(`You have published ${item.authorPublishedCount} work(s) here`);
    }
    if (item.citedHits > 0) pros.push(`Your bibliography cites ${item.citedHits} paper(s) here`);
    if (!isDiamond && apcUsd !== null && apcUsd > 0) cons.push(`APC ${apcUsd} USD`);
    if (isOa !== true) cons.push('Not open access');
    if (isInDoaj !== true && oaModel !== 'diamond') cons.push('Not listed in DOAJ');
    if (item.authorPublishedCount === 0) cons.push('No prior publications in this venue');
    if (curatedEntry === null) cons.push('No curated scope data in journal-metrics.yaml');

    const rationaleParts: string[] = [];
    if (item.nearestScore > 0) {
      rationaleParts.push(
        `${Math.min(nearestWorks.length, 50)}-work nearest search scores it ${item.nearestScore.toFixed(2)} (position-weighted)`,
      );
    }
    if (item.groupCount > 0) {
      rationaleParts.push(
        `${item.groupCount} recent matching article(s) size-dampened by ${Math.max(source.works_count ?? 0, 500)} total works`,
      );
    }
    if (bibliographyApplies) {
      rationaleParts.push(`${item.citedHits} of your cited DOIs resolve here`);
    }
    if (matchedTags.length > 0) rationaleParts.push(`scope tags match: ${matchedTags.join(', ')}`);
    if (isDiamond) rationaleParts.push('diamond OA');
    else if (doajOrQualityHybrid) rationaleParts.push('DOAJ/quality hybrid signal');

    const journalName = source.display_name ?? curatedEntry?.name ?? sourceId;
    const journalId = curatedEntry?.id ?? (normalizeJournalId(journalName) || sourceId);
    const fitRationale =
      rationaleParts.length > 0
        ? rationaleParts.join('; ')
        : 'Weak topical and open science signals; kept only as a long-shot candidate';

    candidates.push({
      journalId,
      journalName,
      openalexSourceId: sourceId,
      fitScore,
      topicalScore,
      bibliographyScore,
      localScore,
      hygieneScore,
      fitRationale,
      pros,
      cons,
      warnings,
      oa: { isOa, isInDoaj, oaModel, apcUsd, sjrQuartile },
      authorPublishedCount: item.authorPublishedCount,
      targetCandidate: null,
    });
  }

  candidates.sort((a, b) => b.fitScore - a.fitScore || a.journalName.localeCompare(b.journalName));
  const limited = candidates.slice(0, limit);
  for (let i = 0; i < Math.min(5, limited.length); i++) {
    const candidate = limited[i];
    if (!candidate) break;
    candidate.targetCandidate = {
      journalId: candidate.journalId,
      journalName: candidate.journalName,
      rank: i + 1,
      fitScore: candidate.fitScore,
      fitRationale: candidate.fitRationale,
      pros: candidate.pros,
      cons: candidate.cons,
    };
  }

  const warnings: string[] = [];
  let wroteTargets = false;
  if (options.writeTargets && options.slug && paper) {
    const toWrite = limited
      .filter((c) => c.targetCandidate !== null)
      .slice(0, Math.min(4, limited.length))
      .map((c) => c.targetCandidate as TargetJournalCandidate);
    if (toWrite.length > 0) {
      setPlannedPaperTargetJournals(dir, options.slug, toWrite);
      ensureJournalMetricStubEntries(
        dir,
        toWrite.map((c) => ({
          id: c.journalId,
          name: c.journalName,
          openalexSourceId:
            limited.find((l) => l.journalId === c.journalId)?.openalexSourceId ?? null,
        })),
      );
      wroteTargets = true;
      const validation = validateInstance(dir);
      for (const error of validation.errors) {
        warnings.push(`Post-write validation: ${error}`);
      }
    } else {
      warnings.push('--write-targets had nothing to write: no candidates passed the filters');
    }
  }

  return {
    query,
    minYear,
    citedDoiCount: citedDois.length,
    resolvedDoiCount: citedWorks.length,
    candidates: limited,
    warnings,
    wroteTargets,
    paperSlug: options.slug ?? null,
  };
}

// ---------------------------------------------------------------------------
// Text report
// ---------------------------------------------------------------------------

/**
 * Render a concise aligned suggestion table plus a per-venue 'Why:' line and a
 * DORA reminder that automated scores never replace human editorial judgement.
 */
export function formatSuggestJournalsReport(result: SuggestResult): string {
  const lines: string[] = [];
  lines.push(
    `Target journal suggestions (min publication year ${result.minYear}, ` +
      `${result.citedDoiCount} cited DOI(s), ${result.resolvedDoiCount} resolved)`,
  );
  if (result.wroteTargets) {
    lines.push(
      `Wrote top candidates to planned-papers.yaml${result.paperSlug ? ` for '${result.paperSlug}'` : ''}`,
    );
  }
  lines.push('');
  if (result.candidates.length === 0) {
    lines.push('No journals passed the filters. Relax --oa-only/--diamond-only/--doaj-only or widen --min-year.');
  } else {
    const rankWidth = 6;
    const fitWidth = 5;
    const nameWidth =
      Math.max(...result.candidates.map((c) => c.journalName.length), 'Journal'.length) + 2;
    lines.push(
      'Rank'.padEnd(rankWidth) +
        'Fit'.padEnd(fitWidth) +
        'Journal'.padEnd(nameWidth) +
        'OA'.padEnd(9) +
        'APC(USD)'.padEnd(10) +
        'DOAJ',
    );
    for (const candidate of result.candidates) {
      const rank = candidate.targetCandidate ? String(candidate.targetCandidate.rank) : '-';
      const oaLabel =
        candidate.oa.oaModel === 'diamond' ||
        (candidate.oa.isOa === true && candidate.oa.apcUsd === 0)
          ? 'diamond'
          : candidate.oa.isOa === true
            ? 'yes'
            : candidate.oa.oaModel === 'hybrid'
              ? 'hybrid'
              : 'no';
      const apc = candidate.oa.apcUsd === null ? 'unknown' : String(candidate.oa.apcUsd);
      const doaj = candidate.oa.isInDoaj === true ? 'yes' : 'no';
      lines.push(
        rank.padEnd(rankWidth) +
          String(candidate.fitScore).padEnd(fitWidth) +
          candidate.journalName.padEnd(nameWidth) +
          oaLabel.padEnd(9) +
          apc.padEnd(10) +
          doaj,
      );
    }
    lines.push('');
    for (const candidate of result.candidates) {
      lines.push(`Why ${candidate.journalName}: ${candidate.fitRationale}`);
      if (candidate.pros.length > 0) lines.push(`  Pros: ${candidate.pros.join('; ')}`);
      if (candidate.cons.length > 0) lines.push(`  Cons: ${candidate.cons.join('; ')}`);
      for (const warning of candidate.warnings) {
        lines.push(`  Warning: ${warning}`);
      }
    }
  }
  for (const warning of result.warnings) {
    lines.push(`Warning: ${warning}`);
  }
  lines.push('');
  lines.push(
    'DORA reminder: automated fit scores are a starting point only. Inspect recent issues, ' +
      'editorial board fit, and Read-and-Publish coverage before submitting ' +
      '(https://openpolicyfinder.jisc.ac.uk).',
  );
  return lines.join('\n');
}
