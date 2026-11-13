/**
 * Vitest tests for Round 1 review fixes: CRAN R-package reclassification and
 * version dedupe, solo/unmatched authorPosition, 0009- ORCID parsing, strict
 * canonical journal matching, opt-in bws secret lookup, override stage
 * lowering with match-count warnings, curated-over-OpenAlex metric
 * precedence, placeholder ORCID rejection, scholarSummary.i10Index wiring,
 * and hardened validateInstance.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

import {
  dedupeKey,
  firstAuthorSurname,
  initInstance,
  matchesCanonicalJournal,
  parseOrcid,
  resolveOpenAlexApiKey,
  syncPortfolio,
  validateInstance,
  type OfflineBundle,
  type RawOpenAlexSource,
  type RawOpenAlexWork,
} from '../src/index.js';

const TEST_ROOT = join(tmpdir(), `researchhq-sync-hardening-test-${process.pid}`);

function sourceFixture(
  overrides: Partial<RawOpenAlexSource> & { id: string; display_name: string },
): RawOpenAlexSource {
  return {
    issn: null,
    type: 'journal',
    is_oa: false,
    is_in_doaj: false,
    apc_usd: null,
    works_count: 0,
    cited_by_count: 0,
    summary_stats: {},
    ...overrides,
  };
}

const JOURNAL_SOURCE = sourceFixture({
  id: 'https://openalex.org/S183347913',
  display_name: 'Journal of Transport & Health',
  type: 'journal',
  issn: ['0966-6923'],
  summary_stats: { '2yr_mean_citedness': 4.2, h_index: 60, i10_index: 300 },
});

const CRAN_SOURCE = sourceFixture({
  id: 'https://openalex.org/S4306400001',
  display_name: 'Comprehensive R Archive Network (CRAN)',
  type: 'repository',
});

/** Referenced only as a secondary location: an orphan repository venue. */
const ZENODO_SOURCE = sourceFixture({
  id: 'https://openalex.org/S4397000001',
  display_name: 'Zenodo',
  type: 'repository',
});

const MOCK_AUTHOR = {
  id: 'https://openalex.org/A9999999999',
  display_name: 'Robin Lovelace',
  works_count: 3,
  cited_by_count: 100,
  summary_stats: { '2yr_mean_citedness': 1.9, h_index: 5, i10_index: 4 },
};

function workFixture(
  overrides: Partial<RawOpenAlexWork> & { id: string; display_name: string },
): RawOpenAlexWork {
  return {
    doi: null,
    publication_year: 2024,
    publication_date: '2024-01-01',
    type: 'article',
    cited_by_count: 5,
    counts_by_year: [{ year: 2024, cited_by_count: 5 }],
    open_access: { is_oa: true, oa_status: 'gold', oa_url: 'https://example.org/paper.pdf' },
    primary_location: { source: JOURNAL_SOURCE, landing_page_url: 'https://example.org/paper' },
    locations: [{ source: JOURNAL_SOURCE, landing_page_url: 'https://example.org/paper' }],
    authorships: [
      {
        author_position: 'first',
        author: { id: 'https://openalex.org/A9999999999', display_name: 'Robin Lovelace' },
      },
      { author_position: 'last', author: { id: 'https://openalex.org/A2', display_name: 'Co Author' } },
    ],
    topics: [],
    abstract_inverted_index: null,
    ...overrides,
  };
}

