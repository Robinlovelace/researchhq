/**
 * Portfolio analytics: citation indices, open science stage counts, time
 * series projection, and journal metric aggregation.
 */
import type {
  JournalMetric,
  OpenScienceStage,
  PlannedPaper,
  Publication,
  StageCountKey,
  StageCounts,
  TimeSeriesPoint,
} from './schemas.js';

// ---------------------------------------------------------------------------
// Citation indices
// ---------------------------------------------------------------------------

/** h-index: the largest h such that h publications have at least h citations. */
export function computeHIndex(citations: number[]): number {
  const sorted = [...citations].sort((a, b) => b - a);
  let h = 0;
  while (h < sorted.length && sorted[h] >= h + 1) {
    h += 1;
  }
  return h;
}

/** i10-index: the number of publications with at least 10 citations. */
export function computeI10Index(citations: number[]): number {
  return citations.filter((c) => c >= 10).length;
}

// ---------------------------------------------------------------------------
// Field-Weighted Citation Impact (FWCI)
// ---------------------------------------------------------------------------

export interface FwciSummary {
  evaluatedCount: number;
  medianFwci: number | null;
  meanFwci: number | null;
  maxFwci: number | null;
  aboveWorldAverageCount: number;
  aboveWorldAverageShare: number | null;
}

/** A finite positive FWCI value; OpenAlex emits null or 0 for unnormalised works. */
function hasValidFwci(publication: Publication): boolean {
  return (
    typeof publication.fwci === 'number' &&
    Number.isFinite(publication.fwci) &&
    publication.fwci > 0
  );
}

const EMPTY_FWCI_SUMMARY: FwciSummary = {
  evaluatedCount: 0,
  medianFwci: null,
  meanFwci: null,
  maxFwci: null,
  aboveWorldAverageCount: 0,
  aboveWorldAverageShare: null,
};

/**
 * Summarise Field-Weighted Citation Impact across publications. FWCI 1.00 is
 * the world average for the field and publication year. Works without a finite
 * positive `fwci` value are excluded. Statistics are rounded to 2 decimal
 * places; the above-world-average share is a percentage rounded to 1 decimal.
 */
export function computeFwciSummary(publications: Publication[]): FwciSummary {
  const values = publications.filter(hasValidFwci).map((p) => p.fwci as number);
  if (values.length === 0) return { ...EMPTY_FWCI_SUMMARY };

  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const max = sorted[sorted.length - 1];
  const aboveWorldAverageCount = values.filter((v) => v > 1.0).length;
  return {
    evaluatedCount: values.length,
    medianFwci: round2(median),
    meanFwci: round2(mean),
    maxFwci: round2(max),
    aboveWorldAverageCount,
    aboveWorldAverageShare:
      Math.round((aboveWorldAverageCount / values.length) * 1000) / 10,
  };
}

// ---------------------------------------------------------------------------
// Open science upgrade opportunities
// ---------------------------------------------------------------------------

export interface OpenScienceUpgradeOpportunity {
  publicationId: string;
  doi: string | null;
  title: string;
  year: number;
  citations: number;
  fwci: number | null;
  currentStage: OpenScienceStage;
  targetStage: OpenScienceStage;
  actionLabel: string;
  overrideKeySuggestion: string;
}

/** Action mapping from the current open science stage to the next upgrade. */
const UPGRADE_ACTIONS: Record<number, { targetStage: OpenScienceStage; actionLabel: string }> = {
  0: {
    targetStage: 1,
    actionLabel: 'Deposit accepted manuscript (Green OA) or record open-access URL',
  },
  1: {
    targetStage: 3,
    actionLabel: 'Link open analysis scripts or software repository (codeUrl in overrides.yaml)',
  },
  2: {
    targetStage: 3,
    actionLabel: 'Publish and link analysis code alongside existing open dataset',
  },
  3: {
    targetStage: 4,
    actionLabel: 'Link reproducible Quarto/RMarkdown manuscript repo (reproducibleRepoUrl)',
  },
};

