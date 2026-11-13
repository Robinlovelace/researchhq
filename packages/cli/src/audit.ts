/**
 * ResearchHQ audit: load a portfolio snapshot and report author citation
 * metrics, Field-Weighted Citation Impact (FWCI), the 5-stage open science
 * distribution, and the highest-impact open science upgrade opportunities.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  computeFwciSummary,
  computeOpenScienceGaps,
  computeStageCounts,
  OPEN_SCIENCE_STAGE_DESCRIPTIONS,
  PortfolioSnapshotSchema,
  type AuthorProfile,
  type FwciSummary,
  type OpenScienceUpgradeOpportunity,
  type PortfolioSnapshot,
  type StageCounts,
} from '@researchhq/schema';
import { loadConfig } from './sync.js';

export interface AuditOptions {
  /** Instance directory to resolve the snapshot from (default '.'). */
  dir?: string;
  /** Explicit snapshot JSON path; overrides the resolution order. */
  snapshotPath?: string;
  /** Maximum number of upgrade opportunities (default 8). */
  limit?: number;
}

export interface AuditResult {
  snapshotPath: string;
  author: AuthorProfile;
  fwci: FwciSummary;
  stageCounts: StageCounts;
  upgradeOpportunities: OpenScienceUpgradeOpportunity[];
}

/**
 * Resolve the snapshot JSON path: explicit path wins, then the configured
 * publicExport from researchhq.config.yaml, then the two conventional
 * locations (public-data/portfolio.public.json and static/data/portfolio.json).
 */
export function resolveSnapshotPath(dir: string, explicitPath?: string): string {
  if (explicitPath) {
    return resolve(explicitPath);
  }
  const configured = resolveConfiguredPublicExport(dir);
  const candidates = [
    ...(configured ? [configured] : []),
    join(dir, 'public-data', 'portfolio.public.json'),
    join(dir, 'static', 'data', 'portfolio.json'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    `No portfolio snapshot found for ${dir}. Pass --snapshot <path> or run 'researchhq sync' first.`,
  );
}

/**
 * Read config.paths.publicExport from researchhq.config.yaml when the config
 * file exists; returns null otherwise (the config is optional for audit).
 */
function resolveConfiguredPublicExport(dir: string): string | null {
  const configPath = join(dir, 'researchhq.config.yaml');
  if (!existsSync(configPath)) return null;
  try {
    const config = loadConfig(dir);
    return config.paths?.publicExport ? resolve(dir, config.paths.publicExport) : null;
  } catch {
    return null;
  }
}

/**
 * Run the audit: resolve and validate the snapshot, then compute the FWCI
 * summary, open science stage counts, and ranked upgrade opportunities.
 */
export function auditInstance(options: AuditOptions = {}): AuditResult {
  const dir = options.dir ?? '.';
  const snapshotPath = resolveSnapshotPath(dir, options.snapshotPath);
  const snapshot = loadSnapshot(snapshotPath);
  return {
    snapshotPath,
    author: snapshot.author,
    fwci: computeFwciSummary(snapshot.publications),
    stageCounts: computeStageCounts(snapshot.publications),
    upgradeOpportunities: computeOpenScienceGaps(
      snapshot.publications,
      options.limit ?? 8,
    ),
  };
}

/** Parse and schema-validate a snapshot JSON file. */
export function loadSnapshot(snapshotPath: string): PortfolioSnapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(snapshotPath, 'utf8')) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot read snapshot ${snapshotPath}: ${message}`);
  }
  return PortfolioSnapshotSchema.parse(raw);
}

function fmt(value: number | null | undefined, digits = 2): string {
  if (value === undefined || value === null || !Number.isFinite(value)) {
    return 'n/a';
  }
  return value.toFixed(digits);
}

/**
 * Render the human-readable terminal audit report (plain text, no ANSI).
 */
export function renderAuditReport(result: AuditResult): string {
  const { author, fwci, stageCounts, upgradeOpportunities } = result;
  const m = author.metrics;
  const scholarBits: string[] = [];
  if (typeof m.citedByScholar === 'number') {
    scholarBits.push(`citations ${m.citedByScholar}`);
  }
  if (typeof m.hIndexScholar === 'number') {
    scholarBits.push(`h-index ${m.hIndexScholar}`);
  }
  if (typeof m.i10IndexScholar === 'number') {
    scholarBits.push(`i10-index ${m.i10IndexScholar}`);
  }

  const lines: string[] = [];
  lines.push(`ResearchHQ Open Science Audit: ${author.name}`);
  lines.push(`Affiliation: ${author.affiliation}`);
  lines.push(`Snapshot: ${result.snapshotPath}`);
  lines.push('');
  lines.push('Portfolio');
  lines.push(`  Total works: ${m.worksCount}`);
  lines.push(`  Peer-reviewed journal articles: ${m.peerReviewedCount}`);
  lines.push(
    `  OpenAlex citations: ${m.citedByCount} | h-index: ${m.hIndex} | i10-index: ${m.i10Index}`,
  );
  if (scholarBits.length > 0) {
    lines.push(`  Google Scholar: ${scholarBits.join(' | ')}`);
  }
  lines.push(`  Open access share: ${fmt(m.oaPercentage, 1)}%`);
  lines.push('');
  lines.push('Field-Weighted Citation Impact (1.00 = world average)');
  lines.push(`  Evaluated works: ${fwci.evaluatedCount}`);
  lines.push(
    `  Median FWCI: ${fmt(fwci.medianFwci)} | Mean FWCI: ${fmt(fwci.meanFwci)} | Max FWCI: ${fmt(fwci.maxFwci)}`,
  );
  lines.push(
    `  Above world average: ${fwci.aboveWorldAverageCount} (${fwci.aboveWorldAverageShare === null ? 'n/a' : fwci.aboveWorldAverageShare + '%'})`,
  );
  lines.push('');
  lines.push('Open Science Stages (0 = unassessed or paywalled, 5 = deployed tool)');
  for (const stage of [0, 1, 2, 3, 4, 5] as const) {
    const key = String(stage) as keyof StageCounts;
    lines.push(
      `  Stage ${stage}: ${stageCounts[key]} (${OPEN_SCIENCE_STAGE_DESCRIPTIONS[stage]})`,
    );
  }
  lines.push('');
  if (upgradeOpportunities.length === 0) {
    lines.push('Open Science Upgrade Opportunities: none, every work is at Stage 4 or above.');
  } else {
    lines.push(`Open Science Upgrade Opportunities (${upgradeOpportunities.length}):`);
    for (const [index, opportunity] of upgradeOpportunities.entries()) {
      lines.push('');
      lines.push(
        `  ${index + 1}. [Stage ${opportunity.currentStage} -> Stage ${opportunity.targetStage}] ` +
          `${opportunity.citations} citations, FWCI ${fmt(opportunity.fwci)} ` +
          `(${opportunity.year}) ${opportunity.title}`,
      );
      lines.push(`     Action: ${opportunity.actionLabel}`);
      lines.push(`     Suggested overrides.yaml key: ${opportunity.overrideKeySuggestion}`);
    }
  }
  return lines.join('\n');
}
