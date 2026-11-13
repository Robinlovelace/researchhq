import { describe, expect, it } from 'vitest';

import {
  OPEN_SCIENCE_STAGE_DESCRIPTIONS,
  OPEN_SCIENCE_STAGE_LABELS,
  aggregateJournalMetrics,
  buildTimeSeries,
  computeHIndex,
  computeI10Index,
  computeStageCounts,
  normalizeJournalId,
  OpenScienceStageSchema,
  PortfolioSnapshotSchema,
  PublicationSchema,
  sanitizePortfolioForPublic,
  TargetJournalCandidateSchema,
  type PlannedPaper,
  type PortfolioSnapshot,
  type Publication,
} from '../src/index.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makePublication(overrides: Partial<Publication> = {}): Publication {
  return PublicationSchema.parse({
    id: 'w-1',
    title: 'Test publication',
    year: 2024,
    type: 'article',
    venue: 'Journal of Testing',
    authors: ['Robin Lovelace'],
    citations: 5,
    topics: ['transport'],
    openScienceStage: 3,
    openScience: { oaStatus: 'gold' },
    ...overrides,
  });
}

function makePlannedPaper(overrides: Partial<PlannedPaper> = {}): PlannedPaper {
  return {
    slug: 'test-paper',
    title: 'A planned paper',
    shortTitle: 'Planned',
    category: 'flagship-project',
    status: 'scoping',
    readinessPercent: 40,
    targetSubmissionQuarter: '2026-Q4',
    targetPublicationYear: 2027,
    targetOpenScienceStage: 5,
    currentOpenScienceStage: 2,
    summary: 'Summary text.',
    methodologyHighlights: ['Method A'],
    keyCitations: ['@key2024'],
    collaborators: ['A. Collaborator'],
    repoUrls: [{ label: 'Code', url: 'https://github.com/x/y', visibility: 'public' }],
    nextMilestones: ['Finish analysis'],
    targetJournals: [
      {
        journalId: 'jtg',
        journalName: 'Journal of Transport Geography',
        rank: 1,
        fitScore: 90,
        fitRationale: 'Strong scope fit.',
      },
    ],
    privateNotes: 'Internal only',
    ...overrides,
  } as PlannedPaper;
}

function makeSnapshot(): PortfolioSnapshot {
  return {
    schemaVersion: '1.0.0',
    generatedAt: '2026-11-13T00:00:00Z',
    sanitized: false,
    author: {
      name: 'Robin Lovelace',
      role: 'Professor of Transport Data Science',
      affiliation: 'University of Leeds',
      orcid: '0000-0001-5679-6536',
      metrics: {
        worksCount: 2,
        peerReviewedCount: 2,
        citedByCount: 12,
        hIndex: 2,
        i10Index: 1,
        oaPercentage: 100,
        stageCounts: { '0': 0, '1': 1, '2': 0, '3': 1, '4': 0, '5': 0 },
        updatedAt: '2026-11-13T00:00:00Z',
      },
    },
    publications: [
      makePublication({ id: 'w-1', year: 2024, citations: 10, openScienceStage: 1 }),
      makePublication({
        id: 'w-2',
        year: 2025,
        citations: 2,
        type: 'book-chapter',
        venue: 'Transport Handbook',
        openScienceStage: 4,
        openScience: { oaStatus: 'green' },
      }),
    ],
    journals: [],
    plannedPapers: [
      makePlannedPaper({
        slug: 'bicischools',
        repoUrls: [
          { label: 'Paper repo', url: 'https://github.com/x/paper', visibility: 'public' },
          {
            label: 'Private data',
            url: 'https://github.com/x/private-data',
            visibility: 'private',
            redactUrlInPublic: true,
          },
        ],
      }),
      makePlannedPaper({
        slug: 'railactive',
        targetSubmissionQuarter: '2027-Q2',
        targetPublicationYear: 2028,
      }),
    ],
    timeSeries: [],
  };
}

// ---------------------------------------------------------------------------
// Schema validation
// ---------------------------------------------------------------------------

describe('OpenScienceStageSchema', () => {
  it('accepts integers 0 through 5', () => {
    for (const value of [0, 1, 2, 3, 4, 5]) {
      expect(OpenScienceStageSchema.parse(value)).toBe(value);
    }
  });

  it('rejects out-of-range and non-integer values', () => {
    expect(() => OpenScienceStageSchema.parse(-1)).toThrow();
    expect(() => OpenScienceStageSchema.parse(6)).toThrow();
    expect(() => OpenScienceStageSchema.parse(1.5)).toThrow();
    expect(() => OpenScienceStageSchema.parse('3')).toThrow();
  });

  it('exposes labels and descriptions for every stage', () => {
    for (const stage of [0, 1, 2, 3, 4, 5] as const) {
      expect(OPEN_SCIENCE_STAGE_LABELS[stage].length).toBeGreaterThan(0);
      expect(OPEN_SCIENCE_STAGE_DESCRIPTIONS[stage].length).toBeGreaterThan(0);
    }
  });
});

