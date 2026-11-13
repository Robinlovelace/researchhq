/**
 * ResearchHQ sync: harvest OpenAlex works and source metrics, merge local
 * curated YAML (planned papers, journal metrics, overrides), infer open
 * science stages, and write the private plus sanitized public snapshots.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { z } from 'zod';
import {
  PortfolioSnapshotSchema,
  ResearchHqConfigSchema,
  aggregateJournalMetrics,
  buildTimeSeries,
  computeHIndex,
  computeI10Index,
  computeStageCounts,
  normalizeJournalId,
  OpenScienceEvidenceSchema,
  PlannedPaperSchema,
  sanitizePortfolioForPublic,
  type JournalMetric,
  type OpenScienceEvidence,
  type PlannedPaper,
  type PortfolioSnapshot,
  type Publication,
  type ResearchHqConfig,
} from '@researchhq/schema';
import {
  OpenAlexClient,
  normalizeDoi,
  reconstructAbstract,
  slugifyVenue,
  type RawOpenAlexAuthor,
  type RawOpenAlexSource,
  type RawOpenAlexWork,
} from './openalex.js';

// ---------------------------------------------------------------------------
// Small fs and yaml helpers
// ---------------------------------------------------------------------------

/** Write a file, creating parent directories as needed. */
export function writeFileEnsuringDir(filePath: string, content: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, 'utf8');
}

