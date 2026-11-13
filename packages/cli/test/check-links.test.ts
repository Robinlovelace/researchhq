/**
 * Offline Vitest tests for `checkPublicUrls` (researchhq validate
 * --check-links): URL collection from planned papers and overrides, private
 * and redacted repo link skipping, HEAD-to-GET fallback, and 404 failure
 * reporting. Every probe runs against a mock fetchImpl: zero live network
 * calls.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { checkPublicUrls } from '../src/sync.js';

const TEST_ROOT = join(tmpdir(), `researchhq-cli-check-links-test-${process.pid}`);

const createdDirs: string[] = [];

function makeInstance(
  name: string,
  papersYaml: string,
  overridesYaml?: string,
): string {
  const dir = join(TEST_ROOT, name);
  mkdirSync(join(dir, 'data'), { recursive: true });
  writeFileSync(join(dir, 'data', 'planned-papers.yaml'), papersYaml, 'utf8');
  if (overridesYaml !== undefined) {
    writeFileSync(join(dir, 'data', 'overrides.yaml'), overridesYaml, 'utf8');
  }
  createdDirs.push(dir);
  return dir;
}

afterEach(() => {
  createdDirs.length = 0;
});

interface RecordedCall {
  url: string;
  method: string;
}

interface MockRoute {
  head?: number;
  get?: number;
}

/**
 * Build a mock fetchImpl keyed by URL. Routes without an entry for the
 * requested method throw (so unexpected probes fail loudly instead of
 * silently passing).
 */
function mockFetch(
  routes: Record<string, MockRoute>,
  calls: RecordedCall[] = [],
): typeof fetch {
  const impl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input instanceof Request ? input.url : input);
    const method = (init?.method ?? 'GET').toUpperCase();
    calls.push({ url, method });
    const route = routes[url];
    if (!route) {
      throw new Error(`mock fetch: unexpected URL ${url} (${method})`);
    }
    const status = method === 'HEAD' ? route.head : route.get;
    if (status === undefined) {
      throw new Error(`mock fetch: no ${method} status configured for ${url}`);
    }
    return new Response(null, { status });
  };
  return impl as unknown as typeof fetch;
}

/** Minimal schema-valid planned paper fixture. */
function paperYaml(slugs: string[]): string {
  const entries = slugs.map((slug) => `  - slug: ${slug}
    title: Demo paper ${slug}
    shortTitle: Demo ${slug}
    category: literature-gap
    status: scoping
    readinessPercent: 10
    targetSubmissionQuarter: '2027-Q2'
    targetPublicationYear: 2027
    targetOpenScienceStage: 5
    currentOpenScienceStage: 2
    summary: Demo summary for ${slug}.
    methodologyHighlights: []
    keyCitations: []
    collaborators: []
    repoUrls: []
    interactiveToolUrl: null
    nextMilestones: []
    targetJournals: []
    privateNotes: null`);
  return `plannedPapers:\n${entries.join('\n')}\n`;
}

describe('checkPublicUrls', () => {
  it('skips private and redactUrlInPublic repo links entirely', async () => {
    const papersYaml = paperYaml(['demo-skip']).replace(
      '    repoUrls: []',
      `    repoUrls:
      - label: Public code
        url: https://example.com/demo-public
        visibility: public
      - label: Private mirror
        url: https://private.example.com/demo
        visibility: private
      - label: Redacted repo
        url: https://redact.example.com/demo
        redactUrlInPublic: true`,
    );
    const dir = makeInstance('skip-private', papersYaml);
    const calls: RecordedCall[] = [];
    const result = await checkPublicUrls(
      dir,
      mockFetch({ 'https://example.com/demo-public': { head: 200 } }, calls),
    );
    expect(result.checked).toBe(1);
    expect(result.failures).toHaveLength(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ url: 'https://example.com/demo-public', method: 'HEAD' });
  });

  it('falls back to GET when HEAD returns 405 and passes on 200', async () => {
    const papersYaml = paperYaml(['demo-fallback']).replace(
      '    repoUrls: []',
      '    repoUrls:\n      - label: Code\n        url: https://example.com/fallback',
    );
    const dir = makeInstance('fallback-get', papersYaml);
    const calls: RecordedCall[] = [];
    const result = await checkPublicUrls(
      dir,
      mockFetch({ 'https://example.com/fallback': { head: 405, get: 200 } }, calls),
    );
    expect(result.checked).toBe(1);
    expect(result.failures).toHaveLength(0);
    expect(calls.map((c) => c.method)).toEqual(['HEAD', 'GET']);
  });

  it('reports a 404 public repo link with the paper slug and URL', async () => {
    const papersYaml = paperYaml(['demo-dead-link']).replace(
      '    repoUrls: []',
      '    repoUrls:\n      - label: Code\n        url: https://example.com/dead-repo',
    );
    const dir = makeInstance('dead-link', papersYaml);
    const result = await checkPublicUrls(
      dir,
      mockFetch({ 'https://example.com/dead-repo': { head: 404 } }),
    );
    expect(result.checked).toBe(1);
    expect(result.failures).toHaveLength(1);
    const failure = result.failures[0]!;
    expect(failure.status).toBe(404);
    expect(failure.url).toBe('https://example.com/dead-repo');
    expect(failure.source).toContain('demo-dead-link');
    // The CLI renders this as: Broken public URL [404] in <source>: <url>
    const message = `Broken public URL [${failure.status}] in ${failure.source}: ${failure.url}`;
    expect(message).toContain('demo-dead-link');
    expect(message).toContain('https://example.com/dead-repo');
  });

  it('collects non-empty override codeUrl and dedupes repeated URLs', async () => {
    const papersYaml = paperYaml(['demo-overrides']).replace(
      '    repoUrls: []',
      '    repoUrls:\n      - label: Code\n        url: https://example.com/shared-repo',
    );
    const overridesYaml = `overrides:
  leeds-cycling:
    titleMatch: Cycling
    codeUrl: https://example.com/shared-repo
    dataUrl: https://example.com/override-data
`;
    const dir = makeInstance('override-urls', papersYaml, overridesYaml);
    const result = await checkPublicUrls(
      dir,
      mockFetch({
        'https://example.com/shared-repo': { head: 200 },
        'https://example.com/override-data': { head: 200 },
      }),
    );
    // The shared URL appears in both the paper and the override but is probed once.
    expect(result.checked).toBe(2);
    expect(result.failures).toHaveLength(0);
  });

  it('treats a network throw as a string-status failure', async () => {
    const papersYaml = paperYaml(['demo-network-error']).replace(
      '    repoUrls: []',
      '    repoUrls:\n      - label: Code\n        url: https://example.com/unreachable',
    );
    const dir = makeInstance('network-error', papersYaml);
    const failing = (async (): Promise<Response> => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    const result = await checkPublicUrls(dir, failing);
    expect(result.checked).toBe(1);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]!.status).toContain('ECONNREFUSED');
    expect(result.failures[0]!.source).toContain('demo-network-error');
  });

  it('reports an empty checked set for an instance with no public URLs', async () => {
    const dir = makeInstance('no-urls', paperYaml(['demo-empty']));
    const calls: RecordedCall[] = [];
    const result = await checkPublicUrls(dir, mockFetch({}, calls));
    expect(result.checked).toBe(0);
    expect(result.failures).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });
});
