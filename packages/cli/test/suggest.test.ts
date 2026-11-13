/**
 * Vitest tests for suggest-journals: term/DOI extraction, mega-journal size
 * dampening, OA filters, --write-targets round-trip through validateInstance,
 * --json CLI output (mocked OpenAlex client, zero live network calls), and
 * the init --force error text plus comment-preserving planned paper edits.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  addPlannedPaper,
  cleanUrlToken,
  extractCitedDois,
  extractCitedDoisForSuggest,
  extractSearchTerms,
  formatSuggestJournalsReport,
  initInstance,
  parseBibEntries,
  runCli,
  setSuggestClientFactory,
  suggestJournals,
  updatePlannedPaper,
  validateInstance,
  type RawOpenAlexSource,
  type RawOpenAlexWork,
  type SuggestOpenAlexPort,
} from '../src/index.js';

// ---------------------------------------------------------------------------
// Test workspace root (disk-backed, not RAM-backed /tmp)
// ---------------------------------------------------------------------------

const TEST_ROOT = '/mnt/secondary/tmp/researchhq-suggest-test';

function freshDir(name: string): string {
  const dir = join(TEST_ROOT, name);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}

// ---------------------------------------------------------------------------
// Fixtures: a focused journal and a mega-journal with a 10x larger raw count
// ---------------------------------------------------------------------------

const FOCUSED_SOURCE: RawOpenAlexSource = {
  id: 'https://openalex.org/S111111111',
  display_name: 'Journal of Focused Cycling Safety',
  issn: ['1234-5679'],
  type: 'journal',
  is_oa: true,
  is_in_doaj: true,
  apc_usd: 0,
  works_count: 1200,
  cited_by_count: 40000,
  summary_stats: { '2yr_mean_citedness': 3.4, h_index: 55, i10_index: 300 },
};

const MEGA_SOURCE: RawOpenAlexSource = {
  id: 'https://openalex.org/S222222222',
  display_name: 'Mega Journal of Everything',
  issn: ['9876-5432'],
  type: 'journal',
  is_oa: true,
  is_in_doaj: false,
  apc_usd: 1600,
  works_count: 8_000_000,
  cited_by_count: 900_000,
  summary_stats: { '2yr_mean_citedness': 1.1, h_index: 400, i10_index: 9000 },
};

function workFixture(id: string, source: RawOpenAlexSource): RawOpenAlexWork {
  return {
    id,
    doi: null,
    display_name: `Nearest work ${id}`,
    publication_year: 2025,
    publication_date: '2025-01-01',
    type: 'article',
    cited_by_count: 3,
    open_access: { is_oa: true, oa_status: 'gold' },
    primary_location: { source, landing_page_url: `https://example.org/${id}` },
    locations: [{ source }],
    authorships: [],
    topics: [],
    abstract_inverted_index: null,
  };
}

class MockOpenAlexClient implements SuggestOpenAlexPort {
  constructor(
    private readonly groups: Array<{ sourceId: string; displayName: string; count: number }>,
    private readonly nearest: RawOpenAlexWork[],
    private readonly cited: RawOpenAlexWork[],
  ) {}

  async groupWorksBySource(): Promise<
    Array<{ sourceId: string; displayName: string; count: number }>
  > {
    return this.groups;
  }

  async searchNearestWorks(): Promise<RawOpenAlexWork[]> {
    return this.nearest;
  }

  async fetchWorksByDois(): Promise<RawOpenAlexWork[]> {
    return this.cited;
  }

  async fetchSourcesByIds(ids: string[]): Promise<Map<string, RawOpenAlexSource>> {
    const byShort = new Map(
      [FOCUSED_SOURCE, MEGA_SOURCE].map((s) => [s.id.split('/').pop() ?? '', s]),
    );
    const out = new Map<string, RawOpenAlexSource>();
    for (const id of ids) {
      const source = byShort.get(id);
      if (source) out.set(id, source);
    }
    return out;
  }
}

function defaultMock(): MockOpenAlexClient {
  const focused = 'https://openalex.org/S111111111'.split('/').pop() ?? '';
  const mega = 'https://openalex.org/S222222222'.split('/').pop() ?? '';
  return new MockOpenAlexClient(
    // Raw group counts: the mega-journal has 12.5x more matching articles.
    [
      { sourceId: focused, displayName: 'Journal of Focused Cycling Safety', count: 800 },
      { sourceId: mega, displayName: 'Mega Journal of Everything', count: 10_000 },
    ],
    [
      workFixture('https://openalex.org/W1', FOCUSED_SOURCE),
      workFixture('https://openalex.org/W2', FOCUSED_SOURCE),
      workFixture('https://openalex.org/W3', FOCUSED_SOURCE),
      workFixture('https://openalex.org/W4', MEGA_SOURCE),
    ],
    // Two cited DOIs land in the focused journal.
    [
      workFixture('https://openalex.org/W10', FOCUSED_SOURCE),
      workFixture('https://openalex.org/W11', FOCUSED_SOURCE),
    ],
  );
}

const TITLE = 'Prioritising cycle network safety interventions for school travel';

async function suggest(dir: string, extra: Record<string, unknown> = {}, client = defaultMock()) {
  return suggestJournals(
    {
      dir,
      title: TITLE,
      ...extra,
    },
    client,
  );
}

// ---------------------------------------------------------------------------

beforeEach(() => {
  rmSync(TEST_ROOT, { recursive: true, force: true });
  mkdirSync(TEST_ROOT, { recursive: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('extractSearchTerms', () => {
  it('strips URLs, punctuation, stopwords, and numbers', () => {
    const terms = extractSearchTerms([
      'Read more at https://example.org/loop?x=1 and doi: 10.1234/abc',
      'Prioritising, cycle-network safety! Analysis of school travel: 42 riders',
      'a of the and using based novel approach to cycling',
    ]);
    expect(terms).not.toContain('using');
    expect(terms).not.toContain('approach');
    expect(terms).toContain('prioritising');
    expect(terms).toContain('cycle-network');
    expect(terms).toContain('safety');
    expect(terms).toContain('school');
    expect(terms).toContain('travel');
    expect(terms.every((t) => !t.includes('/') && !t.includes('http'))).toBe(true);
    expect(terms.length).toBeLessThanOrEqual(20);
  });

  it('caps the term list at 20', () => {
    const terms = extractSearchTerms([Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ')]);
    expect(terms).toHaveLength(20);
  });
});

describe('extractCitedDois and bib parsing', () => {
  it('extracts and normalizes DOIs from prose', () => {
    const dois = extractCitedDois([
      'See https://doi.org/10.1234/Alpha-One and 10.5678/beta.two.',
      'not a doi: 11.9999/x',
    ]);
    expect(dois).toContain('10.1234/alpha-one');
    expect(dois).toContain('10.5678/beta.two');
    expect(dois).toHaveLength(2);
  });

  it('parses doi fields from a bib file and targets referenced citekeys', () => {
    const bib = [
      '@article{lovelace2024cruse,',
      '  title = {Cycle Route Uptake},',
      '  doi = {10.9999/CRUSE.2024},',
      '}',
      '@book{smith2020city,',
      '  title = {City Networks},',
      '  doi = "10.8888/city",',
      '}',
    ].join('\n');
    const entries = parseBibEntries(bib);
    expect(entries.map((e) => e.key).sort()).toEqual(['lovelace2024cruse', 'smith2020city']);

    const targeted = extractCitedDoisForSuggest(['@lovelace2024cruse'], bib);
    expect(targeted).toEqual(['10.9999/cruse.2024']);

    const all = extractCitedDoisForSuggest(['nothing cited here'], bib);
    expect(all.sort()).toEqual(['10.8888/city', '10.9999/cruse.2024']);
  });
});

describe('cleanUrlToken (sync URL hardening)', () => {
  it('takes the first valid http(s) token from space-separated URLs', () => {
    expect(cleanUrlToken('https://a.org/x https://b.org/y')).toBe('https://a.org/x');
    expect(cleanUrlToken('Visit https://a.org/x now')).toBe('https://a.org/x');
    expect(cleanUrlToken('no url here')).toBeNull();
    expect(cleanUrlToken('ftp://nope.example')).toBeNull();
  });
});

describe('suggestJournals scoring', () => {
  it('ranks the focused journal above the size-dampened mega-journal', async () => {
    const dir = freshDir('scoring');
    initInstance(dir);
    addPlannedPaper(dir, {
      slug: 'score-paper',
      title: TITLE,
      keyCitations: ['10.1234/alpha-one', '10.1234/alpha-two'],
    });
    const result = await suggest(dir, { slug: 'score-paper' });
    expect(result.citedDoiCount).toBe(2);
    expect(result.resolvedDoiCount).toBe(2);
    expect(result.candidates).toHaveLength(2);
    expect(result.query).toContain('prioritising');
    expect(result.query).toContain('school');
    const [top, second] = result.candidates;
    expect(top?.journalName).toBe('Journal of Focused Cycling Safety');
    expect(top?.targetCandidate?.rank).toBe(1);
    expect(second?.targetCandidate?.rank).toBe(2);
    // Dampening: the mega-journal's raw group count is 12.5x larger, yet its
    // topical score stays well below the focused journal's.
    expect(top?.topicalScore).toBe(45);
    expect(top?.topicalScore).toBeGreaterThan(second?.topicalScore ?? 0);
    expect(top?.bibliographyScore).toBe(30);
    expect(second?.bibliographyScore).toBe(0);
    expect(top?.fitScore).toBe(83);
    expect(top?.fitScore).toBeGreaterThan(second?.fitScore ?? 0);
    expect(top?.fitScore).toBeLessThanOrEqual(100);
    // The OA-but-not-DOAJ mega-journal carries the Think.Check.Submit warning.
    expect(second?.warnings).toContain(
      'Not listed in DOAJ: verify with Think.Check.Submit before submitting',
    );
  });

  it('applies --diamond-only, --doaj-only, and --max-apc filters', async () => {
    const dir = freshDir('filters');
    initInstance(dir);
    const diamond = await suggest(dir, { diamondOnly: true });
    expect(diamond.candidates.map((c) => c.journalName)).toEqual([
      'Journal of Focused Cycling Safety',
    ]);
    const doaj = await suggest(dir, { doajOnly: true });
    expect(doaj.candidates.map((c) => c.journalName)).toEqual([
      'Journal of Focused Cycling Safety',
    ]);
    const apc = await suggest(dir, { maxApcUsd: 100 });
    expect(apc.candidates.map((c) => c.journalName)).toEqual([
      'Journal of Focused Cycling Safety',
    ]);
    const all = await suggest(dir, { oaOnly: true });
    expect(all.candidates).toHaveLength(2);
  });

  it('throws a clear usage error without slug or title', async () => {
    const dir = freshDir('usage');
    initInstance(dir);
    await expect(suggestJournals({ dir }, defaultMock())).rejects.toThrow(/--slug or --title/);
  });

  it('throws when --write-targets is used without --slug', async () => {
    const dir = freshDir('write-no-slug');
    initInstance(dir);
    await expect(
      suggestJournals({ dir, title: TITLE, writeTargets: true }, defaultMock()),
    ).rejects.toThrow(/--write-targets requires --slug/);
  });
});

describe('suggest-journals with a planned paper slug and --write-targets', () => {
  it('writes top candidates and keeps researchhq validate green', async () => {
    const dir = freshDir('write-targets');
    initInstance(dir);
    addPlannedPaper(dir, {
      slug: 'school-cycling',
      title: TITLE,
      summary: 'Cycle network safety and school travel planning',
      keyCitations: ['@lovelace2024cruse', 'also 10.1234/alpha-one'],
    });
    const bibPath = join(dir, 'refs.bib');
    writeFileSync(
      bibPath,
      '@article{lovelace2024cruse,\n  doi = {10.9999/cruse-2024},\n}\n',
      'utf8',
    );
    const result = await suggest(dir, { slug: 'school-cycling', bibPath, writeTargets: true });
    expect(result.paperSlug).toBe('school-cycling');
    expect(result.citedDoiCount).toBe(2); // 10.1234/alpha-one + 10.9999/cruse-2024
    expect(result.resolvedDoiCount).toBe(2);
    expect(result.wroteTargets).toBe(true);

    const papersYaml = readFileSync(join(dir, 'data', 'planned-papers.yaml'), 'utf8');
    expect(papersYaml).toContain('journalId: journal-of-focused-cycling-safety');
    expect(papersYaml).toContain('rank: 1');
    expect(papersYaml).toContain('fitScore: 83');
    const metricsYaml = readFileSync(join(dir, 'data', 'journal-metrics.yaml'), 'utf8');
    expect(metricsYaml).toContain('mega-journal-of-everything');
    expect(metricsYaml).toContain('openalexSourceId: S222222222');

    const validation = validateInstance(dir);
    expect(validation.errors).toEqual([]);
    expect(validation.ok).toBe(true);
  });
});

describe('suggest-journals CLI --json output', () => {
  it('prints parseable JSON from runCli with a mocked client', async () => {
    const dir = freshDir('cli-json');
    initInstance(dir);
    setSuggestClientFactory(() => defaultMock());
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    });
    const code = await runCli([
      'suggest-journals',
      '--title',
      TITLE,
      '--dir',
      dir,
      '--json',
    ]);
    spy.mockRestore();
    expect(code).toBe(0);
    const parsed = JSON.parse(logs.join('\n')) as {
      query: string;
      candidates: Array<{ journalName: string; fitScore: number }>;
    };
    expect(parsed.query).toContain('safety');
    expect(parsed.candidates[0]?.journalName).toBe('Journal of Focused Cycling Safety');
  });

  it('prints the aligned text report without --json', async () => {
    const dir = freshDir('cli-text');
    initInstance(dir);
    setSuggestClientFactory(() => defaultMock());
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    });
    const code = await runCli(['suggest-journals', '--title', TITLE, '--dir', dir]);
    spy.mockRestore();
    expect(code).toBe(0);
    const report = logs.join('\n');
    expect(report).toContain('Journal of Focused Cycling Safety');
    expect(report).toContain('Why Journal of Focused Cycling Safety');
    expect(report).toContain('DORA reminder');
    expect(report).toContain('openpolicyfinder.jisc.ac.uk');
  });

  it('shows suggest-journals help text', async () => {
    const logs: string[] = [];
    const spy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      logs.push(args.map(String).join(' '));
    });
    const code = await runCli(['suggest-journals', '--help']);
    spy.mockRestore();
    expect(code).toBe(0);
    expect(logs.join('\n')).toContain('publisher-neutral target journal recommendation');
  });
});

describe('formatSuggestJournalsReport', () => {
  it('renders aligned columns and a DORA footer', async () => {
    const dir = freshDir('report');
    initInstance(dir);
    const result = await suggest(dir);
    const report = formatSuggestJournalsReport(result);
    expect(report).toContain('Rank');
    expect(report).toContain('diamond');
    expect(report).toContain('Warning: Not listed in DOAJ');
    expect(report).not.toMatch(/\u2014/);
  });
});

describe('CLI polish fixes', () => {
  it('init suggests --force, not force: true', () => {
    const dir = freshDir('force');
    initInstance(dir);
    expect(() => initInstance(dir)).toThrow(/pass --force/);
    expect(() => initInstance(dir)).not.toThrow(/force: true/);
  });

  it('update-idea preserves inline comments on untouched entries', () => {
    const dir = freshDir('comments');
    initInstance(dir);
    addPlannedPaper(dir, { slug: 'alpha', title: 'Alpha Paper' });
    addPlannedPaper(dir, { slug: 'beta', title: 'Beta Paper' });
    const papersPath = join(dir, 'data', 'planned-papers.yaml');
    const withComment = readFileSync(papersPath, 'utf8').replace(
      'slug: beta',
      'slug: beta  # keep this inline comment',
    );
    writeFileSync(papersPath, withComment, 'utf8');
    updatePlannedPaper(dir, 'alpha', { status: 'scoping', readinessPercent: 40 });
    const after = readFileSync(papersPath, 'utf8');
    expect(after).toContain('# keep this inline comment');
    expect(after).toContain('status: scoping');
    const validation = validateInstance(dir);
    expect(validation.ok).toBe(true);
  });
});