function buildBundle(): OfflineBundle {
  return {
    author: MOCK_AUTHOR,
    works: [
      workFixture({
        id: 'https://openalex.org/W1000000001',
        display_name: 'Cycling to health: evidence from Leeds',
        locations: [
          { source: JOURNAL_SOURCE, landing_page_url: 'https://example.org/paper' },
          // Secondary repository location: fetched but never published in.
          { source: ZENODO_SOURCE, landing_page_url: 'https://zenodo.example.org/record/1' },
        ],
      }),
      // Single authorship: authorPosition must be 'solo'.
      workFixture({
        id: 'https://openalex.org/W1000000002',
        display_name: 'A solo authored note',
        authorships: [
          {
            author_position: 'first',
            author: { id: 'https://openalex.org/A9999999999', display_name: 'Robin Lovelace' },
          },
        ],
      }),
      // The configured author is absent from a multi-author work: null.
      workFixture({
        id: 'https://openalex.org/W1000000003',
        display_name: 'Someone elses multi-author work',
        authorships: [
          { author_position: 'first', author: { id: 'https://openalex.org/A2', display_name: 'Co Author' } },
          { author_position: 'last', author: { id: 'https://openalex.org/A3', display_name: 'Third Author' } },
        ],
      }),
      // CRAN release records: reclassified as software and deduped to one.
      workFixture({
        id: 'https://openalex.org/W1000000004',
        display_name: 'pct [R package pct version 0.9.3]',
        type: 'article',
        cited_by_count: 8,
        primary_location: {
          source: CRAN_SOURCE,
          landing_page_url: 'https://cran.r-project.org/web/packages/pct/index.html',
        },
        locations: [
          {
            source: CRAN_SOURCE,
            landing_page_url: 'https://cran.r-project.org/web/packages/pct/index.html',
          },
        ],
      }),
      workFixture({
        id: 'https://openalex.org/W1000000005',
        display_name: 'pct [R package pct version 0.10.0]',
        type: 'article',
        cited_by_count: 11,
        primary_location: {
          source: CRAN_SOURCE,
          landing_page_url: 'https://cran.r-project.org/web/packages/pct/index.html',
        },
        locations: [
          {
            source: CRAN_SOURCE,
            landing_page_url: 'https://cran.r-project.org/web/packages/pct/index.html',
          },
        ],
      }),
    ],
    sources: {
      S183347913: JOURNAL_SOURCE,
      S4306400001: CRAN_SOURCE,
      S4397000001: ZENODO_SOURCE,
    },
    journals: {},
  };
}

let instanceDir: string;

