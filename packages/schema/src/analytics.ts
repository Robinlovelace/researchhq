/**
 * Portfolio analytics: citation indices, open science stage counts, time
 * series projection, and journal metric aggregation.
 */
import type {
  JournalMetric,
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
      const merged = createJournalMetric(existing.id, existing.name, base, 'hybrid');
      // Keep already-set aggregate counters; curated fields may be refreshed.
      merged.authorPublishedCount = existing.authorPublishedCount;
      merged.authorCitationsTotal = existing.authorCitationsTotal;
      merged.authorCitationsMean = existing.authorCitationsMean;
      merged.targetPaperCount = existing.targetPaperCount;
      merged.metricSource = base.metricSource ?? existing.metricSource;
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
