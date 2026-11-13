/**
 * Vitest unit tests for the Wave 4B audit analytics in @researchhq/schema:
 * computeFwciSummary (Field-Weighted Citation Impact) and
 * computeOpenScienceGaps (open science upgrade opportunity engine).
 */
import { describe, expect, it } from 'vitest';

import {
  computeFwciSummary,
  computeOpenScienceGaps,
  PublicationSchema,
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

// ---------------------------------------------------------------------------
// computeFwciSummary
// ---------------------------------------------------------------------------

describe('computeFwciSummary', () => {
  it('returns the empty summary when no publication has a usable fwci', () => {
    // NaN and Infinity pass the type but fail the Number.isFinite guard;
    // they bypass Zod (which rejects non-finite numbers) via a direct cast.
    const nonFinite = (fwci: number): Publication =>
      ({ ...makePublication({ fwci: 1 }), fwci }) as Publication;
    for (const publications of [
      [],
      [makePublication({ fwci: null })],
      [makePublication({ fwci: 0 })],
      [makePublication({ fwci: -1.5 })],
      [nonFinite(Number.NaN)],
      [nonFinite(Number.POSITIVE_INFINITY)],
    ]) {
      expect(computeFwciSummary(publications)).toEqual({
        evaluatedCount: 0,
        medianFwci: null,
        meanFwci: null,
        maxFwci: null,
        aboveWorldAverageCount: 0,
        aboveWorldAverageShare: null,
      });
    }
  });

  it('computes median, mean, max, and above-world-average share for odd counts', () => {
    const summary = computeFwciSummary([
      makePublication({ id: 'a', fwci: 0.5 }),
      makePublication({ id: 'b', fwci: 3.0 }),
      makePublication({ id: 'c', fwci: 1.5 }),
    ]);
    expect(summary.evaluatedCount).toBe(3);
    expect(summary.medianFwci).toBe(1.5);
    expect(summary.meanFwci).toBeCloseTo(1.67, 2);
    expect(summary.maxFwci).toBe(3.0);
    expect(summary.aboveWorldAverageCount).toBe(2);
    // 2/3 above 1.0, rounded to 1 decimal place.
    expect(summary.aboveWorldAverageShare).toBe(66.7);
  });

  it('averages the two middle values for an even count', () => {
    const summary = computeFwciSummary([
      makePublication({ id: 'a', fwci: 1.0 }),
      makePublication({ id: 'b', fwci: 2.0 }),
      makePublication({ id: 'c', fwci: 3.0 }),
      makePublication({ id: 'd', fwci: 4.0 }),
    ]);
    expect(summary.medianFwci).toBe(2.5);
    expect(summary.meanFwci).toBe(2.5);
    expect(summary.maxFwci).toBe(4.0);
    // Exactly 1.0 is not above the world average.
    expect(summary.aboveWorldAverageCount).toBe(3);
    expect(summary.aboveWorldAverageShare).toBe(75);
  });

  it('rounds median, mean, and max to 2 decimal places', () => {
    const summary = computeFwciSummary([
      makePublication({ fwci: 1.111 }),
      makePublication({ fwci: 1.222 }),
      makePublication({ fwci: 2.3456 }),
    ]);
    expect(summary.medianFwci).toBe(1.22);
    expect(summary.meanFwci).toBeCloseTo(1.56, 2);
    expect(summary.meanFwci).toBe(1.56);
    expect(summary.maxFwci).toBe(2.35);
  });

  it('rounds the above-world-average share to 1 decimal place', () => {
    const summary = computeFwciSummary([
      makePublication({ fwci: 2.0 }),
      makePublication({ fwci: 0.5 }),
      makePublication({ fwci: 0.7 }),
      makePublication({ fwci: 0.3 }),
      makePublication({ fwci: 0.1 }),
    ]);
    expect(summary.aboveWorldAverageCount).toBe(1);
    expect(summary.aboveWorldAverageShare).toBe(20);
  });
});

// ---------------------------------------------------------------------------
// computeOpenScienceGaps
// ---------------------------------------------------------------------------

describe('computeOpenScienceGaps', () => {
  it('only considers articles, books, and book chapters below Stage 4', () => {
    const opportunities = computeOpenScienceGaps([
      makePublication({ id: 'included', type: 'article', openScienceStage: 2 }),
      makePublication({ id: 'book', type: 'book', openScienceStage: 1 }),
      makePublication({ id: 'chapter', type: 'book-chapter', openScienceStage: 0 }),
      makePublication({ id: 'preprint', type: 'preprint', openScienceStage: 0 }),
      makePublication({ id: 'software', type: 'software', openScienceStage: 0 }),
      makePublication({ id: 'report', type: 'report', openScienceStage: 0 }),
      makePublication({ id: 'stage4', type: 'article', openScienceStage: 4 }),
      makePublication({ id: 'stage5', type: 'article', openScienceStage: 5 }),
    ]);
    const ids = opportunities.map((o) => o.publicationId).sort();
    expect(ids).toEqual(['book', 'chapter', 'included']);
  });

  it('scores candidates by citations plus fwci * 5, descending', () => {
    const opportunities = computeOpenScienceGaps([
      // Score 15: citations only.
      makePublication({ id: 'b', citations: 15, fwci: null }),
      // Score 20: 10 citations + 2.0 fwci * 5.
      makePublication({ id: 'a', citations: 10, fwci: 2.0 }),
      // Score 12.
      makePublication({ id: 'c', citations: 12, fwci: 0 }),
    ]);
    expect(opportunities.map((o) => o.publicationId)).toEqual(['a', 'b', 'c']);
    expect(opportunities[0].fwci).toBe(2.0);
    expect(opportunities[1].fwci).toBeNull();
  });

  it('breaks score ties by year descending then title ascending', () => {
    const opportunities = computeOpenScienceGaps([
      makePublication({ id: 'old', title: 'Beta paper', year: 2010, citations: 10 }),
      makePublication({ id: 'newer', title: 'Gamma paper', year: 2020, citations: 10 }),
      makePublication({ id: 'alpha', title: 'Alpha paper', year: 2020, citations: 10 }),
    ]);
    expect(opportunities.map((o) => o.publicationId)).toEqual([
      'alpha',
      'newer',
      'old',
    ]);
  });

  it('respects the limit, defaults to 10, and never returns negative slices', () => {
    const many = Array.from({ length: 15 }, (_, i) =>
      makePublication({ id: `w-${i}`, citations: 100 - i }),
    );
    expect(computeOpenScienceGaps(many)).toHaveLength(10);
    expect(computeOpenScienceGaps(many, 3)).toHaveLength(3);
    expect(computeOpenScienceGaps(many, 0)).toHaveLength(0);
    expect(computeOpenScienceGaps(many, -5)).toHaveLength(0);
    expect(computeOpenScienceGaps(many, 3)[0].publicationId).toBe('w-0');
  });

  it('maps each current stage to its target stage and action label', () => {
    const opportunities = computeOpenScienceGaps([
      makePublication({ id: 's0', openScienceStage: 0 }),
      makePublication({ id: 's1', openScienceStage: 1 }),
      makePublication({ id: 's2', openScienceStage: 2 }),
      makePublication({ id: 's3', openScienceStage: 3 }),
    ]);
    const byId = new Map(opportunities.map((o) => [o.publicationId, o]));
    expect(byId.get('s0')?.targetStage).toBe(1);
    expect(byId.get('s0')?.actionLabel).toBe(
      'Deposit accepted manuscript (Green OA) or record open-access URL',
    );
    expect(byId.get('s1')?.targetStage).toBe(3);
    expect(byId.get('s1')?.actionLabel).toBe(
      'Link open analysis scripts or software repository (codeUrl in overrides.yaml)',
    );
    expect(byId.get('s2')?.targetStage).toBe(3);
    expect(byId.get('s2')?.actionLabel).toBe(
      'Publish and link analysis code alongside existing open dataset',
    );
    expect(byId.get('s3')?.targetStage).toBe(4);
    expect(byId.get('s3')?.actionLabel).toBe(
      'Link reproducible Quarto/RMarkdown manuscript repo (reproducibleRepoUrl)',
    );
  });

  it('suggests a clean lowercase overrides.yaml key from the first 4 words plus year', () => {
    const opportunities = computeOpenScienceGaps([
      makePublication({
        id: 'w1',
        title: 'Truncate, Replicate: Sample (A) - Long Title Continues Here',
        year: 2013,
        doi: '10.1234/truncate',
        citations: 7,
      }),
    ]);
    expect(opportunities).toHaveLength(1);
    expect(opportunities[0].overrideKeySuggestion).toBe(
      'truncate-replicate-sample-a-2013',
    );
    expect(opportunities[0].doi).toBe('10.1234/truncate');
    expect(opportunities[0].citations).toBe(7);
    expect(opportunities[0].currentStage).toBe(3);
    expect(opportunities[0].targetStage).toBe(4);
  });

  it('returns an empty array for empty input', () => {
    expect(computeOpenScienceGaps([])).toEqual([]);
  });
});