beforeEach(() => {
  instanceDir = join(TEST_ROOT, 'hardening-instance');
  // Reuse across tests is fine: each test rebuilds inputs it depends on.
  try {
    initInstance(instanceDir, { name: 'Robin Lovelace', orcid: '0000-0001-5679-6536', force: true });
  } catch {
    initInstance(instanceDir, { name: 'Robin Lovelace', orcid: '0000-0001-5679-6536' });
  }
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('parseOrcid', () => {
  it('accepts 0000- and 0009- ORCIDs, X checksums, and prefixes', () => {
    expect(parseOrcid('0009-0001-1234-5678')).toBe('0009-0001-1234-5678');
    expect(parseOrcid('0000-0002-1825-0097')).toBe('0000-0002-1825-0097');
    expect(parseOrcid('0000-0002-1694-233X')).toBe('0000-0002-1694-233X');
    expect(parseOrcid('https://orcid.org/0009-0001-1234-5678')).toBe('0009-0001-1234-5678');
    expect(parseOrcid('orcid:0000-0001-5679-6536')).toBe('0000-0001-5679-6536');
  });

  it('rejects non-ORCID values', () => {
    expect(parseOrcid('not-an-orcid')).toBeNull();
    expect(parseOrcid('0000-0000-0000-00')).toBeNull();
    expect(parseOrcid('')).toBeNull();
    expect(parseOrcid(null)).toBeNull();
  });
});

describe('matchesCanonicalJournal (no unrelated fallback)', () => {
  it('accepts exact normalized title matches including leading-the variants', () => {
    const the = sourceFixture({ id: 'S1', display_name: 'The R Journal', issn: ['1234-5678'] });
    expect(matchesCanonicalJournal('R Journal', undefined, the)).toBe(true);
    expect(matchesCanonicalJournal('The R Journal', undefined, the)).toBe(true);
    expect(matchesCanonicalJournal('Journal of Transport & Health', undefined, JOURNAL_SOURCE)).toBe(true);
    expect(matchesCanonicalJournal('Journal of Transport and Health', undefined, JOURNAL_SOURCE)).toBe(true);
  });

  it('accepts ISSN matches and rejects unrelated sources', () => {
    expect(matchesCanonicalJournal('Anything Else', '0966-6923', JOURNAL_SOURCE)).toBe(true);
    const unrelated = sourceFixture({ id: 'S2', display_name: 'Nature', issn: ['9999-9999'] });
    expect(matchesCanonicalJournal('Journal of Transport and Health', undefined, unrelated)).toBe(false);
    expect(matchesCanonicalJournal('Nature', '9999-9999', JOURNAL_SOURCE)).toBe(false);
  });
});

describe('resolveOpenAlexApiKey bws gating', () => {
  const savedApiKey = process.env.OPENALEX_API_KEY;
  const savedProvider = process.env.RESEARCHHQ_SECRET_PROVIDER;

  afterEach(() => {
    if (savedApiKey === undefined) delete process.env.OPENALEX_API_KEY;
    else process.env.OPENALEX_API_KEY = savedApiKey;
    if (savedProvider === undefined) delete process.env.RESEARCHHQ_SECRET_PROVIDER;
    else process.env.RESEARCHHQ_SECRET_PROVIDER = savedProvider;
  });

  it('never touches the secret provider unless RESEARCHHQ_SECRET_PROVIDER=bws', () => {
    delete process.env.OPENALEX_API_KEY;
    delete process.env.RESEARCHHQ_SECRET_PROVIDER;
    expect(resolveOpenAlexApiKey()).toBeUndefined();
  });

  it('explicit arguments win over the environment', () => {
    process.env.OPENALEX_API_KEY = 'env-key';
    expect(resolveOpenAlexApiKey('explicit-key')).toBe('explicit-key');
  });
});

describe('CRAN R package handling', () => {
  it('dedupeKey strips [R package ...] version suffixes and appends the surname', () => {
    const a = { title: 'pct [R package pct version 0.9.3]', authors: ['Robin Lovelace'] };
    const b = { title: 'pct', authors: ['Lovelace, Robin'] };
    const keyA = dedupeKey(a as never);
    const keyB = dedupeKey(b as never);
    expect(keyA).toBe('pct::lovelace');
    expect(keyB).toBe('pct::lovelace');
    expect(firstAuthorSurname({ authors: ['Robin Lovelace'] } as never)).toBe('lovelace');
  });

  it('reclassifies CRAN records as software and keeps a single version record', async () => {
    const result = await syncPortfolio(instanceDir, {
      offlineBundle: buildBundle(),
      log: () => {},
    });
    const pctRecords = result.publications.filter((p) => p.title.startsWith('pct'));
    expect(pctRecords).toHaveLength(1);
    expect(pctRecords[0]!.type).toBe('software');
    // Highest-citation version record wins.
    expect(pctRecords[0]!.citations).toBe(11);
    // The CRAN repository venue keeps its entry because the author published
    // (software) there: authorPublishedCount 1.
    const cran = result.journals.find((j) => j.name.includes('Comprehensive R Archive Network'))!;
    expect(cran.venueType).toBe('repository');
    expect(cran.authorPublishedCount).toBe(1);
    // An orphan repository venue with zero publications is dropped entirely.
    expect(result.journals.find((j) => j.name === 'Zenodo')).toBeUndefined();
    // Peer-reviewed = journal articles in journal venues: the CRAN software
    // record is excluded even though OpenAlex typed it 'article'.
    expect(result.snapshot.author.metrics.peerReviewedCount).toBe(
      result.publications.filter(
        (p) => p.type === 'article' && p.journalId !== null && p.journalId !== cran.id,
      ).length,
    );
  });
});

describe('authorPosition', () => {
  it('marks single-authorship works as solo and unmatched works as null', async () => {
    const result = await syncPortfolio(instanceDir, {
      offlineBundle: buildBundle(),
      log: () => {},
    });
    const solo = result.publications.find((p) => p.title === 'A solo authored note');
    expect(solo?.authorPosition).toBe('solo');
    const unmatched = result.publications.find((p) => p.title === 'Someone elses multi-author work');
    expect(unmatched?.authorPosition).toBeNull();
  });
});

describe('override stages', () => {
  it('lowers an over-eager inferred stage when the override says so', async () => {
    const overridesPath = join(instanceDir, 'data', 'overrides.yaml');
    writeFileSync(
      overridesPath,
      `overrides:
  leeds-paper:
    titleMatch: Cycling to health
    openScienceStage: 0
  future-thing:
    titleMatch: no-such-publication-anywhere
    openScienceStage: 5
`,
      'utf8',
    );
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await syncPortfolio(instanceDir, {
      offlineBundle: buildBundle(),
      log: () => {},
    });
    const paper = result.publications.find((p) => p.title.includes('Cycling to health'))!;
    // Inferred stage was 1 (gold OA); the override replaces it, it does not max.
    expect(paper.openScienceStage).toBe(0);
    const unmatched = warnSpy.mock.calls
      .map((c) => String(c[0]))
      .filter((m) => m.includes('future-thing'));
    expect(unmatched).toHaveLength(1);
    expect(unmatched[0]).toContain('matched 0 publications');
  });
});

describe('curated metric precedence', () => {
  it('curated non-null values beat OpenAlex nulls', async () => {
    const journalMetricsPath = join(instanceDir, 'data', 'journal-metrics.yaml');
    const curated = parseYaml(readFileSync(journalMetricsPath, 'utf8')) as { journals: unknown[] };
    curated.journals.push({
      id: 'journal-of-transport-and-health',
      name: 'Journal of Transport and Health',
      publisher: 'Elsevier',
      apcUsd: 900,
      homepageUrl: 'https://www.journals.elsevier.com/jth',
    });
    writeFileSync(journalMetricsPath, stringifyYaml(curated), 'utf8');
    const result = await syncPortfolio(instanceDir, {
      offlineBundle: buildBundle(),
      log: () => {},
    });
    const jth = result.journals.find((j) => j.id === 'journal-of-transport-and-health')!;
    expect(jth).toBeDefined();
    expect(jth.apcUsd).toBe(900);
    expect(jth.publisher).toBe('Elsevier');
    expect(jth.homepageUrl).toBe('https://www.journals.elsevier.com/jth');
    expect(jth.metricSource).toBe('hybrid');
  });

  it('target-only journals with an OpenAlex match use metricSource openalex', async () => {
    const papersPath = join(instanceDir, 'data', 'planned-papers.yaml');
    const papers = parseYaml(readFileSync(papersPath, 'utf8')) as { plannedPapers: unknown[] };
    (papers.plannedPapers[0] as { targetJournals: unknown[] }).targetJournals.push({
      journalId: 'journal-of-transport-and-health',
      journalName: 'Journal of Transport and Health',
      rank: 1,
      fitScore: 50,
      fitRationale: 'test',
    });
    writeFileSync(papersPath, stringifyYaml(papers), 'utf8');
    const result = await syncPortfolio(instanceDir, {
      offlineBundle: buildBundle(),
      log: () => {},
    });
    const jth = result.journals.find((j) => j.id === 'journal-of-transport-and-health')!;
    expect(jth.metricSource).toBe('openalex');
  });
});

describe('scholarSummary wiring and placeholder ORCID', () => {
  it('wires scholarSummary.i10Index into author.metrics.i10IndexScholar', async () => {
    const configPath = join(instanceDir, 'researchhq.config.yaml');
    const configText = readFileSync(configPath, 'utf8');
    writeFileSync(
      configPath,
      configText.replace(
        'sync:',
        'sync:\n  scholarSummary:\n    citedByCount: 500\n    hIndex: 50\n    i10Index: 200',
      ),
      'utf8',
    );
    const result = await syncPortfolio(instanceDir, {
      offlineBundle: buildBundle(),
      log: () => {},
    });
    expect(result.snapshot.author.metrics.i10IndexScholar).toBe(200);
    expect(result.snapshot.author.metrics.citedByScholar).toBe(500);
  });

  it('rejects the init placeholder ORCID with an actionable error', async () => {
    const placeholderDir = join(TEST_ROOT, 'placeholder-instance');
    try {
      initInstance(placeholderDir, { force: true });
    } catch {
      initInstance(placeholderDir);
    }
    await expect(
      syncPortfolio(placeholderDir, { offlineBundle: buildBundle(), log: () => {} }),
    ).rejects.toThrow(/Placeholder ORCID 0000-0000-0000-0000/);
  });
});

describe('validateInstance hardening', () => {
  it('fails when the public export still carries forbidden keys or non-empty private urls', async () => {
    await syncPortfolio(instanceDir, { offlineBundle: buildBundle(), log: () => {} });
    const publicPath = join(instanceDir, 'public-data', 'portfolio.public.json');
    const publicJson = JSON.parse(readFileSync(publicPath, 'utf8')) as {
      author: Record<string, unknown>;
      plannedPapers: Array<{ repoUrls: Array<Record<string, unknown>> }>;
    };
    publicJson.author.symplecticId = '00983319';
    if (publicJson.plannedPapers.length > 0) {
      publicJson.plannedPapers[0]!.repoUrls.push({
        label: 'Leaked link',
        url: 'https://github.com/x/leaked',
        visibility: 'private',
      });
    }
    writeFileSync(publicPath, JSON.stringify(publicJson, null, 2), 'utf8');
    const result = validateInstance(instanceDir);
    expect(result.ok).toBe(false);
    const joined = result.errors.join('\n');
    expect(joined).toContain('symplecticId');
    expect(joined).toContain('private');
  });

  it('passes on the untouched sanitized export', async () => {
    await syncPortfolio(instanceDir, { offlineBundle: buildBundle(), log: () => {} });
    expect(validateInstance(instanceDir).ok).toBe(true);
  });
});
