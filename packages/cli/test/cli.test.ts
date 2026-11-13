/**
 * Vitest unit tests for @researchhq/cli: initInstance, addPlannedPaper,
 * updatePlannedPaper, and syncPortfolio with an offline mock OpenAlex client
 * covering repository-vs-journal locations, preprint deduplication, override
 * matching, journal name merging, and public export sanitization.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, beforeEach } from 'vitest';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

import {
  addPlannedPaper,
  initInstance,
  listPlannedPapers,
  normalizeTitleKey,
  syncPortfolio,
  updatePlannedPaper,
  validateInstance,
  type OfflineBundle,
  type OpenAlexPort,
  type RawOpenAlexSource,
  type RawOpenAlexWork,
} from '../src/index.js';

// ---------------------------------------------------------------------------
// Test workspace root: isolated per-process temp dir, portable across local
// hosts and GitHub Actions CI (never a hardcoded absolute path)
// ---------------------------------------------------------------------------

const TEST_ROOT = join(tmpdir(), `researchhq-cli-test-${process.pid}`);

function freshDir(name: string): string {
  const dir = join(TEST_ROOT, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ---------------------------------------------------------------------------
// Offline fixture bundle and mock client
// ---------------------------------------------------------------------------

function sourceFixture(overrides: Partial<RawOpenAlexSource> & { id: string; display_name: string }): RawOpenAlexSource {
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

const JOURNAL_SOURCE: RawOpenAlexSource = sourceFixture({
  id: 'https://openalex.org/S183347913',
  display_name: 'Journal of Transport & Health',
  type: 'journal',
  summary_stats: { '2yr_mean_citedness': 4.2, h_index: 60, i10_index: 300 },
  is_oa: false,
});

const REPOSITORY_SOURCE: RawOpenAlexSource = sourceFixture({
  id: 'https://openalex.org/S4306422567',
  display_name: 'White Rose Research Online',
  type: 'repository',
});

const MOCK_AUTHOR = {
  id: 'https://openalex.org/A9999999999',
  display_name: 'Robin Lovelace',
  works_count: 5,
  cited_by_count: 500,
  summary_stats: { '2yr_mean_citedness': 1.9, h_index: 5, i10_index: 4 },
  last_known_institutions: [{ display_name: 'University of Leeds' }],
};

function articleWork(overrides: Partial<RawOpenAlexWork> & { id: string; display_name: string }): RawOpenAlexWork {
  return {
    doi: null,
    publication_year: 2024,
    publication_date: '2024-01-01',
    type: 'article',
    cited_by_count: 5,
    fwci: 1.2,
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
    topics: [{ display_name: 'Transport' }],
    abstract_inverted_index: { Hello: [0], world: [1] },
    ...overrides,
  };
}

const CLOSED_DOI = '10.1234/closed-paper';
const OVERridden_DOI = '10.9999/flagship-tool';

function buildWorks(): RawOpenAlexWork[] {
  return [
    // Published article: journal in both primary and locations.
    articleWork({
      id: 'https://openalex.org/W1000000001',
      display_name: 'Cycling to health: evidence from Leeds',
      doi: CLOSED_DOI,
      open_access: { is_oa: false, oa_status: 'closed', oa_url: null },
    }),
    // Preprint whose primary location is a repository but which also has a
    // published journal location, sharing a title with the article below.
    articleWork({
      id: 'https://openalex.org/W1000000002',
      display_name: 'The Cycle Route Uptake and Scenario Estimation model',
      type: 'preprint',
      cited_by_count: 12,
      primary_location: { source: REPOSITORY_SOURCE, landing_page_url: 'https://wro.example.org/preprint' },
      locations: [
        { source: REPOSITORY_SOURCE, landing_page_url: 'https://wro.example.org/preprint' },
        { source: JOURNAL_SOURCE, landing_page_url: 'https://journal.example.org/published' },
      ],
      open_access: { is_oa: true, oa_status: 'green', oa_url: 'https://wro.example.org/preprint.pdf' },
    }),
    // Published version of the same paper (dedup keeper).
    articleWork({
      id: 'https://openalex.org/W1000000003',
      display_name: 'The Cycle Route Uptake and Scenario Estimation model',
      type: 'article',
      cited_by_count: 30,
      primary_location: { source: JOURNAL_SOURCE, landing_page_url: 'https://journal.example.org/published' },
    }),
    // JOSS paper: stage 3 venue inference.
    articleWork({
      id: 'https://openalex.org/W1000000004',
      display_name: 'stats19: Working with open road crash data',
      type: 'article',
      cited_by_count: 40,
      open_access: { is_oa: true, oa_status: 'gold', oa_url: 'https://joss.example.org/paper.pdf' },
      primary_location: { source: JOSS_SOURCE, landing_page_url: 'https://joss.example.org/paper' },
      locations: [{ source: JOSS_SOURCE, landing_page_url: 'https://joss.example.org/paper' }],
    }),
    // Software type: stage 3 via type mapping.
    articleWork({
      id: 'https://openalex.org/W1000000005',
      display_name: 'odjitter: origin destination jittering in Rust',
      type: 'software',
      cited_by_count: 15,
      primary_location: { source: JOURNAL_SOURCE, landing_page_url: 'https://github.com/robinlovelace/odjitter' },
    }),
    // Override-matched flagship with a deployed interactive tool.
    articleWork({
      id: 'https://openalex.org/W1000000006',
      display_name: 'The Propensity to Cycle Tool: An open source online system',
      doi: OVERridden_DOI,
      type: 'article',
      cited_by_count: 167,
      open_access: { is_oa: false, oa_status: 'closed', oa_url: null },
    }),
    // Paratext and erratum must be excluded.
    articleWork({
      id: 'https://openalex.org/W1000000007',
      display_name: 'Publisher correction: something',
      type: 'paratext',
      cited_by_count: 0,
    }),
    articleWork({
      id: 'https://openalex.org/W1000000008',
      display_name: 'Erratum to a paper',
      type: 'erratum',
      cited_by_count: 0,
    }),
    // Old work filtered out by minYear 2020.
    articleWork({
      id: 'https://openalex.org/W1000000009',
      display_name: 'Ancient work from long ago',
      publication_year: 2010,
      cited_by_count: 99,
    }),
  ];
}

const JOSS_SOURCE: RawOpenAlexSource = sourceFixture({
  id: 'https://openalex.org/S4377101959',
  display_name: 'Journal of Open Source Software',
  type: 'journal',
  is_oa: true,
});

function buildBundle(): OfflineBundle {
  const works = buildWorks();
  return {
    author: MOCK_AUTHOR,
    works,
    sources: {
      S183347913: JOURNAL_SOURCE,
      S4306422567: REPOSITORY_SOURCE,
      S4377101959: JOSS_SOURCE,
    },
    journals: {
      'journal-of-transport-and-health': JOURNAL_SOURCE,
      'journal-of-transport-geography': sourceFixture({
        id: 'https://openalex.org/S95304739',
        display_name: 'Journal of Transport Geography',
        summary_stats: { '2yr_mean_citedness': 7.1, h_index: 90, i10_index: 500 },
      }),
    },
  };
}

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

let instanceDir: string;

beforeEach(() => {
  instanceDir = freshDir('instance');
  initInstance(instanceDir, { name: 'Robin Lovelace', orcid: '0000-0001-5679-6536' });
});

// ---------------------------------------------------------------------------
// initInstance
// ---------------------------------------------------------------------------

describe('initInstance', () => {
  it('scaffolds a complete workspace', () => {
    const dir = freshDir('init-check');
    const result = initInstance(dir, { name: 'Ada Lovelace', orcid: '0000-0002-0000-0000' });
    expect(result.files).toHaveLength(6);
    for (const file of result.files) {
      expect(existsSync(file)).toBe(true);
    }
    const config = readFileSync(join(dir, 'researchhq.config.yaml'), 'utf8');
    expect(config).toContain('Ada Lovelace');
    expect(config).toContain('0000-0002-0000-0000');
    const papers = readFileSync(join(dir, 'data', 'planned-papers.yaml'), 'utf8');
    expect(papers).toContain('example-open-science-audit');
    const journals = readFileSync(join(dir, 'data', 'journal-metrics.yaml'), 'utf8');
    expect(journals).toContain('journal-of-transport-geography');
    expect(journals).toContain('journal-of-open-source-software');
    expect(readFileSync(join(dir, 'data', 'overrides.yaml'), 'utf8')).toContain('overrides: {}');
    expect(readFileSync(join(dir, 'README.md'), 'utf8')).toContain('researchhq sync');
  });

  it('errors on an existing workspace without force', () => {
    expect(() => initInstance(instanceDir)).toThrow(/already exists/);
  });

  it('scaffolded workspace passes validation', () => {
    expect(validateInstance(instanceDir).ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Planned papers: add, update, list
// ---------------------------------------------------------------------------

describe('addPlannedPaper', () => {
  it('appends a validated planned paper with defaults', () => {
    const paper = addPlannedPaper(instanceDir, {
      slug: 'new-method-paper',
      title: 'A new methods paper',
      targetJournals: ['Journal of Transport Geography'],
    });
    expect(paper.status).toBe('idea');
    expect(paper.category).toBe('flagship-project');
    expect(paper.readinessPercent).toBe(10);
    expect(paper.targetJournals[0].journalName).toBe('Journal of Transport Geography');
    expect(paper.targetJournals[0].rank).toBe(1);

    const papers = listPlannedPapers(instanceDir);
    expect(papers.map((p) => p.slug)).toContain('new-method-paper');

    // The named journal gets a minimal curated entry so metrics have a home.
    const journalsYaml = readFileSync(join(instanceDir, 'data', 'journal-metrics.yaml'), 'utf8');
    expect(journalsYaml).toContain('journal-of-transport-geography');
  });

  it('rejects duplicate slugs', () => {
    addPlannedPaper(instanceDir, { slug: 'dup-slug', title: 'First' });
    expect(() => addPlannedPaper(instanceDir, { slug: 'dup-slug', title: 'Duplicate' })).toThrow(
      /already exists/,
    );
  });

  it('writes planned papers that validate against the schema', () => {
    addPlannedPaper(instanceDir, { slug: 'another-idea', title: 'Another idea' });
    expect(validateInstance(instanceDir).ok).toBe(true);
  });
});

describe('updatePlannedPaper', () => {
  it('updates status, readiness, tool url, and appends milestones', () => {
    const updated = updatePlannedPaper(instanceDir, 'example-open-science-audit', {
      status: 'scoping',
      readinessPercent: 35,
      interactiveToolUrl: 'https://example.org/tool',
      nextMilestonesAppend: ['Prototype the audit table'],
    });
    expect(updated.status).toBe('scoping');
    expect(updated.readinessPercent).toBe(35);
    expect(updated.interactiveToolUrl).toBe('https://example.org/tool');
    expect(updated.nextMilestones).toContain('Prototype the audit table');

    const onDisk = listPlannedPapers(instanceDir).find((p) => p.slug === 'example-open-science-audit');
    expect(onDisk?.status).toBe('scoping');
    expect(onDisk?.readinessPercent).toBe(35);
  });

  it('throws for an unknown slug', () => {
    expect(() => updatePlannedPaper(instanceDir, 'no-such-slug', { status: 'drafting' })).toThrow(
      /No planned paper/,
    );
  });

  it('listPlannedPapers sorts by readiness descending', () => {
    addPlannedPaper(instanceDir, { slug: 'a-lower', title: 'Lower readiness' });
    const updated = updatePlannedPaper(instanceDir, 'example-open-science-audit', { readinessPercent: 90 });
    expect(updated.readinessPercent).toBe(90);
    const papers = listPlannedPapers(instanceDir);
    const readies = papers.map((p) => p.readinessPercent);
    const sorted = [...readies].sort((a, b) => b - a);
    expect(readies).toEqual(sorted);
  });
});

// ---------------------------------------------------------------------------
// syncPortfolio with the offline bundle client
// ---------------------------------------------------------------------------

describe('syncPortfolio', () => {
  it('syncs works from an offline bundle and writes the sanitized public export', async () => {
    // Curated journal entry that must merge with the '&'-named live venue.
    const journalMetricsPath = join(instanceDir, 'data', 'journal-metrics.yaml');
    const curated = parseYaml(readFileSync(journalMetricsPath, 'utf8')) as { journals: unknown[] };
    curated.journals.push({
      id: 'journal-of-transport-and-health',
      name: 'Journal of Transport and Health',
      shortName: 'JTH',
      publisher: 'Elsevier',
      jif: 3.3,
      jifYear: 2025,
      scopeTags: ['active-travel'],
    });
    writeFileSync(journalMetricsPath, stringifyYaml(curated), 'utf8');

    // An override matched by DOI, upgrading the closed-access PCT article.
    const overridesPath = join(instanceDir, 'data', 'overrides.yaml');
    writeFileSync(
      overridesPath,
      `overrides:
  pct:
    doi: ${OVERridden_DOI}
    featured: true
    openScienceStage: 5
    openScience:
      interactiveToolUrl: https://www.pct.bike
      codeUrl: https://github.com/npct
`,
      'utf8',
    );

    // A planned paper with a private note must lose it in the public export.
    addPlannedPaper(instanceDir, {
      slug: 'with-private-note',
      title: 'Paper with a private note',
      privateNotes: 'SECRET-PRIVATE-NOTE-do-not-publish',
    });

    const privateOut = join(instanceDir, 'private', 'portfolio.json');
    // Filter ancient works: set minYear 2020 in the scaffolded config.
    const configPath = join(instanceDir, 'researchhq.config.yaml');
    writeFileSync(configPath, readFileSync(configPath, 'utf8').replace('minYear: 2000', 'minYear: 2020'), 'utf8');

    const result = await syncPortfolio(instanceDir, {
      offlineBundle: buildBundle(),
      privateOut,
      log: () => {},
    });

    const publications = result.publications;

    // Exclusions and minYear filtering.
    const titles = publications.map((p) => p.title);
    expect(titles).not.toContain('Publisher correction: something');
    expect(titles).not.toContain('Erratum to a paper');
    expect(titles).not.toContain('Ancient work from long ago');

    // Preprint deduplication: one keeper with max citations.
    const deduped = publications.filter((p) =>
      normalizeTitleKey(p.title) === normalizeTitleKey('The Cycle Route Uptake and Scenario Estimation model'),
    );
    expect(deduped).toHaveLength(1);
    expect(deduped[0].type).toBe('article');
    expect(deduped[0].citations).toBe(30);

    // Repository primary location resolves the published journal venue.
    const pctPaper = publications.find((p) => p.doi === OVERridden_DOI);
    expect(pctPaper).toBeDefined();
    expect(pctPaper?.venue).toBe('Journal of Transport & Health');

    // Open science stage inference: closed -> 0, OA -> 1, JOSS -> 3, software -> 3.
    const closed = publications.find((p) => p.doi === CLOSED_DOI);
    expect(closed?.openScienceStage).toBe(0);
    expect(closed?.openScience.oaStatus).toBe('closed');
    const joss = publications.find((p) => p.title.includes('stats19'));
    expect(joss?.openScienceStage).toBe(3);
    const software = publications.find((p) => p.title.includes('odjitter'));
    expect(software?.openScienceStage).toBe(3);

    // Override upgrades the flagship to stage 5, sets featured and evidence.
    expect(pctPaper?.openScienceStage).toBe(5);
    expect(pctPaper?.featured).toBe(true);
    expect(pctPaper?.openScience.interactiveToolUrl).toBe('https://www.pct.bike');
    expect(pctPaper?.openScience.codeUrl).toBe('https://github.com/npct');

    // Journals: the '&' venue and the 'and' curated entry merge into one entry.
    const jth = result.journals.find((j) => j.id === 'journal-of-transport-and-health');
    expect(jth).toBeDefined();
    expect(jth?.authorPublishedCount).toBeGreaterThan(0);
    expect(jth?.metricSource).toBe('hybrid');
    expect(jth?.jif).toBe(3.3);
    expect(jth?.twoYearMeanCitedness).toBe(4.2);

    // JOSS appears with a repository-free journal venue type.
    const jossJournal = result.journals.find((j) => j.name === 'Journal of Open Source Software');
    expect(jossJournal).toBeDefined();

    // Author metrics.
    expect(result.snapshot.author.name).toBe('Robin Lovelace');
    expect(result.snapshot.author.metrics.worksCount).toBe(publications.length);
    expect(result.snapshot.author.metrics.hIndex).toBeGreaterThan(0);
    expect(result.snapshot.author.metrics.oaPercentage).toBeGreaterThan(0);
    expect(result.snapshot.author.metrics.citedByCount).toBe(
      publications.reduce((sum, p) => sum + p.citations, 0),
    );
    expect(result.snapshot.author.metrics.citedByCountProfile).toBe(500);

    // Private snapshot keeps privateNotes; public export strips them.
    expect(existsSync(privateOut)).toBe(true);
    const privateJson = JSON.parse(readFileSync(privateOut, 'utf8')) as { sanitized?: boolean };
    expect(privateJson.sanitized).toBe(false);

    const publicPath = join(instanceDir, 'public-data', 'portfolio.public.json');
    expect(existsSync(publicPath)).toBe(true);
    const publicText = readFileSync(publicPath, 'utf8');
    expect(publicText).not.toContain('privateNotes');
    const publicJson = JSON.parse(publicText) as { sanitized?: boolean };
    expect(publicJson.sanitized).toBe(true);

    // The private note survives in the private snapshot but never in the public one.
    expect(readFileSync(privateOut, 'utf8')).toContain('SECRET-PRIVATE-NOTE-do-not-publish');

    // The scaffolded example planned paper's privateNotes never leak.
    expect(publicText).not.toContain('SECRET-PRIVATE-NOTE-do-not-publish');

    // Instance validates after sync.
    expect(validateInstance(instanceDir).ok).toBe(true);
  });

  it('accepts a custom mock client implementing OpenAlexPort', async () => {
    const bundle = buildBundle();
    const mockClient: OpenAlexPort = {
      fetchAuthor: async () => bundle.author,
      fetchAuthorWorks: async () => bundle.works,
      fetchSourcesByIds: async (ids) => {
        const map = new Map<string, RawOpenAlexSource>();
        for (const id of ids) {
          const source = bundle.sources?.[id];
          if (source) map.set(id, source);
        }
        return map;
      },
      searchCanonicalJournal: async (name) =>
        bundle.journals?.[name.toLowerCase().replace(/[^a-z0-9]+/g, '-')] ?? null,
    };
    const result = await syncPortfolio(instanceDir, { client: mockClient });
    expect(result.publications.length).toBeGreaterThan(0);
    expect(result.snapshot.author.name).toBe('Robin Lovelace');
  });

  it('merges scholar CSV citations and local publications.yml abstracts', async () => {
    const scholarCsv = join(instanceDir, 'scholar.csv');
    writeFileSync(
      scholarCsv,
      'title,cites\n"Cycling to health: evidence from Leeds",77 citations\n',
      'utf8',
    );
    const publicationsYml = join(instanceDir, 'publications.yml');
    writeFileSync(
      publicationsYml,
      `- title: "Cycling to health: evidence from Leeds"
  abstract: "A much richer abstract curated for the paper page, longer than the OpenAlex reconstruction."
  doi: ${CLOSED_DOI}
  url_source: https://www.robinlovelace.net/paper
`,
      'utf8',
    );
    const result = await syncPortfolio(instanceDir, {
      offlineBundle: buildBundle(),
      scholarCsvPath: scholarCsv,
      publicationsYmlPath: publicationsYml,
    });
    const closed = result.publications.find((p) => p.doi === CLOSED_DOI);
    expect(closed?.citationsScholar).toBe(77);
    expect(closed?.abstract).toContain('richer abstract');
    expect(closed?.url).toBe('https://www.robinlovelace.net/paper');
  });
});

// ---------------------------------------------------------------------------
// ideas.ts: config paths, header preservation, milestone dedupe
// ---------------------------------------------------------------------------

describe('planned papers file handling', () => {
  it('preserves leading # header comments when rewriting planned-papers.yaml', () => {
    const papersPath = join(instanceDir, 'data', 'planned-papers.yaml');
    const before = readFileSync(papersPath, 'utf8');
    expect(before.startsWith('# Planned papers:')).toBe(true);
    updatePlannedPaper(instanceDir, 'example-open-science-audit', { readinessPercent: 55 });
    const after = readFileSync(papersPath, 'utf8');
    expect(after.startsWith('# Planned papers:')).toBe(true);
    expect(after).toContain('readinessPercent: 55');
    addPlannedPaper(instanceDir, { slug: 'header-two', title: 'Second idea' });
    expect(readFileSync(papersPath, 'utf8').startsWith('# Planned papers:')).toBe(true);
  });

  it('dedupes nextMilestones on updatePlannedPaper', () => {
    updatePlannedPaper(instanceDir, 'example-open-science-audit', {
      nextMilestonesAppend: ['Repeat me'],
    });
    const updated = updatePlannedPaper(instanceDir, 'example-open-science-audit', {
      nextMilestonesAppend: ['Repeat me'],
    });
    expect(updated.nextMilestones.filter((m) => m === 'Repeat me')).toHaveLength(1);
  });

  it('honours paths.plannedPapers from researchhq.config.yaml', () => {
    const dir = freshDir('custom-paths');
    initInstance(dir, { name: 'Robin Lovelace', orcid: '0000-0001-5679-6536' });
    const configPath = join(dir, 'researchhq.config.yaml');
    writeFileSync(
      configPath,
      readFileSync(configPath, 'utf8').replace(
        'plannedPapers: data/planned-papers.yaml',
        'plannedPapers: custom/ideas/papers.yaml',
      ),
      'utf8',
    );
    mkdirSync(join(dir, 'custom', 'ideas'), { recursive: true });
    writeFileSync(
      join(dir, 'custom', 'ideas', 'papers.yaml'),
      readFileSync(join(dir, 'data', 'planned-papers.yaml'), 'utf8'),
      'utf8',
    );
    addPlannedPaper(dir, { slug: 'custom-path-paper', title: 'Found via config paths' });
    const custom = readFileSync(join(dir, 'custom', 'ideas', 'papers.yaml'), 'utf8');
    expect(custom).toContain('custom-path-paper');
    // The original default file is untouched.
    expect(readFileSync(join(dir, 'data', 'planned-papers.yaml'), 'utf8')).not.toContain(
      'custom-path-paper',
    );
  });
});

describe('init config serialization', () => {
  it('serializes special characters safely through yaml stringify', () => {
    const dir = freshDir('special-chars');
    initInstance(dir, {
      name: 'O\\Brien "Rob" \\The\\ Third',
      affiliation: 'C AFL & Co, 50% lab',
    });
    const config = readFileSync(join(dir, 'researchhq.config.yaml'), 'utf8');
    expect(config).toContain('O\\Brien');
    expect(() => initInstance(dir, { force: true })).not.toThrow();
  });

  it('ignores private output dirs in .gitignore', () => {
    const gitignore = readFileSync(join(instanceDir, '.gitignore'), 'utf8');
    expect(gitignore).toContain('private-output/');
    expect(gitignore).toContain('*.private.json');
  });
});