describe('schema validation', () => {
  it('parses a valid portfolio snapshot', () => {
    const snapshot = makeSnapshot();
    const parsed = PortfolioSnapshotSchema.safeParse(snapshot);
    expect(parsed.success).toBe(true);
  });

  it('rejects invalid readinessPercent', () => {
    const snapshot = makeSnapshot();
    snapshot.plannedPapers[0]!.readinessPercent = 101;
    expect(PortfolioSnapshotSchema.safeParse(snapshot).success).toBe(false);
  });

  it('rejects invalid metricSource', () => {
    const snapshot = makeSnapshot();
    snapshot.journals = [
      {
        id: 'jtg',
        name: 'Journal of Transport Geography',
        scopeTags: ['transport'],
        authorPublishedCount: 0,
        authorCitationsTotal: 0,
        authorCitationsMean: 0,
        targetPaperCount: 0,
        metricSource: 'made-up',
      } as never,
    ];
    expect(PortfolioSnapshotSchema.safeParse(snapshot).success).toBe(false);
  });

  it('rejects invalid target journal rank and fitScore', () => {
    expect(() =>
      TargetJournalCandidateSchema.parse({
        journalId: 'j',
        journalName: 'J',
        rank: 0,
        fitScore: 50,
        fitRationale: 'r',
      }),
    ).toThrow();
    expect(() =>
      TargetJournalCandidateSchema.parse({
        journalId: 'j',
        journalName: 'J',
        rank: 1,
        fitScore: 101,
        fitRationale: 'r',
      }),
    ).toThrow();
  });

  it('rejects wrong schemaVersion literal', () => {
    const snapshot = makeSnapshot();
    (snapshot as { schemaVersion: string }).schemaVersion = '2.0.0';
    expect(PortfolioSnapshotSchema.safeParse(snapshot).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Citation indices and stage counts
// ---------------------------------------------------------------------------

describe('computeHIndex', () => {
  it('returns 0 for empty input', () => {
    expect(computeHIndex([])).toBe(0);
  });

  it('computes the standard h-index', () => {
    expect(computeHIndex([10, 8, 5, 4, 3])).toBe(4);
    expect(computeHIndex([3, 0, 6, 1, 5])).toBe(3);
    expect(computeHIndex([100])).toBe(1);
  });

  it('does not mutate the input array', () => {
    const citations = [1, 5, 3];
    computeHIndex(citations);
    expect(citations).toEqual([1, 5, 3]);
  });
});

describe('computeI10Index', () => {
  it('counts publications with at least 10 citations', () => {
    expect(computeI10Index([10, 9, 25, 0])).toBe(2);
    expect(computeI10Index([])).toBe(0);
    expect(computeI10Index([5, 3])).toBe(0);
  });
});

describe('computeStageCounts', () => {
  it('counts publications per stage', () => {
    const counts = computeStageCounts([
      makePublication({ openScienceStage: 0 }),
      makePublication({ openScienceStage: 1 }),
      makePublication({ openScienceStage: 1 }),
      makePublication({ openScienceStage: 5 }),
    ]);
    expect(counts).toEqual({ '0': 1, '1': 2, '2': 0, '3': 0, '4': 0, '5': 1 });
  });

  it('returns all zeros for an empty list', () => {
    expect(computeStageCounts([])).toEqual({ '0': 0, '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 });
  });
});

// ---------------------------------------------------------------------------
// Time series
// ---------------------------------------------------------------------------

describe('buildTimeSeries', () => {
  it('covers historical years plus the planned 2026 to 2028 window', () => {
    const publications = [
      makePublication({ id: 'w-1', year: 2024, citations: 10, openScienceStage: 1 }),
      makePublication({ id: 'w-2', year: 2025, citations: 4, openScienceStage: 5 }),
    ];
    const plannedPapers = [
      makePlannedPaper({
        slug: 'bicischools',
        targetSubmissionQuarter: '2026-Q4',
        targetPublicationYear: 2027,
      }),
      makePlannedPaper({
        slug: 'railactive',
        targetSubmissionQuarter: '2027-Q2',
        targetPublicationYear: 2028,
      }),
    ];

    const series = buildTimeSeries(publications, plannedPapers, { currentYear: 2026 });
    expect(series.map((p) => p.year)).toEqual([2024, 2025, 2026, 2027, 2028]);

    const y2024 = series[0]!;
    expect(y2024.publishedCount).toBe(1);
    expect(y2024.articlesCount).toBe(1);
    expect(y2024.booksAndChaptersCount).toBe(0);
    expect(y2024.preprintsAndOtherCount).toBe(0);
    expect(y2024.oaCount).toBe(1);
    expect(y2024.stage4PlusCount).toBe(0);
    expect(y2024.citationsOfCohort).toBe(10);
    expect(y2024.isFuture).toBe(false);

    const y2025 = series[1]!;
    expect(y2025.stage4PlusCount).toBe(1);
    expect(y2025.citationsOfCohort).toBe(4);

    const y2026 = series[2]!;
    expect(y2026.plannedSubmissionsCount).toBe(1);
    expect(y2026.plannedPublicationsCount).toBe(0);
    expect(y2026.isFuture).toBe(false);

    const y2027 = series[3]!;
    expect(y2027.plannedSubmissionsCount).toBe(1);
    expect(y2027.plannedPublicationsCount).toBe(1);
    expect(y2027.isFuture).toBe(true);

    const y2028 = series[4]!;
    expect(y2028.plannedPublicationsCount).toBe(1);
    expect(y2028.isFuture).toBe(true);
  });

  it('collects in-flight planned paper slugs across submission and publication years', () => {
    const plannedPapers = [
      makePlannedPaper({
        slug: 'bicischools',
        targetSubmissionQuarter: '2026-Q4',
        targetPublicationYear: 2027,
      }),
    ];
    const series = buildTimeSeries([], plannedPapers, { currentYear: 2026, minYear: 2026 });
    const byYear = new Map(series.map((p) => [p.year, p]));
    expect(byYear.get(2026)!.plannedPaperSlugs).toEqual(['bicischools']);
    expect(byYear.get(2027)!.plannedPaperSlugs).toEqual(['bicischools']);
    expect(byYear.get(2028)!.plannedPaperSlugs).toEqual([]);
  });

  it('counts citations earned in a specific year from citationsByYear', () => {
    const publications = [
      makePublication({
        citationsByYear: [
          { year: 2024, citedByCount: 3 },
          { year: 2025, citedByCount: 7 },
        ],
      }),
      makePublication({ citationsByYear: [{ year: 2024, citedByCount: 2 }] }),
    ];
    const series = buildTimeSeries(publications, [], { minYear: 2024, currentYear: 2025 });
    const byYear = new Map(series.map((p) => [p.year, p]));
    expect(byYear.get(2024)!.citationsEarnedInYear).toBe(5);
    expect(byYear.get(2025)!.citationsEarnedInYear).toBe(7);
  });

  it('counts book chapters as booksAndChapters and other types as preprintsAndOther', () => {
    const publications = [
      makePublication({ type: 'book-chapter', venue: null }),
      makePublication({ type: 'preprint' }),
      makePublication({ type: 'article' }),
    ];
    const series = buildTimeSeries(publications, [], { minYear: 2024, currentYear: 2024 });
    const point = series[0]!;
    expect(point.articlesCount).toBe(1);
    expect(point.booksAndChaptersCount).toBe(1);
    expect(point.preprintsAndOtherCount).toBe(1);
  });

  it('extends to max(currentYear + 2, max targetPublicationYear) and respects overrides', () => {
    const plannedPapers = [makePlannedPaper({ targetPublicationYear: 2030 })];
    const series = buildTimeSeries([], plannedPapers, { currentYear: 2026 });
    expect(series.at(-1)!.year).toBe(2030);

    const overridden = buildTimeSeries([], [], { currentYear: 2026, maxFutureYear: 2027 });
    expect(overridden.map((p) => p.year)).toEqual([2026, 2027]);
  });
});

// ---------------------------------------------------------------------------
// Journal metric aggregation
// ---------------------------------------------------------------------------

describe('aggregateJournalMetrics', () => {
  it('normalizes ids and computes author and target counts', () => {
    const publications = [
      makePublication({ venue: 'Journal of Transport Geography', citations: 10 }),
      makePublication({ venue: 'Journal of Transport Geography', citations: 6 }),
      makePublication({ venue: 'Unknown Venue', citations: 3 }),
    ];
    const plannedPapers = [
      makePlannedPaper(),
      makePlannedPaper({ slug: 'other', targetJournals: [
        {
          journalId: 'jtg',
          journalName: 'Journal of Transport Geography',
          rank: 2,
          fitScore: 70,
          fitRationale: 'Backup.',
        },
      ] }),
    ];
    const baseJournals = [
      {
        id: 'jtg',
        name: 'Journal of Transport Geography',
        jif: 7.1,
        scopeTags: ['transport', 'geography'],
      },
    ];

    const metrics = aggregateJournalMetrics(publications, plannedPapers, baseJournals);
    const byId = new Map(metrics.map((j) => [j.id, j]));

    // The curated base id 'jtg' is preserved; venue-name matches merge into it.
    const jtg = byId.get('jtg')!;
    expect(jtg).toBeDefined();
    expect(jtg.name).toBe('Journal of Transport Geography');
    expect(jtg.jif).toBe(7.1);
    expect(jtg.authorPublishedCount).toBe(2);
    expect(jtg.authorCitationsTotal).toBe(16);
    expect(jtg.authorCitationsMean).toBe(8);
    expect(jtg.targetPaperCount).toBe(2);
    expect(jtg.metricSource).toBe('hybrid');

    const fallback = byId.get('unknown-venue')!;
    expect(fallback).toBeDefined();
    expect(fallback.name).toBe('Unknown Venue');
    expect(fallback.authorPublishedCount).toBe(1);
    expect(fallback.authorCitationsMean).toBe(3);
    expect(fallback.targetPaperCount).toBe(0);
    expect(fallback.metricSource).toBe('openalex');
  });

  it('matches publications by journalId when venue differs', () => {
    const publications = [makePublication({ journalId: 'aap', venue: null, citations: 4 })];
    const metrics = aggregateJournalMetrics(publications, [], [
      { id: 'aap', name: 'Accident Analysis and Prevention' },
    ]);
    expect(metrics).toHaveLength(1);
    expect(metrics[0]!.id).toBe('aap');
    expect(metrics[0]!.authorPublishedCount).toBe(1);
  });

  it('creates fallback entries for target journals never published in', () => {
    const plannedPapers = [makePlannedPaper()];
    const metrics = aggregateJournalMetrics([], plannedPapers, []);
    expect(metrics).toHaveLength(1);
    expect(metrics[0]!.targetPaperCount).toBe(1);
    expect(metrics[0]!.authorPublishedCount).toBe(0);
  });
});

describe('normalizeJournalId', () => {
  it('slugifies punctuation, case, and treats ampersands identically to "and"', () => {
    expect(normalizeJournalId('Journal of Transport & Health!')).toBe(
      'journal-of-transport-and-health',
    );
    expect(normalizeJournalId('Journal of Transport and Health')).toBe(
      'journal-of-transport-and-health',
    );
    expect(normalizeJournalId('  Accident Analysis & Prevention  ')).toBe(
      'accident-analysis-and-prevention',
    );
  });
});

// ---------------------------------------------------------------------------
// Public sanitization
// ---------------------------------------------------------------------------

describe('sanitizePortfolioForPublic', () => {
  it('removes privateNotes from every planned paper and marks sanitized', () => {
    const result = sanitizePortfolioForPublic(makeSnapshot());
    expect(result.sanitized).toBe(true);
    for (const paper of result.plannedPapers) {
      expect(paper.privateNotes).toBeUndefined();
      expect(Object.prototype.hasOwnProperty.call(paper, 'privateNotes')).toBe(false);
    }
  });

  it('redacts repo urls flagged redactUrlInPublic while preserving label and visibility', () => {
    const result = sanitizePortfolioForPublic(makeSnapshot());
    const bicischools = result.plannedPapers.find((p) => p.slug === 'bicischools')!;
    const links = Object.fromEntries(bicischools.repoUrls.map((l) => [l.label, l]));
    expect(links['Private data']!.url).toBe('');
    expect(links['Private data']!.visibility).toBe('private');
    expect(links['Paper repo']!.url).toBe('https://github.com/x/paper');
    expect(links['Paper repo']!.visibility).toBe('public');
  });

  it('deep clones so the input snapshot is not mutated', () => {
    const snapshot = makeSnapshot();
    const result = sanitizePortfolioForPublic(snapshot);
    expect(result).not.toBe(snapshot);
    expect(result.publications).not.toBe(snapshot.publications);
    expect(snapshot.sanitized).toBe(false);
    expect(snapshot.plannedPapers[0]!.privateNotes).toBe('Internal only');
    expect(
      snapshot.plannedPapers[0]!.repoUrls.find((l) => l.label === 'Private data')!.url,
    ).toBe('https://github.com/x/private-data');
  });

  it('leaks no privateNotes string anywhere in the JSON output', () => {
    const result = sanitizePortfolioForPublic(makeSnapshot());
    const json = JSON.stringify(result);
    expect(json).not.toContain('Internal only');
    expect(json).not.toContain('https://github.com/x/private-data');
  });
});
