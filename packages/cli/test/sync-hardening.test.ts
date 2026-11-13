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
  bookEditionTitleKey,
  dedupeEditions,
  dedupeKey,
  firstAuthorSurname,
  initInstance,
  matchesCanonicalJournal,
  parseOrcid,
  resolveOpenAlexApiKey,
  stripEditionMarkers,
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

describe('multi-edition book, chapter, and mirror deduplication', () => {
  const BOOK_SOURCE = sourceFixture({
    id: 'https://openalex.org/S4306463019',
    display_name: 'Chapman & Hall/CRC eBooks',
    type: 'ebook platform',
  });

  it('strips explicit edition suffixes while preserving volume and part identifiers', () => {
    expect(stripEditionMarkers('Spatial Microsimulation with R (2nd ed.)')).toBe(
      'Spatial Microsimulation with R',
    );
    expect(stripEditionMarkers('Spatial Microsimulation with R, First Edition')).toBe(
      'Spatial Microsimulation with R',
    );
    expect(bookEditionTitleKey('Spatial Microsimulation with R (2nd ed.)')).toBe(
      bookEditionTitleKey('Spatial Microsimulation with R, First Edition'),
    );
    expect(bookEditionTitleKey('Geocomputation with R: Revised edition')).toBe(
      bookEditionTitleKey('Geocomputation with R, 2e'),
    );
    // Multi-volume and multi-part works must remain distinct keys.
    expect(bookEditionTitleKey('Handbook of Transport, Volume 1')).not.toBe(
      bookEditionTitleKey('Handbook of Transport, Volume 2'),
    );
    expect(bookEditionTitleKey('Handbook of Transport, Vol. 1 (2nd ed.)')).not.toBe(
      bookEditionTitleKey('Handbook of Transport, Vol. 2 (2nd ed.)'),
    );
    expect(bookEditionTitleKey('Transport Systems, Part I')).not.toBe(
      bookEditionTitleKey('Transport Systems, Part II'),
    );
  });

  it('collapses identical-title multi-edition books to latest year, sums distinct-DOI OpenAlex citations, takes max Scholar, and inherits Stage 4 + openScience URLs + featured', async () => {
    const scholarCsv = join(instanceDir, 'scholar.csv');
    writeFileSync(scholarCsv, 'title,citations_numeric\n"Geocomputation with R",204\n', 'utf8');

    const overridesPath = join(instanceDir, 'data', 'overrides.yaml');
    writeFileSync(
      overridesPath,
      `overrides:
  geocomputation-with-r:
    doi: 10.1201/9780203730058
    featured: true
    openScienceStage: 4
    openScience:
      oaUrl: https://r.geocompx.org/
      dataUrl: https://github.com/Nowosad/spData
      codeUrl: https://github.com/geocompx/geocompr
      reproducibleRepoUrl: https://github.com/geocompx/geocompr
      interactiveToolUrl: https://r.geocompx.org/
`,
      'utf8',
    );

    const bundle: OfflineBundle = {
      author: MOCK_AUTHOR,
      works: [
        workFixture({
          id: 'https://openalex.org/W2959847940',
          display_name: 'Geocomputation with R',
          type: 'book',
          publication_year: 2019,
          publication_date: '2019-03-22',
          doi: 'https://doi.org/10.1201/9780203730058',
          cited_by_count: 131,
          fwci: 6.15,
          counts_by_year: [
            { year: 2026, cited_by_count: 13 },
            { year: 2025, cited_by_count: 14 },
            { year: 2019, cited_by_count: 104 },
          ],
          abstract_inverted_index: { Geocomputation: [0], first: [1], edition: [2] },
          open_access: { is_oa: true, oa_status: 'green', oa_url: 'https://r.geocompx.org/' },
          primary_location: { source: BOOK_SOURCE, landing_page_url: 'https://r.geocompx.org/' },
          locations: [{ source: BOOK_SOURCE, landing_page_url: 'https://r.geocompx.org/' }],
          authorships: [
            { author_position: 'first', author: { id: 'https://openalex.org/A9999999999', display_name: 'Robin Lovelace' } },
            { author_position: 'middle', author: { id: 'https://openalex.org/A2', display_name: 'Jakub Nowosad' } },
            { author_position: 'last', author: { id: 'https://openalex.org/A3', display_name: 'Jannes Muenchow' } },
          ],
        }),
        workFixture({
          id: 'https://openalex.org/W4409802704',
          display_name: 'Geocomputation with R',
          type: 'book',
          publication_year: 2025,
          publication_date: '2025-04-25',
          doi: 'https://doi.org/10.1201/9781003280569',
          cited_by_count: 13,
          fwci: null,
          counts_by_year: [
            { year: 2026, cited_by_count: 6 },
            { year: 2025, cited_by_count: 7 },
          ],
          abstract_inverted_index: null,
          open_access: {
            is_oa: true,
            oa_status: 'hybrid',
            oa_url: 'https://api.taylorfrancis.com/content/books/mono/download?identifierValue=10.1201/9781003280569',
          },
          primary_location: { source: BOOK_SOURCE, landing_page_url: 'https://doi.org/10.1201/9781003280569' },
          locations: [{ source: BOOK_SOURCE, landing_page_url: 'https://doi.org/10.1201/9781003280569' }],
          authorships: [
            { author_position: 'first', author: { id: 'https://openalex.org/A9999999999', display_name: 'Robin Lovelace' } },
            { author_position: 'middle', author: { id: 'https://openalex.org/A2', display_name: 'Jakub Nowosad' } },
            { author_position: 'last', author: { id: 'https://openalex.org/A3', display_name: 'Jannes Muenchow' } },
          ],
        }),
      ],
      sources: { S4306463019: BOOK_SOURCE },
      journals: {},
    };

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await syncPortfolio(instanceDir, {
      offlineBundle: bundle,
      scholarCsvPath: scholarCsv,
      log: () => {},
    });
    expect(warnSpy).not.toHaveBeenCalled();

    const books = result.publications.filter((p) => p.type === 'book');
    expect(books).toHaveLength(1);
    const geocompr = books[0]!;
    expect(geocompr.year).toBe(2025);
    expect(geocompr.doi).toBe('10.1201/9781003280569');
    expect(geocompr.citations).toBe(144);
    expect(geocompr.citationsOpenAlex).toBe(144);
    expect(geocompr.citationsScholar).toBe(204);
    expect(geocompr.openScienceStage).toBe(4);
    expect(geocompr.featured).toBe(true);
    expect(geocompr.openScience.oaUrl).toBe('https://r.geocompx.org/');
    expect(geocompr.openScience.dataUrl).toBe('https://github.com/Nowosad/spData');
    expect(geocompr.openScience.codeUrl).toBe('https://github.com/geocompx/geocompr');
    expect(geocompr.openScience.reproducibleRepoUrl).toBe('https://github.com/geocompx/geocompr');
    expect(geocompr.openScience.interactiveToolUrl).toBe('https://r.geocompx.org/');
    expect(geocompr.abstract).toBe('Geocomputation first edition');
    expect(geocompr.fwci).toBe(6.15);
    expect(geocompr.citationsByYear).toEqual([
      { year: 2019, citedByCount: 104 },
      { year: 2025, citedByCount: 21 },
      { year: 2026, citedByCount: 19 },
    ]);
    expect(result.snapshot.author.metrics.citedByCount).toBe(144);
  });

  it('merges suffixed book editions, never merges multi-volume books, and guards against summing identical DOIs', () => {
    const basePub = {
      id: 'W1',
      doi: '10.1201/ed1',
      openalexId: 'W1',
      title: 'Spatial Microsimulation with R, First Edition',
      year: 2016,
      publicationDate: '2016-01-01',
      type: 'book' as const,
      venue: 'CRC Press',
      journalId: 'crc-press',
      authors: ['Robin Lovelace', 'Morgane Dumont'],
      authorPosition: 'first' as const,
      citations: 105,
      citationsOpenAlex: 105,
      citationsScholar: 133,
      citationsByYear: [{ year: 2016, citedByCount: 105 }],
      fwci: 2.5,
      abstract: 'First edition abstract',
      topics: ['Microsimulation'],
      openScienceStage: 4,
      openScience: {
        oaStatus: 'green' as const,
        oaUrl: 'https://spatial-microsim-book.robinlovelace.net',
        codeUrl: 'https://github.com/Robinlovelace/spatial-microsim-book',
      },
      url: 'https://spatial-microsim-book.robinlovelace.net',
      featured: true,
    };

    const ed2 = {
      ...basePub,
      id: 'W2',
      openalexId: 'W2',
      doi: '10.1201/ed2',
      title: 'Spatial Microsimulation with R (2nd ed.)',
      year: 2024,
      publicationDate: '2024-06-01',
      citations: 15,
      citationsOpenAlex: 15,
      citationsScholar: null,
      citationsByYear: [{ year: 2024, citedByCount: 15 }],
      fwci: null,
      abstract: null,
      openScienceStage: 1,
      openScience: { oaStatus: 'gold' as const },
      featured: undefined,
    };

    // Duplicate OpenAlex work sharing the exact same DOI as ed2 must NOT double-count 15 + 15.
    const ed2SameDoiDup = {
      ...ed2,
      id: 'W2dup',
      openalexId: 'W2dup',
      citations: 15,
      citationsOpenAlex: 15,
    };

    const vol1 = {
      ...basePub,
      id: 'Wvol1',
      openalexId: 'Wvol1',
      doi: '10.1000/handbook-v1',
      title: 'Handbook of Transport, Volume 1',
      year: 2021,
      citations: 20,
      citationsOpenAlex: 20,
    };

    const vol2 = {
      ...basePub,
      id: 'Wvol2',
      openalexId: 'Wvol2',
      doi: '10.1000/handbook-v2',
      title: 'Handbook of Transport, Volume 2',
      year: 2023,
      citations: 12,
      citationsOpenAlex: 12,
    };

    const deduped = dedupeEditions([basePub, ed2, ed2SameDoiDup, vol1, vol2]);
    expect(deduped).toHaveLength(3);

    const smr = deduped.find((p) => p.title.startsWith('Spatial Microsimulation'))!;
    expect(smr.year).toBe(2024);
    expect(smr.title).toBe('Spatial Microsimulation with R (2nd ed.)');
    expect(smr.doi).toBe('10.1201/ed2');
    expect(smr.citationsOpenAlex).toBe(120);
    expect(smr.citationsScholar).toBe(133);
    expect(smr.openScienceStage).toBe(4);
    expect(smr.featured).toBe(true);
    expect(smr.openScience.codeUrl).toBe('https://github.com/Robinlovelace/spatial-microsim-book');

    expect(deduped.filter((p) => p.title.startsWith('Handbook of Transport'))).toHaveLength(2);
  });

  it('merges multi-edition chapters of the same parent book while keeping chapters from different books separate', async () => {
    const bundle: OfflineBundle = {
      author: MOCK_AUTHOR,
      works: [
        // Geocomputation with R (1st ed. 2019 + 2nd ed. 2025)
        workFixture({
          id: 'https://openalex.org/W_GEOCOMPR_2019',
          display_name: 'Geocomputation with R',
          type: 'book',
          publication_year: 2019,
          doi: '10.1201/9780203730058',
          cited_by_count: 131,
          primary_location: { source: BOOK_SOURCE, landing_page_url: 'https://r.geocompx.org/' },
          locations: [{ source: BOOK_SOURCE, landing_page_url: 'https://r.geocompx.org/' }],
          authorships: [
            { author_position: 'first', author: { id: 'https://openalex.org/A9999999999', display_name: 'Robin Lovelace' } },
            { author_position: 'middle', author: { id: 'https://openalex.org/A2', display_name: 'Jakub Nowosad' } },
            { author_position: 'last', author: { id: 'https://openalex.org/A3', display_name: 'Jannes Muenchow' } },
          ],
        }),
        workFixture({
          id: 'https://openalex.org/W_GEOCOMPR_2025',
          display_name: 'Geocomputation with R',
          type: 'book',
          publication_year: 2025,
          doi: '10.1201/9781003280569',
          cited_by_count: 13,
          primary_location: { source: BOOK_SOURCE, landing_page_url: 'https://r.geocompx.org/' },
          locations: [{ source: BOOK_SOURCE, landing_page_url: 'https://r.geocompx.org/' }],
          authorships: [
            { author_position: 'first', author: { id: 'https://openalex.org/A9999999999', display_name: 'Robin Lovelace' } },
            { author_position: 'middle', author: { id: 'https://openalex.org/A2', display_name: 'Jakub Nowosad' } },
            { author_position: 'last', author: { id: 'https://openalex.org/A3', display_name: 'Jannes Muenchow' } },
          ],
        }),
        // Geocomputation with Python (2024) - distinct book sharing 2 co-authors
        workFixture({
          id: 'https://openalex.org/W_GEOCOMPY_2024',
          display_name: 'Geocomputation with Python',
          type: 'book',
          publication_year: 2024,
          doi: '10.1201/9781003379911',
          cited_by_count: 3,
          primary_location: { source: BOOK_SOURCE, landing_page_url: 'https://py.geocompx.org/' },
          locations: [{ source: BOOK_SOURCE, landing_page_url: 'https://py.geocompx.org/' }],
          authorships: [
            { author_position: 'first', author: { id: 'https://openalex.org/A4', display_name: 'Michael Dorman' } },
            { author_position: 'middle', author: { id: 'https://openalex.org/A5', display_name: 'Anita Graser' } },
            { author_position: 'middle', author: { id: 'https://openalex.org/A2', display_name: 'Jakub Nowosad' } },
            { author_position: 'last', author: { id: 'https://openalex.org/A9999999999', display_name: 'Robin Lovelace' } },
          ],
        }),
        // Same-book chapter across two editions of Geocomputation with R (renumbered -5 -> -6)
        workFixture({
          id: 'https://openalex.org/W_CH_R_2019',
          display_name: 'Geometry operations',
          type: 'book-chapter',
          publication_year: 2019,
          doi: '10.1201/9780203730058-5',
          cited_by_count: 4,
          primary_location: { source: BOOK_SOURCE, landing_page_url: 'https://doi.org/10.1201/9780203730058-5' },
          locations: [{ source: BOOK_SOURCE, landing_page_url: 'https://doi.org/10.1201/9780203730058-5' }],
          authorships: [
            { author_position: 'first', author: { id: 'https://openalex.org/A9999999999', display_name: 'Robin Lovelace' } },
            { author_position: 'middle', author: { id: 'https://openalex.org/A2', display_name: 'Jakub Nowosad' } },
            { author_position: 'last', author: { id: 'https://openalex.org/A3', display_name: 'Jannes Muenchow' } },
          ],
        }),
        workFixture({
          id: 'https://openalex.org/W_CH_R_2025',
          display_name: 'Geometry operations',
          type: 'book-chapter',
          publication_year: 2025,
          doi: '10.1201/9781003280569-6',
          cited_by_count: 2,
          primary_location: { source: BOOK_SOURCE, landing_page_url: 'https://doi.org/10.1201/9781003280569-6' },
          locations: [{ source: BOOK_SOURCE, landing_page_url: 'https://doi.org/10.1201/9781003280569-6' }],
          authorships: [
            { author_position: 'first', author: { id: 'https://openalex.org/A9999999999', display_name: 'Robin Lovelace' } },
            { author_position: 'middle', author: { id: 'https://openalex.org/A2', display_name: 'Jakub Nowosad' } },
            { author_position: 'last', author: { id: 'https://openalex.org/A3', display_name: 'Jannes Muenchow' } },
          ],
        }),
        // Same-title chapter in Geocomputation with Python - MUST stay separate
        workFixture({
          id: 'https://openalex.org/W_CH_PY_2024',
          display_name: 'Geometry operations',
          type: 'book-chapter',
          publication_year: 2024,
          doi: '10.1201/9781003379911-4',
          cited_by_count: 1,
          primary_location: { source: BOOK_SOURCE, landing_page_url: 'https://doi.org/10.1201/9781003379911-4' },
          locations: [{ source: BOOK_SOURCE, landing_page_url: 'https://doi.org/10.1201/9781003379911-4' }],
          authorships: [
            { author_position: 'first', author: { id: 'https://openalex.org/A4', display_name: 'Michael Dorman' } },
            { author_position: 'middle', author: { id: 'https://openalex.org/A5', display_name: 'Anita Graser' } },
            { author_position: 'middle', author: { id: 'https://openalex.org/A2', display_name: 'Jakub Nowosad' } },
            { author_position: 'last', author: { id: 'https://openalex.org/A9999999999', display_name: 'Robin Lovelace' } },
          ],
        }),
        // Same-year Rogue Scholar blog mirror records (`type === 'other'`) collapse to 1
        workFixture({
          id: 'https://openalex.org/W_BLOG_1',
          display_name: 'When Field or Lab Work is not an Option - Leveraging Open Data Resources for Remote Research',
          type: 'dataset',
          publication_year: 2020,
          doi: '10.59350/ywaqe-9h090',
          cited_by_count: 0,
        }),
        workFixture({
          id: 'https://openalex.org/W_BLOG_2',
          display_name: 'When Field or Lab Work is not an Option - Leveraging Open Data Resources for Remote Research',
          type: 'dataset',
          publication_year: 2020,
          doi: '10.59350/g0c2s-64b41',
          cited_by_count: 0,
        }),
      ],
      sources: { S4306463019: BOOK_SOURCE, S183347913: JOURNAL_SOURCE },
      journals: {},
    };

    const result = await syncPortfolio(instanceDir, {
      offlineBundle: bundle,
      log: () => {},
    });

    const books = result.publications.filter((p) => p.type === 'book');
    expect(books).toHaveLength(2);
    expect(books.map((b) => b.title).sort()).toEqual([
      'Geocomputation with Python',
      'Geocomputation with R',
    ]);

    const chapters = result.publications.filter((p) => p.type === 'book-chapter');
    expect(chapters).toHaveLength(2);
    const rChapter = chapters.find((c) => c.doi === '10.1201/9781003280569-6')!;
    const pyChapter = chapters.find((c) => c.doi === '10.1201/9781003379911-4')!;
    expect(rChapter).toBeDefined();
    expect(rChapter.year).toBe(2025);
    expect(rChapter.citationsOpenAlex).toBe(6);
    expect(pyChapter).toBeDefined();
    expect(pyChapter.year).toBe(2024);
    expect(pyChapter.citationsOpenAlex).toBe(1);

    const blogPosts = result.publications.filter((p) =>
      p.title.startsWith('When Field or Lab Work'),
    );
    expect(blogPosts).toHaveLength(1);
  });
});
