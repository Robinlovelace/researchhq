/**
 * Vitest unit tests for `researchhq audit` (Wave 4B): snapshot resolution
 * order, auditInstance metrics, the rendered text report, --json mode via
 * runCli, plus the paths.scholarCsv / paths.publicationsYml config fallback
 * in syncPortfolio and its validation in validateInstance.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';

import {
  auditInstance,
  initInstance,
  renderAuditReport,
  resolveSnapshotPath,
  runCli,
  syncPortfolio,
  validateInstance,
  AUDIT_HELP,
  type OfflineBundle,
  type RawOpenAlexSource,
  type RawOpenAlexWork,
} from '../src/index.js';
import {
  PortfolioSnapshotSchema,
  PublicationSchema,
  type PortfolioSnapshot,
  type Publication,
} from '@researchhq/schema';

// ---------------------------------------------------------------------------
// Test workspace root (disk-backed, not RAM-backed /tmp)
// ---------------------------------------------------------------------------

const TEST_ROOT = '/mnt/secondary/tmp/researchhq-cli-audit-test';

function freshDir(name: string): string {
  const dir = join(TEST_ROOT, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ---------------------------------------------------------------------------
// Snapshot fixture
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

function makeSnapshot(): PortfolioSnapshot {
  return PortfolioSnapshotSchema.parse({
    schemaVersion: '1.0.0',
    generatedAt: '2026-11-13T00:00:00Z',
    sanitized: false,
    author: {
      name: 'Robin Lovelace',
      role: 'Professor of Transport Data Science',
      affiliation: 'University of Leeds',
      orcid: '0000-0001-5679-6536',
      metrics: {
        worksCount: 3,
        peerReviewedCount: 2,
        citedByCount: 1234,
        citedByScholar: 1500,
        hIndex: 21,
        hIndexScholar: 25,
        i10Index: 40,
        i10IndexScholar: 45,
        oaPercentage: 88.9,
        stageCounts: { '0': 1, '1': 2, '2': 0, '3': 0, '4': 0, '5': 0 },
        updatedAt: '2026-11-13T00:00:00Z',
      },
    },
    publications: [
      makePublication({
        id: 'w-closed',
        title: 'Closed access: high impact study',
        year: 2019,
        type: 'article',
        citations: 120,
        fwci: 3.2,
        openScienceStage: 0,
        openScience: { oaStatus: 'closed' },
      }),
      makePublication({
        id: 'w-oa-no-code',
        title: 'Open access without code',
        year: 2021,
        citations: 60,
        fwci: 1.5,
        openScienceStage: 1,
        openScience: { oaStatus: 'gold' },
      }),
      makePublication({
        id: 'w-repro',
        title: 'Fully reproducible paper',
        year: 2022,
        citations: 30,
        fwci: 2.0,
        openScienceStage: 4,
        openScience: { oaStatus: 'green' },
      }),
    ],
    journals: [],
    plannedPapers: [],
    timeSeries: [],
  });
}

function writeSnapshot(dir: string, relPath: string, snapshot: unknown): string {
  const path = join(dir, relPath);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
  return path;
}

// ---------------------------------------------------------------------------
// Snapshot resolution order
// ---------------------------------------------------------------------------

describe('resolveSnapshotPath', () => {
  const dir = join(TEST_ROOT, 'resolution');

  beforeEach(() => {
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
  });

  it('prefers the explicit --snapshot path', () => {
    const p = writeSnapshot(dir, 'custom/snapshot.json', makeSnapshot());
    expect(resolveSnapshotPath(dir, p)).toBe(p);
  });

  it('falls back to public-data/portfolio.public.json', () => {
    const p = writeSnapshot(dir, 'public-data/portfolio.public.json', makeSnapshot());
    expect(resolveSnapshotPath(dir)).toBe(p);
  });

  it('uses the configured paths.publicExport when present', () => {
    writeSnapshot(dir, 'public-data/portfolio.public.json', makeSnapshot());
    const configured = writeSnapshot(dir, 'exports/public.json', makeSnapshot());
    writeFileSync(
      join(dir, 'researchhq.config.yaml'),
      'author:\n  name: Test\n  role: R\n  affiliation: A\n  orcid: 0000-0000-0000-0000\npaths:\n  publicExport: exports/public.json\n',
      'utf8',
    );
    expect(resolveSnapshotPath(dir)).toBe(configured);
  });

  it('falls back to static/data/portfolio.json', () => {
    const p = writeSnapshot(dir, 'static/data/portfolio.json', makeSnapshot());
    expect(resolveSnapshotPath(dir)).toBe(p);
  });

  it('throws a clear error when no snapshot exists', () => {
    expect(() => resolveSnapshotPath(dir)).toThrow(/No portfolio snapshot found/);
  });
});

// ---------------------------------------------------------------------------
// auditInstance and the text report
// ---------------------------------------------------------------------------

describe('auditInstance and renderAuditReport', () => {
  let dir: string;
  beforeEach(() => {
    dir = freshDir('audit-instance');
    writeSnapshot(dir, 'public-data/portfolio.public.json', makeSnapshot());
  });

  it('computes fwci summary, stage counts, and opportunities', () => {
    const result = auditInstance({ dir });
    expect(result.author.name).toBe('Robin Lovelace');
    expect(result.fwci.evaluatedCount).toBe(3);
    expect(result.fwci.medianFwci).toBe(2.0);
    expect(result.fwci.aboveWorldAverageCount).toBe(3);
    expect(result.stageCounts).toEqual({ '0': 1, '1': 1, '2': 0, '3': 0, '4': 1, '5': 0 });
    expect(result.upgradeOpportunities.length).toBe(2);
    expect(result.upgradeOpportunities[0].publicationId).toBe('w-closed');
    expect(result.upgradeOpportunities[0].currentStage).toBe(0);
    expect(result.upgradeOpportunities[0].targetStage).toBe(1);
  });

  it('honours a custom limit', () => {
    const result = auditInstance({ dir, limit: 1 });
    expect(result.upgradeOpportunities).toHaveLength(1);
  });

  it('renders a crisp text report with author, fwci, stages, and actions', () => {
    const report = renderAuditReport(auditInstance({ dir }));
    expect(report).toContain('ResearchHQ Open Science Audit: Robin Lovelace');
    expect(report).toContain('Affiliation: University of Leeds');
    expect(report).toContain('Total works: 3');
    expect(report).toContain('Peer-reviewed journal articles: 2');
    expect(report).toContain('OpenAlex citations: 1234 | h-index: 21 | i10-index: 40');
    expect(report).toContain('Google Scholar: citations 1500 | h-index 25 | i10-index 45');
    expect(report).toContain('Open access share: 88.9%');
    expect(report).toContain('Field-Weighted Citation Impact (1.00 = world average)');
    expect(report).toContain('Median FWCI: 2.00');
    expect(report).toContain('Above world average: 3 (100%)');
    expect(report).toContain('Stage 0: 1');
    expect(report).toContain('Stage 4: 1');
    expect(report).toContain('[Stage 0 -> Stage 1]');
    expect(report).toContain('120 citations, FWCI 3.20 (2019) Closed access: high impact study');
    expect(report).toContain(
      'Action: Deposit accepted manuscript (Green OA) or record open-access URL',
    );
    expect(report).toContain('Suggested overrides.yaml key: closed-access-high-impact-2019');
    // No em-dashes anywhere in the report.
    expect(report.includes('\u2014')).toBe(false);
  });

  it('reports when there are no upgrade opportunities', () => {
    const snapshot = makeSnapshot();
    for (const publication of snapshot.publications) {
      publication.openScienceStage = 4;
    }
    writeSnapshot(dir, 'public-data/portfolio.public.json', snapshot);
    const report = renderAuditReport(auditInstance({ dir }));
    expect(report).toContain('Open Science Upgrade Opportunities: none');
  });
});

// ---------------------------------------------------------------------------
// runCli audit: text, --json, --help, and bad flags
// ---------------------------------------------------------------------------

describe('runCli audit', () => {
  let dir: string;

  beforeEach(() => {
    dir = freshDir('audit-cli');
    writeSnapshot(dir, 'public-data/portfolio.public.json', makeSnapshot());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function logOutput(): string {
    return vi
      .mocked(console.log)
      .mock.calls.map((c) => c.join(' '))
      .join('\n');
  }

  it('prints the audit report in text mode', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const code = await runCli(['audit', '--dir', dir]);
    expect(code).toBe(0);
    const output = logOutput();
    expect(output).toContain('ResearchHQ Open Science Audit: Robin Lovelace');
    expect(output).toContain('Field-Weighted Citation Impact');
    expect(output).toContain('[Stage 0 -> Stage 1]');
  });

  it('prints machine-readable JSON with --json', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const code = await runCli(['audit', '--dir', dir, '--json']);
    expect(code).toBe(0);
    const output = logOutput();
    const parsed = JSON.parse(output) as {
      author: { name: string };
      fwci: { evaluatedCount: number; medianFwci: number | null };
      stageCounts: Record<string, number>;
      upgradeOpportunities: { publicationId: string }[];
    };
    expect(parsed.author.name).toBe('Robin Lovelace');
    expect(parsed.fwci.evaluatedCount).toBe(3);
    expect(parsed.fwci.medianFwci).toBe(2);
    expect(parsed.stageCounts['0']).toBe(1);
    expect(parsed.stageCounts['4']).toBe(1);
    expect(parsed.upgradeOpportunities.map((o) => o.publicationId)).toEqual([
      'w-closed',
      'w-oa-no-code',
    ]);
    // JSON mode must not also print the text report.
    expect(output).not.toContain('ResearchHQ Open Science Audit:');
  });

  it('honours --limit and --snapshot', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const snapshotPath = writeSnapshot(dir, 'custom/snapshot.json', makeSnapshot());
    const code = await runCli([
      'audit',
      '--dir',
      dir,
      '--snapshot',
      snapshotPath,
      '--limit',
      '1',
    ]);
    expect(code).toBe(0);
    expect(logOutput()).toContain('Open Science Upgrade Opportunities (1):');
  });

  it('prints the audit help for --help', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const code = await runCli(['audit', '--help']);
    expect(code).toBe(0);
    expect(log).toHaveBeenCalledWith(AUDIT_HELP);
  });

  it('rejects a non-integer --limit', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const code = await runCli(['audit', '--dir', dir, '--limit', 'abc']);
    expect(code).toBe(1);
    expect(
      err.mock.calls.map((c) => c.join(' ')).join('\n'),
    ).toContain("expects an integer, got 'abc'");
  });

  it('fails cleanly when no snapshot can be found', async () => {
    const empty = freshDir('audit-cli-empty');
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const code = await runCli(['audit', '--dir', empty]);
    expect(code).toBe(1);
    expect(err.mock.calls.map((c) => c.join(' ')).join('\n')).toContain(
      'No portfolio snapshot found',
    );
  });
});

// ---------------------------------------------------------------------------
// paths.scholarCsv and paths.publicationsYml config fallback
// ---------------------------------------------------------------------------

// Minimal offline bundle for sync tests.
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

const JOURNAL_SOURCE: RawOpenAlexSource = sourceFixture({
  id: 'https://openalex.org/S183347913',
  display_name: 'Journal of Transport & Health',
  type: 'journal',
  summary_stats: { '2yr_mean_citedness': 4.2, h_index: 60, i10_index: 300 },
  is_oa: false,
});

const MOCK_AUTHOR = {
  id: 'https://openalex.org/A9999999999',
  display_name: 'Robin Lovelace',
  works_count: 1,
  cited_by_count: 500,
  summary_stats: { '2yr_mean_citedness': 1.9, h_index: 5, i10_index: 4 },
  last_known_institutions: [{ display_name: 'University of Leeds' }],
};

function workFixture(overrides: Partial<RawOpenAlexWork> & { id: string; display_name: string }): RawOpenAlexWork {
  return {
    doi: '10.1234/config-csv-paper',
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
    ],
    topics: [{ display_name: 'Transport' }],
    abstract_inverted_index: { Hello: [0], world: [1] },
    ...overrides,
  };
}

function bundle(): OfflineBundle {
  return {
    author: MOCK_AUTHOR,
    works: [
      workFixture({ id: 'https://openalex.org/W2000000001', display_name: 'Configured scholar paper' }),
    ],
    sources: { S183347913: JOURNAL_SOURCE },
  };
}

function addConfigPaths(
  dir: string,
  keys: { scholarCsv?: string; publicationsYml?: string } = {},
): void {
  const configPath = join(dir, 'researchhq.config.yaml');
  const parsed = parseYaml(readFileSync(configPath, 'utf8')) as Record<string, unknown>;
  parsed.paths = {
    ...(parsed.paths as Record<string, string> | undefined),
    ...keys,
  };
  writeFileSync(configPath, stringifyYaml(parsed), 'utf8');
}

describe('paths.scholarCsv and paths.publicationsYml config fallback', () => {
  it('sync resolves both files from config when flags are absent', async () => {
    const dir = freshDir('config-fallback');
    initInstance(dir, { name: 'Robin Lovelace', orcid: '0000-0001-5679-6536' });
    addConfigPaths(dir, {
      scholarCsv: 'data/scholar.csv',
      publicationsYml: 'data/publications.yml',
    });
    mkdirSync(join(dir, 'data'), { recursive: true });
    writeFileSync(
      join(dir, 'data', 'scholar.csv'),
      'title,citations_numeric\n"Configured scholar paper",42\n',
      'utf8',
    );
    writeFileSync(
      join(dir, 'data', 'publications.yml'),
      '- title: "Configured scholar paper"\n  abstract: "A richer configured abstract, longer than the OpenAlex reconstruction."\n  doi: 10.1234/config-csv-paper\n',
      'utf8',
    );

    const result = await syncPortfolio(dir, { offlineBundle: bundle() });
    const publication = result.publications.find((p) => p.title === 'Configured scholar paper');
    expect(publication?.citationsScholar).toBe(42);
    expect(publication?.abstract).toContain('richer configured abstract');

    // The instance still validates with both configured files present.
    const validation = validateInstance(dir);
    expect(validation.ok).toBe(true);
    expect(validation.checkedFiles.some((f) => f.includes('scholar.csv'))).toBe(true);
  });

  it('explicit CLI flags still win over config paths', async () => {
    const dir = freshDir('flag-wins');
    initInstance(dir, { name: 'Robin Lovelace', orcid: '0000-0001-5679-6536' });
    addConfigPaths(dir, {
      scholarCsv: 'data/scholar.csv',
      publicationsYml: 'data/publications.yml',
    });
    mkdirSync(join(dir, 'data'), { recursive: true });
    writeFileSync(
      join(dir, 'data', 'scholar.csv'),
      'title,citations_numeric\n"Configured scholar paper",42\n',
      'utf8',
    );
    writeFileSync(
      join(dir, 'data', 'publications.yml'),
      '- title: "Configured scholar paper"\n  abstract: "Configured abstract text."\n',
      'utf8',
    );
    const flagCsv = join(dir, 'flagged.csv');
    writeFileSync(
      flagCsv,
      'title,citations_numeric\n"Configured scholar paper",99\n',
      'utf8',
    );

    const result = await syncPortfolio(dir, {
      offlineBundle: bundle(),
      scholarCsvPath: flagCsv,
    });
    const publication = result.publications.find((p) => p.title === 'Configured scholar paper');
    expect(publication?.citationsScholar).toBe(99);
  });

  it('fails clearly when a configured scholar CSV is missing on disk', async () => {
    const dir = freshDir('missing-scholar');
    initInstance(dir, { name: 'Robin Lovelace', orcid: '0000-0001-5679-6536' });
    addConfigPaths(dir, { scholarCsv: 'data/scholar.csv' });
    // data/scholar.csv deliberately not created.
    await expect(syncPortfolio(dir, { offlineBundle: bundle() })).rejects.toThrow(
      /Configured paths.scholarCsv not found on disk/,
    );
    // validateInstance reports the same problem without throwing.
    const validation = validateInstance(dir);
    expect(validation.ok).toBe(false);
    expect(validation.errors.join('\n')).toContain(
      'configured paths.scholarCsv file does not exist',
    );
  });

  it('fails clearly when a configured publications YAML is missing on disk', async () => {
    const dir = freshDir('missing-pubs');
    initInstance(dir, { name: 'Robin Lovelace', orcid: '0000-0001-5679-6536' });
    addConfigPaths(dir, { publicationsYml: 'data/publications.yml' });
    mkdirSync(join(dir, 'data'), { recursive: true });
    writeFileSync(
      join(dir, 'data', 'scholar.csv'),
      'title,citations_numeric\n"Configured scholar paper",42\n',
      'utf8',
    );
    await expect(syncPortfolio(dir, { offlineBundle: bundle() })).rejects.toThrow(
      /Configured paths.publicationsYml not found on disk/,
    );
  });

  it('validateInstance checks a configured scholar CSV that parses cleanly', () => {
    const dir = freshDir('clean-scholar');
    initInstance(dir, { name: 'Robin Lovelace', orcid: '0000-0001-5679-6536' });
    addConfigPaths(dir, { scholarCsv: 'data/scholar.csv' });
    mkdirSync(join(dir, 'data'), { recursive: true });
    writeFileSync(join(dir, 'data', 'scholar.csv'), 'title,cites\n"Some paper",7\n', 'utf8');
    const validation = validateInstance(dir);
    expect(validation.ok).toBe(true);
    expect(validation.checkedFiles).toContain(join(dir, 'data', 'scholar.csv'));
  });
});