/**
 * Suggested overrides.yaml key: lowercase slug of the first 4 alphabetic or
 * numeric words of the title joined by hyphens, plus the publication year.
 */
function suggestOverrideKey(title: string, year: number): string {
  const words = title
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w !== '')
    .slice(0, 4);
  return `${words.join('-')}-${year}`;
}

const UPGRADEABLE_TYPES: ReadonlySet<Publication['type']> = new Set([
  'article',
  'book',
  'book-chapter',
]);

/**
 * Identify the highest-impact publications below Stage 4 (reproducible
 * documented paper) with a concrete next upgrade action per publication.
 * Candidates are scored by citations plus five times FWCI (when available) so
 * field-weighted impact breaks ties beyond raw citation counts, and sorted
 * descending by score with year descending then title ascending tie-breaks.
 */
export function computeOpenScienceGaps(
  publications: Publication[],
  limit = 10,
): OpenScienceUpgradeOpportunity[] {
  const scored = publications
    .filter((p) => UPGRADEABLE_TYPES.has(p.type) && p.openScienceStage < 4)
    .map((p) => ({
      publication: p,
      score:
        p.citations + (hasValidFwci(p) ? (p.fwci as number) * 5 : 0),
    }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        b.publication.year - a.publication.year ||
        a.publication.title.localeCompare(b.publication.title),
    )
    .slice(0, Math.max(0, limit));

  const out: OpenScienceUpgradeOpportunity[] = [];
  for (const { publication } of scored) {
    const action = UPGRADE_ACTIONS[publication.openScienceStage];
    if (!action) continue;
    out.push({
      publicationId: publication.id,
      doi: publication.doi ?? null,
      title: publication.title,
      year: publication.year,
      citations: publication.citations,
      fwci: hasValidFwci(publication) ? (publication.fwci as number) : null,
      currentStage: publication.openScienceStage as OpenScienceStage,
      targetStage: action.targetStage,
      actionLabel: action.actionLabel,
      overrideKeySuggestion: suggestOverrideKey(publication.title, publication.year),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Open science stage counts
// ---------------------------------------------------------------------------

/** Count publications per open science stage bucket ('0' through '5'). */
export function computeStageCounts(publications: Publication[]): StageCounts {
  const counts: StageCounts = { '0': 0, '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };
  for (const publication of publications) {
    const key = String(publication.openScienceStage) as StageCountKey;
    if (Object.prototype.hasOwnProperty.call(counts, key)) {
      counts[key] += 1;
    }
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Time series projection
// ---------------------------------------------------------------------------

export interface BuildTimeSeriesOptions {
  /** First year to emit (defaults to the earliest publication year). */
  minYear?: number;
  /** Current year (defaults to the calendar year at call time). */
  currentYear?: number;
  /** Last year to emit (defaults to max(currentYear + 2, max planned year)). */
  maxFutureYear?: number;
}

/** Open access statuses that do not count as openly readable. */
const NON_OA_STATUSES: ReadonlySet<string> = new Set(['closed', 'unknown']);

/**
 * Build a yearly time series from historical publications and planned papers.
 * Planned papers contribute `plannedSubmissionsCount` in the year parsed from
 * `targetSubmissionQuarter` (for example '2026-Q4' counts in 2026) and
 * `plannedPublicationsCount` in their `targetPublicationYear`. The series runs
 * from the earliest publication year to max(currentYear + 2, max planned year).
 */
export function buildTimeSeries(
  publications: Publication[],
  plannedPapers: PlannedPaper[],
  options: BuildTimeSeriesOptions = {},
): TimeSeriesPoint[] {
  const currentYear = options.currentYear ?? new Date().getFullYear();
  const minYear =
    options.minYear ??
    (publications.length > 0 ? Math.min(...publications.map((p) => p.year)) : currentYear);
  const maxPlannedPublicationYear = plannedPapers.reduce(
    (max, paper) => Math.max(max, paper.targetPublicationYear),
    minYear,
  );
  const maxYear = Math.max(
    options.maxFutureYear ?? currentYear + 2,
    currentYear,
    maxPlannedPublicationYear,
  );

  const points: TimeSeriesPoint[] = [];
  for (let year = minYear; year <= maxYear; year += 1) {
    const publishedThisYear = publications.filter((p) => p.year === year);
    const articlesCount = publishedThisYear.filter((p) => p.type === 'article').length;
    const booksAndChaptersCount = publishedThisYear.filter(
      (p) => p.type === 'book' || p.type === 'book-chapter',
    ).length;
    const preprintsAndOtherCount = publishedThisYear.length - articlesCount - booksAndChaptersCount;
    const oaCount = publishedThisYear.filter((p) => {
      const status = p.openScience.oaStatus;
      return status !== undefined && status !== null && !NON_OA_STATUSES.has(status);
    }).length;
    const stage4PlusCount = publishedThisYear.filter((p) => p.openScienceStage >= 4).length;

    const citationsEarnedInYear = publications.reduce((sum, p) => {
      const inYear = (p.citationsByYear ?? []).filter((entry) => entry.year === year);
      return sum + inYear.reduce((s, entry) => s + entry.citedByCount, 0);
    }, 0);
    const citationsOfCohort = publishedThisYear.reduce((sum, p) => sum + p.citations, 0);

    const submissionsThisYear = plannedPapers.filter((paper) =>
      paper.targetSubmissionQuarter.startsWith(`${year}-Q`),
    );
    const publishedPlannedThisYear = plannedPapers.filter(
      (paper) => paper.targetPublicationYear === year,
    );
    const inFlightThisYear = plannedPapers.filter((paper) => {
      const submissionYear = Number.parseInt(paper.targetSubmissionQuarter.slice(0, 4), 10);
      return (
        Number.isFinite(submissionYear) &&
        submissionYear <= year &&
        year <= paper.targetPublicationYear
      );
    });

    points.push({
      year,
      publishedCount: publishedThisYear.length,
      articlesCount,
      booksAndChaptersCount,
      preprintsAndOtherCount,
      oaCount,
      stage4PlusCount,
      citationsEarnedInYear,
      citationsOfCohort,
      plannedSubmissionsCount: submissionsThisYear.length,
      plannedPublicationsCount: publishedPlannedThisYear.length,
      plannedPaperSlugs: inFlightThisYear.map((paper) => paper.slug),
      isFuture: year > currentYear,
    });
  }
  return points;
}

// ---------------------------------------------------------------------------
// Journal metric aggregation
// ---------------------------------------------------------------------------

/** Normalize a journal name or id into a stable slug identifier (treating '&' and 'and' identically). */
export function normalizeJournalId(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Merge two base journal partials that resolve to the same normalized id,
 * keeping every defined non-null field from either side. Empty arrays count
 * as "not set" so they never wipe curated scope tags. Aggregate counters and
 * `metricSource` already set on the existing entry are preserved unless the
 * incoming entry carries its own.
 */
function mergeJournalBaseEntries(
  existing: JournalMetric,
  incoming: Partial<JournalMetric>,
): JournalMetric {
  const merged: JournalMetric = { ...existing };
  const incomingRecord = incoming as Record<string, unknown>;
  for (const [key, value] of Object.entries(incomingRecord)) {
    if (key === 'metricSource' || key === 'id') continue;
    if (value === undefined || value === null) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    (merged as unknown as Record<string, unknown>)[key] = value;
  }
  merged.metricSource = incoming.metricSource ?? existing.metricSource;
  return merged;
}

function createJournalMetric(
  id: string,
  name: string,
  base: Partial<JournalMetric>,
  fallbackMetricSource: JournalMetric['metricSource'],
): JournalMetric {
  return {
    id,
    name,
    shortName: base.shortName ?? null,
    venueType: base.venueType ?? 'journal',
    issn: base.issn ?? [],
    publisher: base.publisher ?? null,
    openalexSourceId: base.openalexSourceId ?? null,
    twoYearMeanCitedness: base.twoYearMeanCitedness ?? null,
    journalHIndex: base.journalHIndex ?? null,
    journalI10Index: base.journalI10Index ?? null,
    jif: base.jif ?? null,
    jifYear: base.jifYear ?? null,
    citescore: base.citescore ?? null,
    sjrScore: base.sjrScore ?? null,
    sjrQuartile: base.sjrQuartile ?? null,
    isOa: base.isOa ?? false,
    isInDoaj: base.isInDoaj ?? false,
    oaModel: base.oaModel ?? 'unknown',
    apcUsd: base.apcUsd ?? null,
    reviewSpeedWeeks: base.reviewSpeedWeeks ?? null,
    scopeTags: base.scopeTags ?? [],
    homepageUrl: base.homepageUrl ?? null,
    authorPublishedCount: 0,
    authorCitationsTotal: 0,
    authorCitationsMean: 0,
    targetPaperCount: 0,
    metricSource: base.metricSource ?? fallbackMetricSource,
  };
}

/**
 * Aggregate per-journal statistics from published works and planned papers on
 * top of curated or OpenAlex base journal entries. Journal ids and names are
 * normalized to slugs; published venues without a base entry get a fallback
 * entry with `metricSource: 'openalex'`. Returns `authorPublishedCount`,
 * `authorCitationsTotal`, `authorCitationsMean`, and `targetPaperCount` for
 * every journal referenced by either source.
 */
export function aggregateJournalMetrics(
  publications: Publication[],
  plannedPapers: PlannedPaper[],
  baseJournals: Partial<JournalMetric>[] = [],
): JournalMetric[] {
  const entries = new Map<string, JournalMetric>();
  const byName = new Map<string, JournalMetric>();

  for (const base of baseJournals) {
    const rawId = base.id ?? base.name;
    if (!rawId) {
      continue;
    }
    const id = normalizeJournalId(rawId);
    const name = base.name ?? rawId;
    const existing = entries.get(id);
    if (existing) {
      // Merge defined non-null fields from both entries instead of letting
      // nulls from the later entry overwrite the earlier entry's metadata.
      const merged = mergeJournalBaseEntries(existing, { ...base, name });
      entries.set(id, merged);
      byName.set(normalizeJournalId(merged.name), merged);
    } else {
      const metric = createJournalMetric(id, name, base, 'hybrid');
      entries.set(id, metric);
      byName.set(normalizeJournalId(name), metric);
    }
  }

  const publishedTotals = new Map<string, { count: number; citations: number }>();
  for (const publication of publications) {
    const reference = publication.journalId ?? publication.venue;
    if (!reference) {
      continue;
    }
    const id = normalizeJournalId(reference);
    let entry = entries.get(id) ?? byName.get(id);
    if (!entry) {
      entry = createJournalMetric(id, reference, {}, 'openalex');
      entries.set(id, entry);
      byName.set(normalizeJournalId(entry.name), entry);
    }
    const totals = publishedTotals.get(entry.id) ?? { count: 0, citations: 0 };
    totals.count += 1;
    totals.citations += publication.citations;
    publishedTotals.set(entry.id, totals);
  }

  const targetCounts = new Map<string, number>();
  for (const paper of plannedPapers) {
    for (const candidate of paper.targetJournals) {
      const id = normalizeJournalId(candidate.journalId);
      let entry = entries.get(id) ?? byName.get(normalizeJournalId(candidate.journalName));
      if (!entry) {
        entry = createJournalMetric(id, candidate.journalName, {}, 'openalex');
        entries.set(id, entry);
        byName.set(normalizeJournalId(entry.name), entry);
      }
      targetCounts.set(entry.id, (targetCounts.get(entry.id) ?? 0) + 1);
    }
  }

  const result: JournalMetric[] = [];
  for (const entry of entries.values()) {
    const totals = publishedTotals.get(entry.id);
    const aggregated: JournalMetric = {
      ...entry,
      authorPublishedCount: totals?.count ?? 0,
      authorCitationsTotal: totals?.citations ?? 0,
      authorCitationsMean: totals && totals.count > 0 ? round2(totals.citations / totals.count) : 0,
      targetPaperCount: targetCounts.get(entry.id) ?? 0,
    };
    result.push(aggregated);
  }
  return result;
}