function readTextIfExists(path: string): string | null {
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

function readYamlIfExists(path: string): unknown {
  const text = readTextIfExists(path);
  return text === null ? undefined : parseYaml(text);
}

function readJsonIfExists(path: string): unknown {
  const text = readTextIfExists(path);
  return text === null ? undefined : (JSON.parse(text) as unknown);
}

// ---------------------------------------------------------------------------
// Local YAML input schemas (curated, human-edited files)
// ---------------------------------------------------------------------------

export const CuratedJournalSchema = z.object({
  id: z.string(),
  name: z.string(),
  shortName: z.string().nullish(),
  issn: z.array(z.string()).nullish(),
  publisher: z.string().nullish(),
  jif: z.number().nullish(),
  jifYear: z.number().nullish(),
  citescore: z.number().nullish(),
  sjrScore: z.number().nullish(),
  sjrQuartile: z.enum(['Q1', 'Q2', 'Q3', 'Q4']).nullish(),
  oaModel: z
    .enum(['diamond', 'gold', 'hybrid', 'subscription', 'preprint', 'book', 'unknown'])
    .nullish(),
  apcUsd: z.number().nullish(),
  reviewSpeedWeeks: z.number().nullish(),
  scopeTags: z.array(z.string()).nullish(),
  homepageUrl: z.string().nullish(),
  /** OpenAlex source short id (for example 'S137773608') when curated. */
  openalexSourceId: z.string().nullish(),
});

export type CuratedJournal = z.infer<typeof CuratedJournalSchema>;

export const OverrideEntrySchema = z.object({
  doi: z.string().nullish(),
  /** Optional list of edition/version DOIs belonging to the same work. */
  dois: z.array(z.string()).nullish(),
  titleMatch: z.string().nullish(),
  featured: z.boolean().nullish(),
  openScienceStage: z.number().int().min(0).max(5).nullish(),
  openScience: OpenScienceEvidenceSchema.partial().nullish(),
  citationsScholar: z.number().nullish(),
  /** Optional curated evidence URLs; checked by `researchhq validate --check-links`. */
  codeUrl: z.string().nullish(),
  dataUrl: z.string().nullish(),
  reproducibleRepoUrl: z.string().nullish(),
  interactiveToolUrl: z.string().nullish(),
});

export type OverrideEntry = z.infer<typeof OverrideEntrySchema>;

export const LocalPublicationEntrySchema = z.object({
  title: z.string(),
  abstract: z.string().nullish(),
  doi: z.string().nullish(),
  url: z.string().nullish(),
  url_source: z.string().nullish(),
});

export type LocalPublicationEntry = z.infer<typeof LocalPublicationEntrySchema>;

/** Minimal RFC 4180 style CSV parser (quoted fields, doubled quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch !== '\r') {
      field += ch;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 1 || (r[0] ?? '').trim() !== '');
}

/** Parse citation cell values such as '204 citations' or '1,204' into numbers. */
export function parseCitationCell(value: string): number | null {
  const digits = value.replace(/[^\d]/g, '');
  if (digits === '') return null;
  const n = Number.parseInt(digits, 10);
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Instance data loading
// ---------------------------------------------------------------------------

export interface InstancePaths {
  config: string;
  plannedPapers: string;
  journalMetrics: string;
  overrides: string;
  publicExport: string;
  /** Resolved from config.paths.scholarCsv, or null when not configured. */
  scholarCsv: string | null;
  /** Resolved from config.paths.publicationsYml, or null when not configured. */
  publicationsYml: string | null;
}

export function resolveInstancePaths(instanceDir: string, config?: ResearchHqConfig): InstancePaths {
  const paths = config?.paths ?? {};
  return {
    config: join(instanceDir, 'researchhq.config.yaml'),
    plannedPapers: resolve(instanceDir, paths.plannedPapers ?? 'data/planned-papers.yaml'),
    journalMetrics: resolve(instanceDir, paths.journalMetrics ?? 'data/journal-metrics.yaml'),
    overrides: resolve(instanceDir, paths.overrides ?? 'data/overrides.yaml'),
    publicExport: resolve(instanceDir, paths.publicExport ?? 'public-data/portfolio.public.json'),
    scholarCsv: paths.scholarCsv ? resolve(instanceDir, paths.scholarCsv) : null,
    publicationsYml: paths.publicationsYml ? resolve(instanceDir, paths.publicationsYml) : null,
  };
}

export function loadConfig(instanceDir: string): ResearchHqConfig {
  const raw = readYamlIfExists(join(instanceDir, 'researchhq.config.yaml'));
  if (raw === undefined) {
    throw new Error(`No researchhq.config.yaml found in ${instanceDir}. Run 'researchhq init' first.`);
  }
  return ResearchHqConfigSchema.parse(raw);
}

export function loadPlannedPapers(path: string): PlannedPaper[] {
  const raw = readYamlIfExists(path);
  if (raw === undefined) return [];
  const list = (raw as { plannedPapers?: unknown }).plannedPapers;
  if (!Array.isArray(list)) {
    throw new Error(`${path}: expected a top-level 'plannedPapers' array`);
  }
  return list.map((item, index) => {
    const result = PlannedPaperSchema.safeParse(item);
    if (!result.success) {
      throw new Error(`${path}: planned paper at index ${index} is invalid: ${result.error.message}`);
    }
    return result.data;
  });
}

export function loadCuratedJournals(path: string): CuratedJournal[] {
  const raw = readYamlIfExists(path);
  if (raw === undefined) return [];
  const list = (raw as { journals?: unknown }).journals;
  if (!Array.isArray(list)) {
    throw new Error(`${path}: expected a top-level 'journals' array`);
  }
  return list.map((item, index) => {
    const result = CuratedJournalSchema.safeParse(item);
    if (!result.success) {
      throw new Error(`${path}: journal at index ${index} is invalid: ${result.error.message}`);
    }
    return result.data;
  });
}

export function loadOverrides(path: string): Record<string, OverrideEntry> {
  const raw = readYamlIfExists(path);
  if (raw === undefined) return {};
  const record = (raw as { overrides?: unknown }).overrides;
  if (record === undefined || record === null) return {};
  if (typeof record !== 'object' || Array.isArray(record)) {
    throw new Error(`${path}: expected a top-level 'overrides' mapping`);
  }
  // Null prototype so hostile YAML keys such as __proto__ are inert.
  const out = Object.create(null) as Record<string, OverrideEntry>;
  for (const [key, value] of Object.entries(record as Record<string, unknown>)) {
    const result = OverrideEntrySchema.safeParse(value);
    if (!result.success) {
      throw new Error(`${path}: override '${key}' is invalid: ${result.error.message}`);
    }
    out[key] = result.data;
  }
  return out;
}

/**
 * Sanitize common BibTeX/Quarto YAML quirks (LaTeX backslash escapes such as
 * \&, \%, \_ inside double-quoted strings and unindented multiline scalars)
 * so real-world Quarto publications.yml files parse cleanly under YAML 1.2.
 */
function parseQuartoPublicationsYaml(text: string): unknown[] {
  const sanitized = text.replace(/\\([&%_#${}])/g, '$1');
  try {
    const parsed = parseYaml(sanitized);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // Fall back to per-entry block parsing so one malformed multiline abstract
    // does not discard the rest of a Quarto publications.yml file.
  }

  const blocks = sanitized.split(/\n(?=- )/);
  const items: unknown[] = [];
  for (const rawBlock of blocks) {
    const trimmed = rawBlock.trim();
    if (!trimmed.startsWith('-')) continue;
    // Indent bare continuation lines inside multiline scalars by 4 spaces.
    const fixedBlock = trimmed
      .split('\n')
      .map((line, idx) => {
        if (idx === 0 || line.startsWith('  ') || line.trim() === '') return line;
        return `    ${line}`;
      })
      .join('\n');
    try {
      const parsedBlock = parseYaml(fixedBlock);
      if (Array.isArray(parsedBlock)) {
        items.push(...parsedBlock);
      }
    } catch {
      // Skip unrecoverable single item while preserving remaining entries.
    }
  }
  return items;
}

export function loadLocalPublications(path: string): LocalPublicationEntry[] {
  const text = readTextIfExists(path);
  if (text === null) return [];
  const raw = parseQuartoPublicationsYaml(text);
  const out: LocalPublicationEntry[] = [];
  for (const item of raw) {
    const result = LocalPublicationEntrySchema.safeParse(item);
    if (result.success) {
      out.push(result.data);
    }
  }
  return out;
}

export interface ScholarCitations {
  byTitleKey: Map<string, number>;
  total: number;
}

/** Load a Google Scholar style CSV export (title plus citations_numeric or cites). */
export function loadScholarCsv(path: string): ScholarCitations {
  const rows = parseCsv(readFileSync(path, 'utf8'));
  if (rows.length === 0) return { byTitleKey: new Map(), total: 0 };
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const titleIdx = header.indexOf('title');
  const numericIdx = header.indexOf('citations_numeric');
  const citesIdx = header.indexOf('cites');
  if (titleIdx < 0 || (numericIdx < 0 && citesIdx < 0)) {
    throw new Error(`${path}: expected CSV columns 'title' and 'citations_numeric' (or 'cites')`);
  }
  const byTitleKey = new Map<string, number>();
  for (const row of rows.slice(1)) {
    const title = row[titleIdx]?.trim() ?? '';
    const rawCell = numericIdx >= 0 ? row[numericIdx] : row[citesIdx];
    const citations = parseCitationCell(rawCell ?? '');
    if (title === '' || citations === null) continue;
    const key = normalizeTitleKey(title);
    const prev = byTitleKey.get(key);
    byTitleKey.set(key, prev === undefined ? citations : Math.max(prev, citations));
  }
  let total = 0;
  for (const count of byTitleKey.values()) {
    total += count;
  }
  return { byTitleKey, total };
}

// ---------------------------------------------------------------------------
// OpenAlex port (real client or offline bundle/mock for tests)
// ---------------------------------------------------------------------------

/** Minimal client surface used by syncPortfolio, implemented by OpenAlexClient and offline mocks. */
export interface OpenAlexPort {
  fetchAuthor(authorIdOrOrcid: string): Promise<RawOpenAlexAuthor>;
  fetchAuthorWorks(authorShortId: string): Promise<RawOpenAlexWork[]>;
  fetchSourcesByIds(sourceShortIds: string[]): Promise<Map<string, RawOpenAlexSource>>;
  searchCanonicalJournal(name: string, issn?: string): Promise<RawOpenAlexSource | null>;
}

export interface OfflineBundle {
  author: RawOpenAlexAuthor;
  works: RawOpenAlexWork[];
  /** RawOpenAlexSource records keyed by OpenAlex short id (for example 'S137773608'). */
  sources?: Record<string, RawOpenAlexSource>;
  /** Canonical journal records for searchCanonicalJournal, keyed by slugified journal name. */
  journals?: Record<string, RawOpenAlexSource>;
}

/** In-memory client over a pre-fetched bundle: offline sync without any network calls. */
export class OfflineOpenAlexClient implements OpenAlexPort {
  private readonly bundle: OfflineBundle;
  /** Null-prototype copies so hostile bundle keys such as __proto__ are inert. */
  private readonly sources: Record<string, RawOpenAlexSource>;
  private readonly journals: Record<string, RawOpenAlexSource>;

  constructor(bundle: OfflineBundle) {
    this.bundle = bundle;
    this.sources = Object.assign(Object.create(null), bundle.sources ?? {});
    this.journals = Object.assign(Object.create(null), bundle.journals ?? {});
  }

  async fetchAuthor(): Promise<RawOpenAlexAuthor> {
    return this.bundle.author;
  }

  async fetchAuthorWorks(): Promise<RawOpenAlexWork[]> {
    return this.bundle.works;
  }

  async fetchSourcesByIds(sourceShortIds: string[]): Promise<Map<string, RawOpenAlexSource>> {
    const out = new Map<string, RawOpenAlexSource>();
    for (const shortId of sourceShortIds) {
      const key = shortId.split('/').pop() || shortId;
      const source = this.sources[key];
      if (source) out.set(key, source);
    }
    return out;
  }

  async searchCanonicalJournal(name: string): Promise<RawOpenAlexSource | null> {
    return this.journals[slugifyVenue(name)] ?? null;
  }
}

// ---------------------------------------------------------------------------
// Work cleaning, classification, and venue resolution
// ---------------------------------------------------------------------------

const DEFAULT_EXCLUDE_TYPES: readonly string[] = ['paratext', 'erratum'];

/** Titles like 'pct [R package pct version 0.9.3]' identify CRAN releases. */
const R_PACKAGE_TITLE_PATTERN = /\[R package .+ version .+\]/i;
/** CRAN/MRAN/rdrr landing pages also identify R package records. */
const R_PACKAGE_URL_PATTERN = /\/web\/packages\/|cran\.r-project\.org|mran\.microsoft\.com|rdrr\.io\/cran/i;
/** Version suffixes are stripped before computing dedupe title keys. */
const R_PACKAGE_SUFFIX_PATTERN = /\s*\[R package [^\]]+\]/gi;

/**
 * Keep only the first whitespace-separated token that is a valid http(s) URL,
 * so multi-URL OpenAlex fields (for example 'https://a.org https://b.org')
 * never leak whitespace into exported JSON. The first URL-matching token wins
 * even when prose precedes it ('Page https://a.org'), matching the tightened
 * /^https?:\\/\\S+$/ URL regex in @researchhq/schema.
 */
export function cleanUrlToken(value: string | null | undefined): string | null {
  if (!value) return null;
  for (const token of value.trim().split(/\s+/)) {
    if (/^https?:\/\/\S+$/i.test(token)) return token;
  }
  return null;
}

/** True when the work is an R package release (CRAN landing page or title tag). */
function isRPackageWork(title: string, urls: string[]): boolean {
  return (
    R_PACKAGE_TITLE_PATTERN.test(title) ||
    urls.some((u) => R_PACKAGE_URL_PATTERN.test(u))
  );
}

const TYPE_MAP: Record<string, Publication['type']> = {
  article: 'article',
  book: 'book',
  'book-chapter': 'book-chapter',
  preprint: 'preprint',
  report: 'report',
  software: 'software',
  'software-paper': 'article',
  dataset: 'other',
  'book-review': 'other',
  dissertation: 'report',
};

function mapWorkType(rawType: string | null | undefined): Publication['type'] {
  if (!rawType) return 'other';
  return TYPE_MAP[rawType] ?? 'other';
}

function mapVenueType(sourceType: string | null | undefined): JournalMetric['venueType'] {
  switch (sourceType) {
    case 'journal':
      return 'journal';
    case 'book-series':
    case 'book series':
    case 'ebook platform':
      return 'book-series';
    case 'repository':
      return 'repository';
    case 'conference':
      return 'conference';
    default:
      return 'other';
  }
}

export function normalizeTitleKey(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Open-data repository URL patterns: an actual repository link is required for Stage 2. */
const STAGE2_URL_PATTERNS: readonly string[] = [
  'zenodo.org',
  '10.5281/zenodo',
  'figshare.com',
  '10.6084/m9.figshare',
  'osf.io',
  'dataverse',
  'datadryad.org',
  'ukdataservice.ac.uk',
];
/** Exact normalized venue slugs signalling open-source publication (Stage 3). */
const STAGE3_VENUE_SLUGS: readonly string[] = ['the-r-journal', 'journal-of-open-source-software'];
const STAGE3_URL_PATTERNS: readonly string[] = ['github.com', 'cran.r-project.org', 'pypi.org'];

function stripLeadingThe(slug: string): string {
  return slug.startsWith('the-') && slug.length > 4 ? slug.slice(4) : slug;
}

function sourceShortId(id?: string | null): string | null {
  if (!id) return null;
  return id.split('/').pop() || null;
}

interface ResolvedVenue {
  venue: string | null;
  venueType: JournalMetric['venueType'];
  sourceId: string | null;
}

/**
 * Resolve the publication venue. When the primary location is a repository
 * (White Rose, OSF, arXiv, Zenodo), a published journal location elsewhere in
 * work.locations takes precedence, so preprints hosted on institutional
 * repositories still credit the actual journal.
 */
function resolveVenue(work: RawOpenAlexWork): ResolvedVenue {
  const primarySource = work.primary_location?.source ?? null;
  const primaryType = primarySource?.type ?? null;

  if (primaryType === 'repository') {
    const journalLocation = (work.locations ?? []).find(
      (loc) => loc.source && loc.source.type === 'journal' && loc.source.display_name,
    );
    const chosen = journalLocation?.source ?? null;
    if (chosen) {
      return {
        venue: chosen.display_name ?? null,
        venueType: mapVenueType(chosen.type),
        sourceId: sourceShortId(chosen.id),
      };
    }
  }

  if (primarySource?.display_name) {
    return {
      venue: primarySource.display_name,
      venueType: mapVenueType(primaryType),
      sourceId: sourceShortId(primarySource.id),
    };
  }
  return { venue: null, venueType: 'other', sourceId: null };
}

interface WorkContext {
  year: number;
  excludedTypes: ReadonlySet<string>;
  authorShortId: string;
  localByTitleKey: Map<string, LocalPublicationEntry>;
  localByDoi: Map<string, LocalPublicationEntry>;
  scholarByTitleKey: Map<string, number>;
  /** Slugified venue name to resolved venue type, populated while processing works. */
  venueTypesBySlug: Map<string, JournalMetric['venueType']>;
}

function buildOpenScienceEvidence(work: RawOpenAlexWork): OpenScienceEvidence {
  const evidence: OpenScienceEvidence = {};
  const oaStatus = work.open_access?.oa_status;
  if (
    oaStatus === 'gold' ||
    oaStatus === 'diamond' ||
    oaStatus === 'green' ||
    oaStatus === 'hybrid' ||
    oaStatus === 'bronze' ||
    oaStatus === 'closed' ||
    oaStatus === 'unknown'
  ) {
    evidence.oaStatus = oaStatus;
  }
  const oaUrl = cleanUrlToken(work.open_access?.oa_url);
  if (oaUrl) {
    evidence.oaUrl = oaUrl;
  }
  return evidence;
}

function inferBaselineStage(
  work: RawOpenAlexWork,
  venue: string | null,
  mappedType: Publication['type'],
  urls: string[],
): number {
  const isOpen =
    (work.open_access?.is_oa === true) ||
    (work.open_access?.oa_status !== undefined &&
      work.open_access?.oa_status !== null &&
      work.open_access.oa_status !== 'closed' &&
      work.open_access.oa_status !== 'unknown');
  let stage = isOpen ? 1 : 0;

  // Stage 2 requires an actual open-data repository URL (abstract prose is
  // not enough: 'open data' appears in countless paywalled paper abstracts).
  const doiStr = (work.doi ?? '').toLowerCase();
  const hasStage2Signal =
    work.type === 'dataset' ||
    STAGE2_URL_PATTERNS.some(
      (p) => doiStr.includes(p) || urls.some((u) => u.toLowerCase().includes(p)),
    );
  if (hasStage2Signal) {
    stage = Math.max(stage, 2);
  }

  // Stage 3 venue signal matches exact normalized venue slugs only, so
  // venues merely containing 'r journal' as a substring are not promoted.
  const venueSlug = normalizeJournalId(venue ?? '');
  const venueMatches =
    venueSlug !== '' &&
    (STAGE3_VENUE_SLUGS.includes(venueSlug) || STAGE3_VENUE_SLUGS.includes(stripLeadingThe(venueSlug)));
  const typeMatches = mappedType === 'software';
  const urlMatches = urls.some((url) =>
    STAGE3_URL_PATTERNS.some((pattern) => url.toLowerCase().includes(pattern)),
  );
  if (venueMatches || typeMatches || urlMatches) {
    stage = Math.max(stage, 3);
  }
  return stage;
}

function pickDefinedEvidence(override: Partial<OpenScienceEvidence>): Partial<OpenScienceEvidence> {
  const out: Partial<OpenScienceEvidence> = {};
  for (const [key, value] of Object.entries(override)) {
    if (value !== undefined && value !== null) {
      (out as Record<string, unknown>)[key] = value;
    }
  }
  return out;
}

function processWork(
  work: RawOpenAlexWork,
  context: WorkContext,
): Publication | null {
  const year = work.publication_year;
  if (!year || year < 1) return null;
  if (context.year > 0 && year < context.year) return null;

  const rawType = work.type ?? 'other';
  if (context.excludedTypes.has(rawType)) return null;

  const title = (work.display_name ?? work.title ?? 'Untitled').trim();
  const venueInfo = resolveVenue(work);
  if (venueInfo.venue) {
    context.venueTypesBySlug.set(slugifyVenue(venueInfo.venue), venueInfo.venueType);
  }

  const ownAuthorships = (work.authorships ?? []).filter(
    (a) => sourceShortId(a.author?.id) === context.authorShortId,
  );
  // [MEDIUM-6] 'solo' for single-author works; null when the configured author
  // is not matched in authorships (never borrow another author's position).
  let authorPosition: Publication['authorPosition'] = null;
  if ((work.authorships ?? []).length === 1) {
    authorPosition = 'solo';
  } else {
    const pos = ownAuthorships[0]?.author_position;
    if (pos === 'first' || pos === 'last' || pos === 'middle' || pos === 'solo') {
      authorPosition = pos;
    }
  }

  const landing = cleanUrlToken(work.primary_location?.landing_page_url);
  const pdfUrl = cleanUrlToken(work.primary_location?.pdf_url);
  const oaUrl = cleanUrlToken(work.open_access?.oa_url);
  const urls = [landing, pdfUrl, oaUrl].filter((u): u is string => typeof u === 'string');

  const doi = normalizeDoi(work.doi);

  let abstract = reconstructAbstract(work.abstract_inverted_index);
  let url: string | null = oaUrl ?? landing ?? pdfUrl;
  if (doi !== null && context.localByDoi.has(doi)) {
    const local = context.localByDoi.get(doi);
    if (local) {
      if (local.abstract && (!abstract || local.abstract.length > abstract.length)) {
        abstract = local.abstract;
      }
      const localUrl = cleanUrlToken(local.url_source ?? local.url);
      if (localUrl) {
        url = localUrl;
        urls.push(localUrl);
      }
    }
  } else {
    const local = context.localByTitleKey.get(normalizeTitleKey(title));
    if (local) {
      if (local.abstract && (!abstract || local.abstract.length > abstract.length)) {
        abstract = local.abstract;
      }
      const localUrl = cleanUrlToken(local.url_source ?? local.url);
      if (localUrl) {
        url = localUrl;
        urls.push(localUrl);
      }
    }
  }

  // [HIGH-3] CRAN / R package records are software, whatever OpenAlex claims.
  const mappedType: Publication['type'] = isRPackageWork(title, urls)
    ? 'software'
    : mapWorkType(rawType);

  let openScienceStage = inferBaselineStage(work, venueInfo.venue, mappedType, urls);
  const openScience = buildOpenScienceEvidence(work);

  const scholarCitations =
    context.scholarByTitleKey.get(normalizeTitleKey(title)) ??
    (mappedType === 'book' ? (context.scholarByTitleKey.get(bookEditionTitleKey(title)) ?? null) : null);

  const publication: Publication = {
    id: sourceShortId(work.id) ?? `doi-${slugifyVenue(title)}`,
    doi,
    openalexId: sourceShortId(work.id),
    title,
    year,
    publicationDate: work.publication_date ?? null,
    type: mappedType,
    venue: venueInfo.venue,
    journalId: venueInfo.venue ? normalizeJournalId(venueInfo.venue) : null,
    authors: (work.authorships ?? [])
      .map((a) => a.author?.display_name)
      .filter((n): n is string => Boolean(n)),
    authorPosition:
      authorPosition === 'first' || authorPosition === 'last' || authorPosition === 'middle' || authorPosition === 'solo'
        ? authorPosition
        : null,
    citations: work.cited_by_count ?? 0,
    citationsOpenAlex: work.cited_by_count ?? 0,
    citationsScholar: scholarCitations,
    citationsByYear: (work.counts_by_year ?? [])
      .filter((entry) => entry.year >= 1)
      .map((entry) => ({ year: entry.year, citedByCount: entry.cited_by_count })),
    fwci: work.fwci ?? null,
    abstract,
    topics: (work.topics ?? [])
      .map((t) => t.display_name)
      .filter((t): t is string => Boolean(t))
      .slice(0, 5),
    openScienceStage,
    openScience,
    url,
  };

  return publication;
}

// ---------------------------------------------------------------------------
// Preprint, CRAN version, and multi-edition book de-duplication
// ---------------------------------------------------------------------------

/** Surname of the first author ('Robin Lovelace' or 'Lovelace, Robin'). */
export function firstAuthorSurname(publication: Publication): string {
  const first = publication.authors[0];
  if (!first) return '';
  const trimmed = first.trim();
  const raw = trimmed.includes(',') ? trimmed.split(',')[0] : trimmed.split(/\s+/).pop();
  return (raw ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** Normalized surnames for all listed authors on a publication. */
export function authorSurnames(publication: Publication): string[] {
  const out: string[] = [];
  for (const rawAuthor of publication.authors) {
    const trimmed = rawAuthor.trim();
    if (!trimmed) continue;
    const raw = trimmed.includes(',') ? trimmed.split(',')[0] : trimmed.split(/\s+/).pop();
    const norm = (raw ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (norm) out.push(norm);
  }
  return out;
}

/**
 * True when two works have overlapping authorship: either the same non-empty
 * first-author surname or at least 50% shared author surnames (overlap
 * coefficient relative to the smaller author list).
 */
export function authorsOverlap(a: Publication, b: Publication): boolean {
  const fa = firstAuthorSurname(a);
  const fb = firstAuthorSurname(b);
  if (fa !== '' && fa === fb) return true;
  const setA = new Set(authorSurnames(a));
  const setB = new Set(authorSurnames(b));
  if (setA.size === 0 || setB.size === 0) return false;
  let shared = 0;
  for (const surname of setA) {
    if (setB.has(surname)) shared += 1;
  }
  return shared / Math.min(setA.size, setB.size) >= 0.5;
}

/**
 * Strip explicit book/chapter edition markers (for example '(2nd ed.)',
 * ', First Edition', 'Revised and expanded edition', ', 2e') while preserving
 * volume and part identifiers ('Volume 1', 'Vol. 2', 'Part II') so
 * multi-volume works never collapse into a single edition family.
 */
export function stripEditionMarkers(title: string): string {
  let cleaned = title.replace(R_PACKAGE_SUFFIX_PATTERN, '');
  // Parenthesized or bracketed edition markers: '(2nd ed.)', '[Revised edition]', '(2e)'.
  cleaned = cleaned.replace(
    /\s*[\(\[]\s*(?:(?:revised(?:\s+(?:and|&)\s+(?:expanded|updated|enlarged))?|expanded|updated|enlarged)\s+)?(?:(?:1st|2nd|3rd|[4-9]th|\d{2,}th|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+(?:edition|ed\.?)|(?:revised(?:\s+(?:and|&)\s+(?:expanded|updated|enlarged))?|expanded|updated|enlarged|new)\s+edition|[1-9]\d?e)\s*[\)\]]/gi,
    '',
  );
  // Trailing or clause-separated ordinal / named edition markers: ', First Edition', ': 2nd ed.'.
  cleaned = cleaned.replace(
    /(?:[,;:\-/]\s*|\s+)(?:(?:revised(?:\s+(?:and|&)\s+(?:expanded|updated|enlarged))?|expanded|updated|enlarged)\s+)?(?:(?:1st|2nd|3rd|[4-9]th|\d{2,}th|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\s+(?:edition\b|ed\.?(?=\s*$|[)\].,;:\-]))|(?:revised(?:\s+(?:and|&)\s+(?:expanded|updated|enlarged))?|expanded|updated|enlarged)\s+edition\b)/gi,
    '',
  );
  // Trailing shorthand edition marker like ', 2e' or ': 3e'.
  cleaned = cleaned.replace(/(?:[,;:\-]\s*)\b([1-9]\d?)e\b\s*$/i, '');
  return cleaned.replace(/[,;:\-\s]+$/, '').trim();
}

/** Normalized book/chapter edition-family title key with edition markers stripped. */
export function bookEditionTitleKey(title: string): string {
  const stripped = stripEditionMarkers(title);
  const key = normalizeTitleKey(stripped);
  return key !== '' ? key : stripped.toLowerCase();
}

/**
 * Dedupe key: normalized title with '[R package <pkg> version ...]' suffixes
 * stripped, then the first author's surname. Non-Latin titles (empty
 * normalized key) fall back to the lowercased raw title.
 */
export function dedupeKey(publication: Publication): string {
  const strippedTitle = publication.title.replace(R_PACKAGE_SUFFIX_PATTERN, '');
  const titleKey = normalizeTitleKey(strippedTitle);
  if (titleKey === '') {
    return publication.title.toLowerCase();
  }
  return `${titleKey}::${firstAuthorSurname(publication)}`;
}

/**
 * Merge preprints (and CRAN version records) into a single keeper sharing the
 * same dedupe key. Books and book chapters are left untouched here so
 * `dedupeEditions` can select the latest edition and sum distinct-DOI OpenAlex
 * citations cleanly.
 */
export function dedupePreprints(publications: Publication[]): Publication[] {
  const byKey = new Map<string, Publication[]>();
  for (const publication of publications) {
    const key = dedupeKey(publication);
    const list = byKey.get(key) ?? [];
    list.push(publication);
    byKey.set(key, list);
  }

  const result: Publication[] = [];
  for (const list of byKey.values()) {
    if (list.length === 1) {
      result.push(list[0]);
      continue;
    }
    const allBooks = list.every((p) => p.type === 'book');
    const allChapters = list.every((p) => p.type === 'book-chapter');
    if (allBooks || allChapters) {
      for (const item of list) {
        result.push(item);
      }
      continue;
    }
    const hasPreprintOrPkg = list.some(
      (p) =>
        p.type === 'preprint' ||
        p.type === 'software' ||
        R_PACKAGE_SUFFIX_PATTERN.test(p.title),
    );
    const years = list.map((p) => p.year);
    const yearSpan = Math.max(...years) - Math.min(...years);
    const distinctDois = new Set(list.map((p) => p.doi).filter(Boolean));
    // Guard against merging distinct works (different DOIs without preprint/CRAN version marker,
    // or >2 year span without preprint/CRAN version marker).
    if (!hasPreprintOrPkg && (yearSpan > 2 || distinctDois.size > 1)) {
      for (const item of list) {
        result.push(item);
      }
      continue;
    }
    const articles = list.filter((p) => p.type === 'article');
    const winner = (articles.length > 0 ? articles : list)
      .slice()
      .sort((a, b) => b.citations - a.citations || b.year - a.year)[0];
    if (!winner) {
      continue;
    }
    const keeper = structuredClone(winner);
    for (const other of list) {
      if (other === winner) continue;
      keeper.citations = Math.max(keeper.citations, other.citations);
      keeper.citationsOpenAlex = Math.max(
        keeper.citationsOpenAlex ?? 0,
        other.citationsOpenAlex ?? 0,
      );
      keeper.citationsScholar = keeper.citationsScholar ?? other.citationsScholar ?? null;
      if (!keeper.openScience.oaUrl && other.openScience.oaUrl) {
        keeper.openScience.oaUrl = other.openScience.oaUrl;
      }
      // Merge citation histories: max citedByCount per year across versions.
      const maxByYear = new Map<number, number>();
      for (const entry of [
        ...(keeper.citationsByYear ?? []),
        ...(other.citationsByYear ?? []),
      ]) {
        maxByYear.set(entry.year, Math.max(maxByYear.get(entry.year) ?? 0, entry.citedByCount));
      }
      keeper.citationsByYear =
        maxByYear.size > 0
          ? Array.from(maxByYear, ([year, citedByCount]) => ({ year, citedByCount })).sort(
              (a, b) => a.year - b.year,
            )
          : null;
    }
    result.push(keeper);
  }
  return result;
}

const OPEN_SCIENCE_TEXT_FIELDS = [
  'oaUrl',
  'dataUrl',
  'codeUrl',
  'reproducibleRepoUrl',
  'interactiveToolUrl',
  'interactiveToolName',
  'rationale',
] as const;

const OPEN_OA_STATUSES = new Set(['gold', 'diamond', 'green', 'hybrid', 'bronze']);

interface EditionDedupeOptions {
  overriddenStagePubs?: ReadonlySet<Publication>;
  curatedOpenScienceFields?: ReadonlyMap<Publication, ReadonlySet<string>>;
}

function partitionOverlappingAuthorClusters(items: Publication[]): Publication[][] {
  const clusters: Publication[][] = [];
  for (const item of items) {
    const matchingIndices: number[] = [];
    for (let i = 0; i < clusters.length; i++) {
      if (clusters[i]!.some((member) => authorsOverlap(member, item))) {
        matchingIndices.push(i);
      }
    }
    if (matchingIndices.length === 0) {
      clusters.push([item]);
    } else {
      const primaryIdx = matchingIndices[0]!;
      clusters[primaryIdx]!.push(item);
      for (let j = matchingIndices.length - 1; j >= 1; j--) {
        const mergeIdx = matchingIndices[j]!;
        clusters[primaryIdx]!.push(...clusters[mergeIdx]!);
        clusters.splice(mergeIdx, 1);
      }
    }
  }
  return clusters;
}

function extractParentBookDoi(
  chapterDoi: string | null | undefined,
  sortedKnownBookDois: readonly string[],
): string | null {
  const norm = normalizeDoi(chapterDoi);
  if (!norm) return null;
  for (const bookDoi of sortedKnownBookDois) {
    if (norm.length > bookDoi.length && norm.startsWith(bookDoi)) {
      const sep = norm[bookDoi.length];
      if (sep === '-' || sep === '.' || sep === '_' || sep === '/') {
        return bookDoi;
      }
    }
  }
  const suffixMatch = /^(.+?)(?:-\d+|\.(?:n?\d+)|_\d+)$/i.exec(norm);
  return suffixMatch?.[1] ?? null;
}

function mergeEditionCluster(
  group: Publication[],
  citationStrategy: 'sum-distinct-doi' | 'max',
  options: EditionDedupeOptions = {},
): Publication {
  const sortedDesc = group.slice().sort(
    (a, b) =>
      b.year - a.year ||
      (b.publicationDate ?? '').localeCompare(a.publicationDate ?? '') ||
      (b.doi ? 1 : 0) - (a.doi ? 1 : 0) ||
      b.citations - a.citations,
  );
  const winner = sortedDesc[0]!;
  const keeper = structuredClone(winner);

  // OpenAlex citations: sum across distinct edition DOIs for books/chapters
  // (taking max within any identical-DOI bucket so duplicate records of the
  // same DOI are never double-counted); take max for mirror records.
  const doiBuckets = new Map<string, Publication[]>();
  const nullDoiPubs: Publication[] = [];
  for (const pub of group) {
    const normDoi = normalizeDoi(pub.doi);
    if (normDoi) {
      const bucket = doiBuckets.get(normDoi) ?? [];
      bucket.push(pub);
      doiBuckets.set(normDoi, bucket);
    } else {
      nullDoiPubs.push(pub);
    }
  }

  if (citationStrategy === 'sum-distinct-doi' && doiBuckets.size > 1) {
    let summedOpenAlex = 0;
    const summedByYear = new Map<number, number>();
    for (const bucket of doiBuckets.values()) {
      const bucketMax = Math.max(...bucket.map((p) => p.citationsOpenAlex ?? p.citations));
      summedOpenAlex += bucketMax;
      const bucketByYear = new Map<number, number>();
      for (const pub of bucket) {
        for (const entry of pub.citationsByYear ?? []) {
          bucketByYear.set(
            entry.year,
            Math.max(bucketByYear.get(entry.year) ?? 0, entry.citedByCount),
          );
        }
      }
      for (const [year, count] of bucketByYear) {
        summedByYear.set(year, (summedByYear.get(year) ?? 0) + count);
      }
    }
    const nullMax =
      nullDoiPubs.length > 0
        ? Math.max(...nullDoiPubs.map((p) => p.citationsOpenAlex ?? p.citations))
        : 0;
    const finalOpenAlex = Math.max(summedOpenAlex, nullMax);
    keeper.citations = finalOpenAlex;
    keeper.citationsOpenAlex = finalOpenAlex;
    keeper.citationsByYear =
      summedByYear.size > 0
        ? Array.from(summedByYear, ([year, citedByCount]) => ({ year, citedByCount })).sort(
            (a, b) => a.year - b.year,
          )
        : null;
  } else {
    const maxOpenAlex = Math.max(...group.map((p) => p.citationsOpenAlex ?? p.citations));
    keeper.citations = maxOpenAlex;
    keeper.citationsOpenAlex = maxOpenAlex;
    const maxByYear = new Map<number, number>();
    for (const pub of group) {
      for (const entry of pub.citationsByYear ?? []) {
        maxByYear.set(entry.year, Math.max(maxByYear.get(entry.year) ?? 0, entry.citedByCount));
      }
    }
    keeper.citationsByYear =
      maxByYear.size > 0
        ? Array.from(maxByYear, ([year, citedByCount]) => ({ year, citedByCount })).sort(
            (a, b) => a.year - b.year,
          )
        : null;
  }

  // Google Scholar citations: never sum across editions (Scholar groups
  // editions onto the same title row, so summing would double-count).
  const scholarValues = group
    .map((p) => p.citationsScholar)
    .filter((c): c is number => typeof c === 'number');
  keeper.citationsScholar = scholarValues.length > 0 ? Math.max(...scholarValues) : null;

  // Open Science stage: inherit max stage across editions unless the latest
  // edition carried an explicit stage override while older editions did not.
  const winnerExplicitStage = options.overriddenStagePubs?.has(winner) === true;
  const otherExplicitStage = sortedDesc
    .slice(1)
    .some((p) => options.overriddenStagePubs?.has(p) === true);
  if (!winnerExplicitStage || otherExplicitStage) {
    keeper.openScienceStage = Math.max(...group.map((p) => p.openScienceStage));
  }

  if (group.some((p) => p.featured === true)) {
    keeper.featured = true;
  }

  // Inherit curated and non-empty Open Science evidence fields.
  keeper.openScience = { ...keeper.openScience };
  const winnerCuratedFields = options.curatedOpenScienceFields?.get(winner);
  for (const field of OPEN_SCIENCE_TEXT_FIELDS) {
    if (!winnerCuratedFields?.has(field)) {
      const curatedDonor = sortedDesc.find(
        (p) => options.curatedOpenScienceFields?.get(p)?.has(field) && Boolean(p.openScience[field]),
      );
      if (curatedDonor?.openScience[field]) {
        keeper.openScience[field] = curatedDonor.openScience[field];
        continue;
      }
    }
    if (!keeper.openScience[field]) {
      const donor = sortedDesc.find((p) => Boolean(p.openScience[field]));
      if (donor?.openScience[field]) {
        keeper.openScience[field] = donor.openScience[field];
      }
    }
  }
  if (!keeper.openScience.oaStatus || !OPEN_OA_STATUSES.has(keeper.openScience.oaStatus)) {
    const openDonor = sortedDesc.find(
      (p) => p.openScience.oaStatus !== undefined && p.openScience.oaStatus !== null && OPEN_OA_STATUSES.has(p.openScience.oaStatus),
    );
    if (openDonor?.openScience.oaStatus) {
      keeper.openScience.oaStatus = openDonor.openScience.oaStatus;
    } else if (!keeper.openScience.oaStatus) {
      const anyDonor = sortedDesc.find((p) => Boolean(p.openScience.oaStatus));
      if (anyDonor?.openScience.oaStatus) {
        keeper.openScience.oaStatus = anyDonor.openScience.oaStatus;
      }
    }
  }

  // Inherit missing bibliographic metadata from earlier editions.
  for (const other of sortedDesc.slice(1)) {
    if (!keeper.url && other.url) keeper.url = other.url;
    if (!keeper.venue && other.venue) {
      keeper.venue = other.venue;
      keeper.journalId = keeper.journalId ?? other.journalId;
    }
    if (!keeper.abstract && other.abstract) keeper.abstract = other.abstract;
    if ((keeper.fwci === null || keeper.fwci === undefined) && other.fwci !== null && other.fwci !== undefined) {
      keeper.fwci = other.fwci;
    }
    if (keeper.topics.length === 0 && other.topics.length > 0) {
      keeper.topics = [...other.topics];
    }
    if (!keeper.authorPosition && other.authorPosition) {
      keeper.authorPosition = other.authorPosition;
    }
    if (!keeper.bibtexKey && other.bibtexKey) {
      keeper.bibtexKey = other.bibtexKey;
    }
  }

  return keeper;
}

function dedupeEditionsInternal(
  publications: Publication[],
  options: EditionDedupeOptions = {},
): { publications: Publication[]; memberToKeeper: Map<Publication, Publication> } {
  const memberToKeeper = new Map<Publication, Publication>();
  const replacementAtFirstSeen = new Map<Publication, Publication>();
  const consumed = new Set<Publication>();

  // 1. Group and merge multi-edition `book` works, building parent-book DOI
  //    family mappings so multi-edition chapters of merged parent books can
  //    also collapse without ever merging chapters from distinct books.
  const booksByTitleKey = new Map<string, Publication[]>();
  for (const pub of publications) {
    if (pub.type !== 'book') continue;
    const key = bookEditionTitleKey(pub.title);
    if (key === '') continue;
    const list = booksByTitleKey.get(key) ?? [];
    list.push(pub);
    booksByTitleKey.set(key, list);
  }

  const bookDoiToFamilyId = new Map<string, string>();
  const knownBookDoiSet = new Set<string>();
  let familyCounter = 0;

  for (const group of booksByTitleKey.values()) {
    const clusters = partitionOverlappingAuthorClusters(group);
    for (const cluster of clusters) {
      const familyId = `book-family-${familyCounter++}`;
      for (const book of cluster) {
        const normDoi = normalizeDoi(book.doi);
        if (normDoi) {
          knownBookDoiSet.add(normDoi);
          bookDoiToFamilyId.set(normDoi, familyId);
        }
      }
      if (cluster.length > 1) {
        const keeper = mergeEditionCluster(cluster, 'sum-distinct-doi', options);
        const firstSeen = cluster[0]!;
        replacementAtFirstSeen.set(firstSeen, keeper);
        for (const member of cluster) {
          memberToKeeper.set(member, keeper);
          if (member !== firstSeen) consumed.add(member);
        }
      }
    }
  }

  const sortedKnownBookDois = Array.from(knownBookDoiSet).sort((a, b) => b.length - a.length);

  // 2. Group and merge multi-edition `book-chapter` works belonging to the
  //    SAME parent book edition family (never across different parent books).
  const chaptersByScopeAndTitle = new Map<string, Publication[]>();
  for (const pub of publications) {
    if (pub.type !== 'book-chapter') continue;
    const parentDoi = extractParentBookDoi(pub.doi, sortedKnownBookDois);
    const parentScope =
      (parentDoi ? bookDoiToFamilyId.get(parentDoi) : undefined) ??
      (parentDoi ? `parent:${parentDoi}` : null);
    if (!parentScope) continue;
    const titleKey = bookEditionTitleKey(pub.title);
    if (titleKey === '') continue;
    const key = `${parentScope}::${titleKey}`;
    const list = chaptersByScopeAndTitle.get(key) ?? [];
    list.push(pub);
    chaptersByScopeAndTitle.set(key, list);
  }

  for (const group of chaptersByScopeAndTitle.values()) {
    if (group.length < 2) continue;
    const clusters = partitionOverlappingAuthorClusters(group);
    for (const cluster of clusters) {
      if (cluster.length > 1) {
        const keeper = mergeEditionCluster(cluster, 'sum-distinct-doi', options);
        const firstSeen = cluster[0]!;
        replacementAtFirstSeen.set(firstSeen, keeper);
        for (const member of cluster) {
          memberToKeeper.set(member, keeper);
          if (member !== firstSeen) consumed.add(member);
        }
      }
    }
  }

  // 3. Deduplicate same-year identical-title/author mirror records (`type === 'other'`,
  //    e.g. Rogue Scholar / Zenodo blog mirrors with yearSpan === 0 and non-generic title).
  const othersByYearAndTitle = new Map<string, Publication[]>();
  for (const pub of publications) {
    if (pub.type !== 'other') continue;
    const titleKey = normalizeTitleKey(pub.title);
    if (titleKey.length < 20) continue;
    const key = `${pub.year}::${titleKey}`;
    const list = othersByYearAndTitle.get(key) ?? [];
    list.push(pub);
    othersByYearAndTitle.set(key, list);
  }

  for (const group of othersByYearAndTitle.values()) {
    if (group.length < 2) continue;
    const clusters = partitionOverlappingAuthorClusters(group);
    for (const cluster of clusters) {
      if (cluster.length > 1) {
        const keeper = mergeEditionCluster(cluster, 'max', options);
        const firstSeen = cluster[0]!;
        replacementAtFirstSeen.set(firstSeen, keeper);
        for (const member of cluster) {
          memberToKeeper.set(member, keeper);
          if (member !== firstSeen) consumed.add(member);
        }
      }
    }
  }

  const out: Publication[] = [];
  for (const pub of publications) {
    if (consumed.has(pub)) continue;
    out.push(replacementAtFirstSeen.get(pub) ?? pub);
  }
  return { publications: out, memberToKeeper };
}

/**
 * Collapse multi-edition books (and multi-edition chapters of merged parent
 * books, plus same-year mirror records) into the latest edition while summing
 * OpenAlex citations across distinct edition DOIs, taking the max Google
 * Scholar citation count, and inheriting Open Science stages and evidence.
 */
export function dedupeEditions(publications: Publication[]): Publication[] {
  return dedupeEditionsInternal(publications).publications;
}

// ---------------------------------------------------------------------------
// Overrides
// ---------------------------------------------------------------------------

function matchOverride(
  publication: Publication,
  overrides: Record<string, OverrideEntry>,
): { key: string; entry: OverrideEntry } | null {
  if (publication.doi) {
    const pubDoi = normalizeDoi(publication.doi);
    if (pubDoi) {
      for (const [key, entry] of Object.entries(overrides)) {
        if (entry.doi && normalizeDoi(entry.doi) === pubDoi) return { key, entry };
        if (entry.dois?.some((d) => normalizeDoi(d) === pubDoi)) return { key, entry };
      }
    }
  }
  const titleLower = publication.title.toLowerCase();
  for (const [key, entry] of Object.entries(overrides)) {
    if (entry.titleMatch && titleLower.includes(entry.titleMatch.toLowerCase())) {
      return { key, entry };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Journal metric enrichment
// ---------------------------------------------------------------------------

function openalexSourcePartial(source: RawOpenAlexSource): Partial<JournalMetric> {
  const stats = source.summary_stats ?? {};
  return {
    openalexSourceId: sourceShortId(source.id),
    twoYearMeanCitedness: stats['2yr_mean_citedness'] ?? null,
    journalHIndex: stats.h_index ?? null,
    journalI10Index: stats.i10_index ?? null,
    isOa: source.is_oa ?? null,
    isInDoaj: source.is_in_doaj ?? null,
    apcUsd: source.apc_usd ?? null,
  };
}

/**
 * Coalesce two nullable values: the first (curated) value wins when defined
 * and non-null; otherwise the second (OpenAlex) value fills the gap. Curated
 * non-null entries therefore never get overwritten by OpenAlex nulls.
 */
function coalesce<T>(curated: T | null | undefined, openalex: T | null | undefined): T | null {
  if (curated !== undefined && curated !== null) return curated;
  if (openalex !== undefined && openalex !== null) return openalex;
  return null;
}

async function buildBaseJournals(
  curated: CuratedJournal[],
  plannedPapers: PlannedPaper[],
  sourceRecords: Map<string, RawOpenAlexSource>,
  port: OpenAlexPort,
): Promise<Partial<JournalMetric>[]> {
  const curatedById = new Map<string, CuratedJournal>();
  for (const entry of curated) {
    curatedById.set(normalizeJournalId(entry.id), entry);
  }

  const sourcesByName = new Map<string, RawOpenAlexSource>();
  const sourcesByBareName = new Map<string, RawOpenAlexSource>();
  const sourcesByIssn = new Map<string, RawOpenAlexSource>();
  for (const source of sourceRecords.values()) {
    if (source.display_name) {
      const slug = normalizeJournalId(source.display_name);
      sourcesByName.set(slug, source);
      sourcesByBareName.set(stripLeadingThe(slug), source);
    }
    for (const issn of source.issn ?? []) {
      sourcesByIssn.set(issn.trim(), source);
    }
  }

  // Candidate names needing a canonical source lookup: curated journals and
  // planned-paper targets without an existing entry in sourceRecords.
  const lookupNames = new Map<string, { name: string; issn?: string }>();
  for (const entry of curated) {
    const slug = normalizeJournalId(entry.name);
    const hasMatch =
      sourcesByName.has(slug) ||
      sourcesByBareName.has(stripLeadingThe(slug)) ||
      (entry.issn ?? []).some((i) => sourcesByIssn.has(i.trim()));
    if (!hasMatch) {
      lookupNames.set(slug, { name: entry.name, issn: entry.issn?.[0] });
    }
  }
  for (const paper of plannedPapers) {
    for (const candidate of paper.targetJournals) {
      const id = normalizeJournalId(candidate.journalId);
      const nameSlug = normalizeJournalId(candidate.journalName);
      if (!curatedById.has(id) && !sourcesByName.has(nameSlug) && !lookupNames.has(nameSlug)) {
        lookupNames.set(nameSlug, { name: candidate.journalName });
      }
    }
  }

  for (const [key, lookup] of lookupNames) {
    try {
      const found = await port.searchCanonicalJournal(lookup.name, lookup.issn);
      if (found) {
        sourcesByName.set(key, found);
        sourcesByBareName.set(stripLeadingThe(key), found);
        for (const issn of found.issn ?? []) {
          sourcesByIssn.set(issn.trim(), found);
        }
      }
    } catch {
      // Canonical lookup is best-effort; curated metrics still apply.
    }
  }

  const basePartials: Partial<JournalMetric>[] = [];
  const emittedIds = new Set<string>();
  const consumedSourceIds = new Set<string>();

  for (const entry of curated) {
    const id = normalizeJournalId(entry.id);
    const nameSlug = normalizeJournalId(entry.name);
    const source =
      (entry.issn ?? []).map((i) => sourcesByIssn.get(i.trim())).find(Boolean) ??
      sourcesByName.get(nameSlug) ??
      sourcesByBareName.get(stripLeadingThe(nameSlug)) ??
      sourcesByBareName.get(stripLeadingThe(id));
    if (source?.id) consumedSourceIds.add(source.id);
    const openalex = source ? openalexSourcePartial(source) : null;
    // Curated non-null values always win; OpenAlex fields only fill gaps.
    const merged: Partial<JournalMetric> = {
      id,
      name: entry.name,
      shortName: entry.shortName ?? null,
      venueType: source?.type ? mapVenueType(source.type) : 'journal',
      issn: entry.issn ?? (source?.issn ?? null),
      publisher: coalesce(entry.publisher, source?.host_organization_name),
      jif: entry.jif ?? null,
      jifYear: entry.jifYear ?? null,
      citescore: entry.citescore ?? null,
      sjrScore: entry.sjrScore ?? null,
      sjrQuartile: entry.sjrQuartile ?? null,
      oaModel: entry.oaModel ?? 'unknown',
      reviewSpeedWeeks: entry.reviewSpeedWeeks ?? null,
      scopeTags: entry.scopeTags ?? [],
      homepageUrl: coalesce(entry.homepageUrl, source?.homepage_url),
      apcUsd: coalesce(entry.apcUsd, openalex?.apcUsd),
      openalexSourceId: openalex?.openalexSourceId ?? null,
      twoYearMeanCitedness: openalex?.twoYearMeanCitedness ?? null,
      journalHIndex: openalex?.journalHIndex ?? null,
      journalI10Index: openalex?.journalI10Index ?? null,
      isOa: openalex?.isOa ?? null,
      isInDoaj: openalex?.isInDoaj ?? null,
      metricSource: openalex ? 'hybrid' : 'curated',
    };
    basePartials.push(merged);
    emittedIds.add(id);
  }

  // Planned-paper target journals that had no curated entry.
  for (const paper of plannedPapers) {
    for (const candidate of paper.targetJournals) {
      const id = normalizeJournalId(candidate.journalId);
      if (emittedIds.has(id)) continue;
      const source =
        sourcesByName.get(normalizeJournalId(candidate.journalName)) ??
        sourcesByBareName.get(stripLeadingThe(normalizeJournalId(candidate.journalName)));
      if (source?.id) consumedSourceIds.add(source.id);
      const merged: Partial<JournalMetric> = {
        id,
        name: candidate.journalName,
        venueType: source?.type ? mapVenueType(source.type) : 'journal',
        publisher: source?.host_organization_name ?? null,
        issn: source?.issn ?? null,
        ...(source ? openalexSourcePartial(source) : {}),
        metricSource: source ? 'openalex' : 'curated',
      };
      basePartials.push(merged);
      emittedIds.add(id);
    }
  }

  // Remaining OpenAlex sources from the author's published works (preserving
  // full display_name, venueType, publisher, and OpenAlex citation metrics).
  for (const source of sourceRecords.values()) {
    if (source.id && consumedSourceIds.has(source.id)) continue;
    if (!source.display_name) continue;
    const id = normalizeJournalId(source.display_name);
    if (emittedIds.has(id) || emittedIds.has(stripLeadingThe(id))) continue;
    const oaModel: JournalMetric['oaModel'] =
      source.is_oa === true
        ? source.apc_usd === 0
          ? 'diamond'
          : 'gold'
        : 'unknown';
    basePartials.push({
      id,
      name: source.display_name,
      venueType: mapVenueType(source.type),
      publisher: source.host_organization_name ?? null,
      issn: source.issn ?? null,
      oaModel,
      ...openalexSourcePartial(source),
      metricSource: 'openalex',
    });
    emittedIds.add(id);
  }

  return basePartials;
}

// ---------------------------------------------------------------------------
// Snapshot assembly
// ---------------------------------------------------------------------------

export interface SyncOptions {
  /** Pre-constructed client (real OpenAlexClient or any mock implementing OpenAlexPort). */
  client?: OpenAlexPort;
  /** Pre-fetched raw bundle; wrapped in OfflineOpenAlexClient when no client is given. */
  offlineBundle?: OfflineBundle;
  /** Optional Google Scholar CSV export with 'title' and 'citations_numeric' (or 'cites') columns. */
  scholarCsvPath?: string;
  /** Optional Quarto publications.yml with richer abstracts and urls. */
  publicationsYmlPath?: string;
  /** Optional path for the full (unsanitized) private snapshot JSON. */
  privateOut?: string;
  /** Progress logger; defaults to console.log. */
  log?: (message: string) => void;
}

export interface SyncResult {
  snapshot: PortfolioSnapshot;
  publicPath: string;
  privatePath: string | null;
  publications: Publication[];
  journals: JournalMetric[];
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function resolveAuthorIdentifier(config: ResearchHqConfig): string {
  const candidates = [
    config.sync?.openalexAuthorId,
    config.author.openalexId,
    config.sync?.orcid,
    config.author.orcid,
  ];
  const found = candidates.find((c) => typeof c === 'string' && c.trim() !== '');
  if (!found) {
    throw new Error('No OpenAlex author id or ORCID configured under sync.openalexAuthorId or author.orcid');
  }
  const trimmed = found.trim();
  // [MEDIUM-14] Reject the init placeholder before a pointless network round trip.
  const normalizedOrcid = trimmed
    .replace(/^https?:\/\/orcid\.org\//i, '')
    .replace(/^orcid:/i, '')
    .toLowerCase();
  if (normalizedOrcid === '0000-0000-0000-0000') {
    throw new Error(
      "Placeholder ORCID 0000-0000-0000-0000 detected. Edit 'author.orcid' (and 'sync.orcid') in researchhq.config.yaml to your real ORCID, then rerun sync.",
    );
  }
  return trimmed;
}

/**
 * Run the full sync pipeline for an instance directory and write the sanitized
 * public export (always) plus the optional private snapshot.
 */
export async function syncPortfolio(
  instanceDir: string,
  options: SyncOptions = {},
): Promise<SyncResult> {
  const log = options.log ?? (() => {});
  const config = loadConfig(instanceDir);
  const paths = resolveInstancePaths(instanceDir, config);

  // CLI flags win; otherwise fall back to config paths (relative to the
  // instance dir) when configured. A configured path that is missing on disk
  // is a hard error so silent drops of curated data never happen.
  let scholarCsvPath = options.scholarCsvPath;
  if (!scholarCsvPath && paths.scholarCsv) {
    if (existsSync(paths.scholarCsv)) {
      scholarCsvPath = paths.scholarCsv;
      log(`Using scholar CSV from config paths.scholarCsv: ${scholarCsvPath}`);
    } else {
      throw new Error(
        `Configured paths.scholarCsv not found on disk: ${paths.scholarCsv} (resolved from ${instanceDir})`,
      );
    }
  }
  let publicationsYmlPath = options.publicationsYmlPath;
  if (!publicationsYmlPath && paths.publicationsYml) {
    if (existsSync(paths.publicationsYml)) {
      publicationsYmlPath = paths.publicationsYml;
      log(`Using publications YAML from config paths.publicationsYml: ${publicationsYmlPath}`);
    } else {
      throw new Error(
        `Configured paths.publicationsYml not found on disk: ${paths.publicationsYml} (resolved from ${instanceDir})`,
      );
    }
  }

  const plannedPapers = loadPlannedPapers(paths.plannedPapers);
  const curatedJournals = loadCuratedJournals(paths.journalMetrics);
  const overrides = loadOverrides(paths.overrides);
  const localPublications = publicationsYmlPath
    ? loadLocalPublications(publicationsYmlPath)
    : [];
  const scholar = scholarCsvPath ? loadScholarCsv(scholarCsvPath) : null;

  const port: OpenAlexPort =
    options.client ??
    (options.offlineBundle ? new OfflineOpenAlexClient(options.offlineBundle) : new OpenAlexClient());

  const authorIdentifier = resolveAuthorIdentifier(config);
  log(`Fetching author profile for ${authorIdentifier}`);
  const author = await port.fetchAuthor(authorIdentifier);
  const authorShortId = author.id.split('/').pop() || authorIdentifier;

  log('Fetching works');
  const works = await port.fetchAuthorWorks(authorShortId);

  // Collect every source id referenced by the works.
  const sourceIds = new Set<string>();
  for (const work of works) {
    const primary = work.primary_location?.source;
    if (primary?.id) sourceIds.add(sourceShortId(primary.id) ?? '');
    for (const location of work.locations ?? []) {
      const sourceId = sourceShortId(location.source?.id);
      if (sourceId) sourceIds.add(sourceId);
    }
  }
  sourceIds.delete('');
  log(`Fetching ${sourceIds.size} source records`);
  const sourceRecords = await port.fetchSourcesByIds(Array.from(sourceIds));

  const context: WorkContext = {
    year: config.sync?.minYear ?? 0,
    excludedTypes: new Set(config.sync?.excludeTypes ?? DEFAULT_EXCLUDE_TYPES),
    authorShortId,
    localByTitleKey: new Map(localPublications.map((e) => [normalizeTitleKey(e.title), e])),
    localByDoi: new Map(
      localPublications
        .map((e) => [normalizeDoi(e.doi), e] as const)
        .filter((pair): pair is readonly [string, LocalPublicationEntry] => pair[0] !== null),
    ),
    scholarByTitleKey: scholar?.byTitleKey ?? new Map(),
    venueTypesBySlug: new Map(),
  };

  let publications: Publication[] = [];
  for (const work of works) {
    const publication = processWork(work, context);
    if (publication) publications.push(publication);
  }
  log(`${publications.length} works after cleaning`);
  publications = dedupePreprints(publications);

  // Apply curated overrides: DOI match first, then case-insensitive titleMatch.
  // Overrides run before multi-edition book deduplication so an override keyed
  // to an earlier edition DOI automatically propagates its Open Science stage,
  // curated URLs, and featured status onto the latest edition keeper, while
  // match counts are evaluated against distinct post-dedupe keepers.
  const matchedKeyByPub = new Map<Publication, string>();
  const overriddenStagePubs = new Set<Publication>();
  const curatedOpenScienceFields = new Map<Publication, Set<string>>();
  for (const publication of publications) {
    const matched = matchOverride(publication, overrides);
    if (!matched) continue;
    const { key, entry: override } = matched;
    matchedKeyByPub.set(publication, key);
    if (override.openScienceStage !== undefined && override.openScienceStage !== null) {
      publication.openScienceStage = override.openScienceStage;
      overriddenStagePubs.add(publication);
    }
    if (override.openScience) {
      const previousOaUrl = publication.openScience.oaUrl;
      const definedEvidence = pickDefinedEvidence(override.openScience);
      publication.openScience = {
        ...publication.openScience,
        ...definedEvidence,
      };
      curatedOpenScienceFields.set(publication, new Set(Object.keys(definedEvidence)));
      if (definedEvidence.oaUrl && (!publication.url || publication.url === previousOaUrl)) {
        publication.url = definedEvidence.oaUrl;
      }
    }
    if (override.featured === true) {
      publication.featured = true;
    }
    if (override.citationsScholar !== undefined && override.citationsScholar !== null) {
      publication.citationsScholar = override.citationsScholar;
    }
  }

  const editionDeduped = dedupeEditionsInternal(publications, {
    overriddenStagePubs,
    curatedOpenScienceFields,
  });
  publications = editionDeduped.publications;

  const matchedKeepersByKey = new Map<string, Set<Publication>>();
  for (const [key] of Object.entries(overrides)) {
    matchedKeepersByKey.set(key, new Set());
  }
  for (const [pub, key] of matchedKeyByPub) {
    const surviving = editionDeduped.memberToKeeper.get(pub) ?? pub;
    matchedKeepersByKey.get(key)?.add(surviving);
  }
  for (const [key, keepers] of matchedKeepersByKey) {
    const count = keepers.size;
    if (count === 0) {
      console.warn(
        `Override '${key}' matched 0 publications; check its doi/titleMatch in overrides.yaml`,
      );
    } else if (count > 1) {
      console.warn(
        `Override '${key}' matched ${count} publications; tighten its doi/titleMatch in overrides.yaml to target one work`,
      );
    }
  }

  const baseJournals = await buildBaseJournals(curatedJournals, plannedPapers, sourceRecords, port);

  // Rewrite publication.journalId to the resolved JournalMetric.id (matched by
  // normalized id or venue name, with optional leading 'the' ignored) so the
  // dashboard's journal filters always join cleanly.
  const aliasToJournalId = new Map<string, string>();
  for (const base of baseJournals) {
    if (!base.id) continue;
    const resolvedId = base.id;
    const idSlug = normalizeJournalId(resolvedId);
    aliasToJournalId.set(idSlug, resolvedId);
    aliasToJournalId.set(stripLeadingThe(idSlug), resolvedId);
    if (base.name) {
      const nameSlug = normalizeJournalId(base.name);
      aliasToJournalId.set(nameSlug, resolvedId);
      aliasToJournalId.set(stripLeadingThe(nameSlug), resolvedId);
    }
  }
  for (const publication of publications) {
    if (!publication.journalId) continue;
    const resolved =
      aliasToJournalId.get(publication.journalId) ??
      aliasToJournalId.get(stripLeadingThe(publication.journalId));
    if (resolved) {
      publication.journalId = resolved;
    }
  }
  const journals = aggregateJournalMetrics(publications, plannedPapers, baseJournals);

  // Reflect resolved repository / book-series / conference venue types from
  // the works onto their journal entries (curated defaults stay untouched).
  for (const journal of journals) {
    const resolved = context.venueTypesBySlug.get(normalizeJournalId(journal.id));
    if (resolved && (journal.venueType === 'journal' || journal.venueType === null)) {
      journal.venueType = resolved;
    }
  }

  // Drop orphan non-journal venues (repositories, book series, conferences)
  // that the author never published in and nobody targets.
  const keptJournals = journals.filter(
    (j) =>
      !(
        j.authorPublishedCount === 0 &&
        j.targetPaperCount === 0 &&
        j.venueType !== 'journal'
      ),
  );

  // Author metrics computed from the cleaned publication set.
  const citationsList = publications.map((p) => p.citations);
  const venueTypeById = new Map(keptJournals.map((j) => [j.id, j.venueType] as const));
  // Peer-reviewed = journal articles in an actual journal venue (not
  // preprints, tutorials, or R package releases resolved to repositories).
  const peerReviewedCount = publications.filter(
    (p) =>
      p.type === 'article' &&
      typeof p.journalId === 'string' &&
      venueTypeById.get(p.journalId) === 'journal',
  ).length;
  const oaCount = publications.filter(
    (p) =>
      p.openScience.oaStatus !== undefined &&
      p.openScience.oaStatus !== null &&
      p.openScience.oaStatus !== 'closed' &&
      p.openScience.oaStatus !== 'unknown',
  ).length;
  const scholarCitationsList = publications
    .map((p) => p.citationsScholar)
    .filter((c): c is number => typeof c === 'number');

  const configuredScholarTotal = config.sync?.scholarSummary?.citedByCount ?? null;
  const configuredScholarHIndex = config.sync?.scholarSummary?.hIndex ?? null;
  const configuredScholarI10 = config.sync?.scholarSummary?.i10Index ?? null;
  const computedScholarTotal = scholar ? scholar.total : null;
  const computedScholarHIndex = scholar ? computeHIndex(scholarCitationsList) : null;

  const citedByScholar = configuredScholarTotal ?? computedScholarTotal;
  const hIndexScholar = configuredScholarHIndex ?? computedScholarHIndex;
  const cleanedCitedByCount = citationsList.reduce((sum, c) => sum + c, 0);

  const authorMetrics = {
    worksCount: publications.length,
    peerReviewedCount,
    citedByCount: cleanedCitedByCount,
    citedByCountProfile: author.cited_by_count ?? null,
    citedByScholar,
    hIndex: computeHIndex(citationsList),
    hIndexScholar,
    i10Index: computeI10Index(citationsList),
    i10IndexScholar: configuredScholarI10,
    twoYearMeanCitedness: author.summary_stats?.['2yr_mean_citedness'] ?? null,
    oaPercentage: publications.length > 0 ? round1((oaCount / publications.length) * 100) : 0,
    stageCounts: computeStageCounts(publications),
    updatedAt: new Date().toISOString(),
  };

  const snapshot: PortfolioSnapshot = {
    schemaVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    sanitized: false,
    author: {
      ...config.author,
      metrics: authorMetrics,
    },
    publications,
    journals: keptJournals,
    plannedPapers,
    timeSeries: buildTimeSeries(publications, plannedPapers),
  };

  const validated = PortfolioSnapshotSchema.parse(snapshot);

  if (options.privateOut) {
    const privatePath = isAbsolute(options.privateOut)
      ? options.privateOut
      : resolve(instanceDir, options.privateOut);
    writeFileEnsuringDir(privatePath, JSON.stringify(validated, null, 2) + '\n');
    log(`Private snapshot written to ${privatePath}`);
  }

  const publicSnapshot = sanitizePortfolioForPublic(validated);
  writeFileEnsuringDir(paths.publicExport, JSON.stringify(publicSnapshot, null, 2) + '\n');
  log(`Public snapshot written to ${paths.publicExport}`);

  return {
    snapshot: validated,
    publicPath: paths.publicExport,
    privatePath: options.privateOut
      ? resolve(instanceDir, options.privateOut)
      : null,
    publications,
    journals: keptJournals,
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface ValidateResult {
  ok: boolean;
  errors: string[];
  checkedFiles: string[];
}

/**
 * Validate every YAML input plus the public export (when present). The public
 * export must carry sanitized: true, contain none of the forbidden keys
 * (`privateNotes`, `symplecticId`, `redactUrlInPublic`) anywhere, and every
 * `visibility: 'private'` repo link must have an empty url.
 */

/** Recursively collect dotted paths of forbidden object keys. */
function collectForbiddenKeys(
  value: unknown,
  forbidden: readonly string[],
  path: string,
  out: string[],
): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      collectForbiddenKeys(item, forbidden, `${path}[${index}]`, out);
    });
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (forbidden.includes(key)) {
        out.push(`${path}.${key}`);
      }
      collectForbiddenKeys(child, forbidden, `${path}.${key}`, out);
    }
  }
}

const FORBIDDEN_PUBLIC_KEYS: readonly string[] = ['privateNotes', 'symplecticId', 'redactUrlInPublic'];

export function validateInstance(instanceDir: string): ValidateResult {
  const errors: string[] = [];
  const checkedFiles: string[] = [];

  let config: ResearchHqConfig;
  try {
    config = loadConfig(instanceDir);
  } catch (error) {
    return {
      ok: false,
      errors: [error instanceof Error ? error.message : String(error)],
      checkedFiles,
    };
  }
  const paths = resolveInstancePaths(instanceDir, config);
  checkedFiles.push(paths.config);

  try {
    const papers = loadPlannedPapers(paths.plannedPapers);
    checkedFiles.push(paths.plannedPapers);
    const slugs = new Set<string>();
    for (const paper of papers) {
      if (slugs.has(paper.slug)) errors.push(`Duplicate planned paper slug: ${paper.slug}`);
      slugs.add(paper.slug);
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  try {
    const journals = loadCuratedJournals(paths.journalMetrics);
    checkedFiles.push(paths.journalMetrics);
    const ids = new Set<string>();
    for (const journal of journals) {
      const id = normalizeJournalId(journal.id);
      if (ids.has(id)) errors.push(`Duplicate journal id: ${journal.id}`);
      ids.add(id);
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  try {
    checkedFiles.push(paths.overrides);
    loadOverrides(paths.overrides);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  // When paths.scholarCsv is configured it must exist and parse cleanly.
  if (paths.scholarCsv) {
    try {
      if (!existsSync(paths.scholarCsv)) {
        errors.push(
          `${paths.scholarCsv}: configured paths.scholarCsv file does not exist`,
        );
      } else {
        checkedFiles.push(paths.scholarCsv);
        parseCsv(readFileSync(paths.scholarCsv, 'utf8'));
      }
    } catch (error) {
      errors.push(
        `${paths.scholarCsv}: scholar CSV failed to parse: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  const publicRaw = readJsonIfExists(paths.publicExport);
  if (publicRaw !== undefined) {
    checkedFiles.push(paths.publicExport);
    if (
      typeof publicRaw !== 'object' ||
      publicRaw === null ||
      (publicRaw as { sanitized?: unknown }).sanitized !== true
    ) {
      errors.push(`${paths.publicExport}: public export must carry sanitized: true`);
    }
    const forbiddenHits: string[] = [];
    collectForbiddenKeys(publicRaw, FORBIDDEN_PUBLIC_KEYS, '$', forbiddenHits);
    for (const hit of forbiddenHits) {
      errors.push(`${paths.publicExport}: public export contains forbidden key ${hit}`);
    }
    const parsed = PortfolioSnapshotSchema.safeParse(publicRaw);
    if (!parsed.success) {
      errors.push(`${paths.publicExport}: schema validation failed: ${parsed.error.message}`);
    } else {
      for (const paper of parsed.data.plannedPapers) {
        for (const link of paper.repoUrls) {
          if (link.visibility === 'private' && link.url !== '') {
            errors.push(
              `${paths.publicExport}: repo link '${link.label}' on '${paper.slug}' is visibility private but still carries a url`,
            );
          }
        }
      }
    }
  }

  return { ok: errors.length === 0, errors, checkedFiles };
}

// ---------------------------------------------------------------------------
// Public URL link checking (--check-links)
// ---------------------------------------------------------------------------

/** One unreachable public URL: where it came from, the URL, and why it failed. */
export interface PublicUrlFailure {
  /** Human-readable provenance, for example 'planned-papers.yaml:<slug>.repoUrls[Code]'. */
  source: string;
  url: string;
  /** HTTP status code, or a string describing a network-level failure. */
  status: number | string;
}

export interface CheckPublicUrlsResult {
  checked: number;
  failures: PublicUrlFailure[];
}

const LINK_CHECK_CONCURRENCY = 6;
const LINK_CHECK_TIMEOUT_MS = 6000;
const LINK_CHECK_USER_AGENT = 'ResearchHQ-LinkChecker/0.1';

/** Override fields carrying public URLs that --check-links probes. */
const OVERRIDE_URL_FIELDS: readonly (keyof OverrideEntry)[] = [
  'codeUrl',
  'dataUrl',
  'reproducibleRepoUrl',
  'interactiveToolUrl',
];

/**
 * Collect unique http(s) URLs that will appear in the public export, mapped to
 * a human-readable source label (first occurrence wins). Planned paper repo
 * links marked private or redactUrlInPublic are skipped. Malformed YAML is
 * tolerated here: structural validation already reports it.
 */
function collectPublicUrls(instanceDir: string): Map<string, string> {
  const urls = new Map<string, string>();
  const add = (source: string, raw: string | null | undefined): void => {
    const url = (raw ?? '').trim();
    if (!/^https?:\/\//i.test(url)) return;
    if (!urls.has(url)) urls.set(url, source);
  };

  let paths: InstancePaths;
  try {
    paths = resolveInstancePaths(instanceDir, loadConfig(instanceDir));
  } catch {
    paths = resolveInstancePaths(instanceDir);
  }

  try {
    for (const paper of loadPlannedPapers(paths.plannedPapers)) {
      for (const link of paper.repoUrls) {
        if (link.visibility === 'private') continue;
        if (link.redactUrlInPublic === true) continue;
        add(`planned-papers.yaml:${paper.slug}.repoUrls[${link.label}]`, link.url);
      }
      if (paper.interactiveToolUrl) {
        add(`planned-papers.yaml:${paper.slug}.interactiveToolUrl`, paper.interactiveToolUrl);
      }
    }
  } catch {
    // Invalid planned-papers.yaml: validateInstance already reports it.
  }

  try {
    const overrides = loadOverrides(paths.overrides);
    for (const [key, entry] of Object.entries(overrides)) {
      for (const field of OVERRIDE_URL_FIELDS) {
        add(`overrides.yaml:${key}.${field}`, entry[field] as string | null | undefined);
      }
    }
  } catch {
    // Invalid overrides.yaml: validateInstance already reports it.
  }

  return urls;
}

type LinkProbeOutcome = { ok: true; status: number } | { ok: false; status: number | string };

/**
 * Probe one URL: HEAD first (with a descriptive User-Agent), falling back to
 * GET once on 405 / 403 / 501 servers that reject HEAD. Anything outside
 * 200..399 counts as a failure; a network-level throw (including the
 * AbortSignal timeout) becomes a string status.
 */
async function probePublicUrl(url: string, fetchImpl: typeof fetch): Promise<LinkProbeOutcome> {
  const attempt = (method: 'HEAD' | 'GET'): Promise<Response> =>
    fetchImpl(url, {
      method,
      headers: { 'User-Agent': LINK_CHECK_USER_AGENT },
      signal: AbortSignal.timeout(LINK_CHECK_TIMEOUT_MS),
      redirect: 'follow',
    });
  try {
    let response = await attempt('HEAD');
    if (response.status === 405 || response.status === 403 || response.status === 501) {
      await response.body?.cancel().catch(() => {});
      response = await attempt('GET');
    }
    const status = response.status;
    await response.body?.cancel().catch(() => {});
    if (status >= 200 && status < 400) return { ok: true, status };
    if (status === 404 && /^https?:\/\/(www\.)?github\.com\//i.test(url)) {
      return { ok: false, status: '404 (private or missing GitHub repo)' };
    }
    return { ok: false, status };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, status: `network error: ${message}` };
  }
}

/**
 * Verify every public-facing URL in an instance directory (planned paper repo
 * links and interactive tool URLs, plus curated override evidence URLs) is
 * reachable, probing with bounded concurrency. Pass a mock fetchImpl in tests
 * to keep the check offline.
 */
export async function checkPublicUrls(
  instanceDir: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CheckPublicUrlsResult> {
  const targets = collectPublicUrls(instanceDir);
  const entries = Array.from(targets.entries());
  const failures: PublicUrlFailure[] = [];
  let cursor = 0;
  const workerCount = Math.min(LINK_CHECK_CONCURRENCY, entries.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (cursor < entries.length) {
      const [url, source] = entries[cursor] as [string, string];
      cursor += 1;
      const outcome = await probePublicUrl(url, fetchImpl);
      if (!outcome.ok) {
        failures.push({ source, url, status: outcome.status });
      }
    }
  });
  await Promise.all(workers);
  return { checked: entries.length, failures };
}
