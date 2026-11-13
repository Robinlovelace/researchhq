import { describe, expect, it } from 'vitest';

import {
  PlannedPaperSchema,
  PortfolioSnapshotSchema,
  aggregateJournalMetrics,
  PublicationSchema,
  sanitizePortfolioForPublic,
  type PlannedPaper,
  type PortfolioSnapshot,
  type Publication,
} from '../src/index.js';

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
      symplecticId: '00983319',
      metrics: {
        worksCount: 2,
        peerReviewedCount: 2,
        citedByCount: 12,
        hIndex: 2,
        i10Index: 1,
        i10IndexScholar: 4,
        oaPercentage: 100,
        stageCounts: { '0': 0, '1': 1, '2': 0, '3': 1, '4': 0, '5': 0 },
        updatedAt: '2026-11-13T00:00:00Z',
      },
    },
    publications: [makePublication()],
    journals: [],
    plannedPapers: [makePlannedPaper()],
    timeSeries: [],
  };
}

describe('PlannedPaperSchema hardening', () => {
  it('accepts a valid YYYY-QN targetSubmissionQuarter', () => {
    const paper = makePlannedPaper({ targetSubmissionQuarter: '2027-Q2' });
    expect(PlannedPaperSchema.safeParse(paper).success).toBe(true);
  });

  it('rejects malformed targetSubmissionQuarter values', () => {
    for (const bad of ['2027-Q5', '2027q2', '27-Q2', '2027-2', 'Q1-2027']) {
      const paper = makePlannedPaper({ targetSubmissionQuarter: bad });
      expect(PlannedPaperSchema.safeParse(paper).success).toBe(false);
    }
  });

  it('rejects a submission year after the target publication year', () => {
    const paper = makePlannedPaper({
      targetSubmissionQuarter: '2030-Q1',
      targetPublicationYear: 2027,
    });
    expect(PlannedPaperSchema.safeParse(paper).success).toBe(false);
  });

  it('accepts a submission year within the target publication year', () => {
    const paper = makePlannedPaper({
      targetSubmissionQuarter: '2027-Q4',
      targetPublicationYear: 2027,
    });
    expect(PlannedPaperSchema.safeParse(paper).success).toBe(true);
  });

  it('rejects duplicate targetJournal journalIds', () => {
    const paper = makePlannedPaper({
      targetJournals: [
        {
          journalId: 'jtg',
          journalName: 'Journal of Transport Geography',
          rank: 1,
          fitScore: 90,
          fitRationale: 'a',
        },
        {
          journalId: 'jtg',
          journalName: 'Journal of Transport Geography',
          rank: 2,
          fitScore: 80,
          fitRationale: 'b',
        },
      ],
    });
    expect(PlannedPaperSchema.safeParse(paper).success).toBe(false);
  });

  it('rejects duplicate targetJournal ranks', () => {
    const paper = makePlannedPaper({
      targetJournals: [
        {
          journalId: 'jtg',
          journalName: 'Journal of Transport Geography',
          rank: 1,
          fitScore: 90,
          fitRationale: 'a',
        },
        {
          journalId: 'aap',
          journalName: 'Accident Analysis and Prevention',
          rank: 1,
          fitScore: 80,
          fitRationale: 'b',
        },
      ],
    });
    expect(PlannedPaperSchema.safeParse(paper).success).toBe(false);
  });
});

describe('sanitizePortfolioForPublic hardening', () => {
  it('redacts repo links flagged private even without redactUrlInPublic', () => {
    const snapshot = makeSnapshot();
    snapshot.plannedPapers[0]!.repoUrls = [
      { label: 'Unflagged private', url: 'https://github.com/x/secret', visibility: 'private' },
    ];
    const result = sanitizePortfolioForPublic(snapshot);
    const link = result.plannedPapers[0]!.repoUrls[0]!;
    expect(link.url).toBe('');
    expect(link.visibility).toBe('private');
  });

  it('redacts links flagged redactUrlInPublic and strips the flag from every exported link', () => {
    const snapshot = makeSnapshot();
    snapshot.plannedPapers[0]!.repoUrls = [
      {
        label: 'Flagged public',
        url: 'https://github.com/x/thing',
        visibility: 'public',
        redactUrlInPublic: true,
      },
      { label: 'Normal public', url: 'https://github.com/x/ok', visibility: 'public' },
    ];
    const result = sanitizePortfolioForPublic(snapshot);
    const links = result.plannedPapers[0]!.repoUrls;
    expect(links.find((l) => l.label === 'Flagged public')!.url).toBe('');
    expect(links.find((l) => l.label === 'Flagged public')!.visibility).toBe('private');
    for (const link of links) {
      expect(Object.prototype.hasOwnProperty.call(link, 'redactUrlInPublic')).toBe(false);
    }
  });

  it('strips author.symplecticId from the public export', () => {
    const result = sanitizePortfolioForPublic(makeSnapshot());
    expect(Object.prototype.hasOwnProperty.call(result.author, 'symplecticId')).toBe(false);
    expect(JSON.stringify(result)).not.toContain('00983319');
  });

  it('keeps private snapshot author symplecticId untouched (deep clone)', () => {
    const snapshot = makeSnapshot();
    sanitizePortfolioForPublic(snapshot);
    expect(snapshot.author.symplecticId).toBe('00983319');
  });

  it('strips collaborators and undefined-visibility repo URLs by default, and filters TBC when opted in', () => {
    const snapshot = makeSnapshot();
    snapshot.plannedPapers[0]!.collaborators = [
      'Robin Lovelace (University of Leeds)',
      'External Author (TBC)',
    ];
    snapshot.plannedPapers[0]!.repoUrls.push({
      label: 'Unspecified visibility repo',
      url: 'https://github.com/example/unspecified',
    });
    const byDefault = sanitizePortfolioForPublic(snapshot);
    expect(byDefault.author.metrics.i10IndexScholar).toBe(4);
    expect(byDefault.plannedPapers[0]!.collaborators).toEqual([]);
    const unspecifiedLink = byDefault.plannedPapers[0]!.repoUrls.find(
      (l) => l.label === 'Unspecified visibility repo',
    );
    expect(unspecifiedLink?.url).toBe('');
    expect(unspecifiedLink?.visibility).toBe('private');

    const optedIn = sanitizePortfolioForPublic(snapshot, { includeCollaborators: true });
    expect(optedIn.plannedPapers[0]!.collaborators).toEqual([
      'Robin Lovelace (University of Leeds)',
    ]);
  });

  it('rejects non-http(s) URLs in PublicationSchema and RepoLinkSchema', () => {
    expect(
      PublicationSchema.safeParse({
        id: 'bad-url',
        title: 'Bad URL',
        year: 2024,
        type: 'article',
        authors: ['A'],
        citations: 0,
        topics: [],
        openScienceStage: 0,
        openScience: { oaStatus: 'closed' },
        url: 'javascript:alert(1)',
      }).success,
    ).toBe(false);
    expect(
      PlannedPaperSchema.safeParse(
        makePlannedPaper({
          repoUrls: [{ label: 'Bad', url: 'ftp://example.com/repo', visibility: 'public' }],
        }),
      ).success,
    ).toBe(false);
  });
});

describe('aggregateJournalMetrics duplicate base merging', () => {
  it('merges defined non-null fields from duplicate base entries instead of overwriting with nulls', () => {
    const publications = [makePublication({ venue: 'Journal of Transport Geography' })];
    const baseJournals = [
      {
        id: 'jtg',
        name: 'Journal of Transport Geography',
        publisher: 'Elsevier',
        shortName: 'JTG',
      },
      {
        id: 'jtg',
        name: 'Journal of Transport Geography',
        jif: 7.1,
        scopeTags: ['transport', 'geography'],
      },
    ];
    const metrics = aggregateJournalMetrics(publications, [], baseJournals);
    expect(metrics).toHaveLength(1);
    const jtg = metrics[0]!;
    expect(jtg.publisher).toBe('Elsevier');
    expect(jtg.shortName).toBe('JTG');
    expect(jtg.jif).toBe(7.1);
    expect(jtg.scopeTags).toEqual(['transport', 'geography']);
    expect(jtg.authorPublishedCount).toBe(1);
  });
});

describe('PortfolioSnapshotSchema with i10IndexScholar', () => {
  it('accepts nullish and numeric i10IndexScholar', () => {
    const withValue = makeSnapshot();
    expect(PortfolioSnapshotSchema.safeParse(withValue).success).toBe(true);
    const withoutValue = makeSnapshot();
    delete withoutValue.author.metrics.i10IndexScholar;
    expect(PortfolioSnapshotSchema.safeParse(withoutValue).success).toBe(true);
  });
});
