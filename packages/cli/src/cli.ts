/**
 * @researchhq/cli command line interface (zero-dependency parsing via
 * node:util parseArgs). This module is safe to import from any entry point,
 * including symlinked `node_modules/.bin/researchhq` and `npx` invocations:
 * no behavior here depends on `process.argv[1]`.
 */
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { PortfolioSnapshotSchema, sanitizePortfolioForPublic } from '@researchhq/schema';
import type { PlannedPaper } from '@researchhq/schema';
import { addPlannedPaper, listPlannedPapers, updatePlannedPaper } from './ideas.js';
import { initInstance } from './init.js';
import { auditInstance, renderAuditReport } from './audit.js';
import { checkPublicUrls, syncPortfolio, validateInstance, writeFileEnsuringDir, type OfflineBundle } from './sync.js';
import {
  formatSuggestJournalsReport,
  suggestJournals,
  type SuggestOpenAlexPort,
} from './suggest.js';
import { OpenAlexClient, type OpenAlexClientOptions } from './openalex.js';

const PAPER_CATEGORIES: readonly PlannedPaper['category'][] = [
  'flagship-project',
  'conceptual-methodology',
  'literature-gap',
];

const PAPER_STATUSES: readonly PlannedPaper['status'][] = [
  'idea',
  'scoping',
  'active-analysis',
  'drafting',
  'under-review',
  'revision',
  'accepted',
];

export const HELP = `researchhq: open research portfolio sync and planning CLI

Usage:
  researchhq init [--dir <dir>] [--name <name>] [--orcid <orcid>] [--affiliation <affil>] [--force]
  researchhq sync [--dir <dir>] [--scholar-csv <path>] [--publications-yml <path>]
                  [--private-out <path>] [--offline-bundle <path>]
  researchhq validate [--dir <dir>] [--check-links]
  researchhq audit [--dir <dir>] [--snapshot <path>] [--limit <n>] [--json]
  researchhq add-idea --slug <slug> --title <title> [--short-title <t>] [--category <cat>]
                      [--status <status>] [--quarter <YYYY-QN>] [--year <YYYY>]
                      [--stage <1-5>] [--summary <text>] [--journals <comma,separated>]
                      [--dir <dir>]
  researchhq update-idea --slug <slug> [--status <status>] [--readiness <0-100>]
                         [--quarter <YYYY-QN>] [--year <YYYY>] [--tool-url <url>]
                         [--milestone <text>] [--dir <dir>]
  researchhq list-ideas [--dir <dir>]
  researchhq suggest-journals (--slug <slug> | --title <title>) [--abstract <text>]
                             [--bib <path>] [--oa-only] [--diamond-only] [--doaj-only]
                             [--max-apc <usd>] [--min-year <yyyy>] [--limit <n>]
                             [--write-targets] [--dir <dir>] [--json]
  researchhq export-public --in <privateJson> --out <publicJson>
  researchhq --version
  researchhq --help`;

/** Per-subcommand help for `researchhq audit --help`. */
export const AUDIT_HELP = `researchhq audit: citation impact and open science upgrade audit

Usage:
  researchhq audit [--dir <dir>] [--snapshot <path>] [--limit <n>] [--json] [--help]

Options:
  --dir <dir>       Instance directory (default '.')
  --snapshot <path> Explicit snapshot JSON path; overrides the resolution order
  --limit <n>       Maximum upgrade opportunities to list (default 8)
  --json            Print machine-readable JSON instead of the text report
  --help            Show this help

Snapshot resolution order:
  1. --snapshot <path>
  2. <dir>/<config.paths.publicExport> when researchhq.config.yaml exists
  3. <dir>/public-data/portfolio.public.json
  4. <dir>/static/data/portfolio.json`;

/** Per-subcommand help for `researchhq suggest-journals --help`. */
export const SUGGEST_HELP = `researchhq suggest-journals: publisher-neutral target journal recommendation

Usage:
  researchhq suggest-journals (--slug <slug> | --title <title>) [--abstract <text>]
                              [--bib <path>] [--oa-only] [--diamond-only] [--doaj-only]
                              [--max-apc <usd>] [--min-year <yyyy>] [--limit <n>]
                              [--write-targets] [--dir <dir>] [--json] [--help]

Inputs:
  --slug <slug>      Take title, summary, gap, methodology, and keyCitations
                     from the matching entry in data/planned-papers.yaml
  --title <title>    Free-text title (alternative to --slug; one is required)
  --abstract <text>  Extra abstract or summary prose
  --bib <path>       BibTeX file; cited DOIs seed the bibliography signal

Filters:
  --oa-only          Only open access venues
  --diamond-only     Only diamond OA venues (no article processing charge)
  --doaj-only        Only DOAJ-indexed venues
  --max-apc <usd>    Only venues with a known APC of at most this many USD
  --min-year <yyyy>  Oldest publication year for the topical window
                     (default: current year minus 5)
  --limit <n>        Maximum venues to report (default 8, max 25)
  --write-targets    Write the top candidates into planned-papers.yaml
                     (requires --slug; keeps researchhq validate green)
  --dir <dir>        Instance directory (default '.')
  --json             Print machine-readable JSON instead of the text report
  --help             Show this help`;

/**
 * Factory for the OpenAlex client used by `suggest-journals`. Overridable as a
 * test seam so the CLI path can be exercised with zero live network calls.
 */
export type SuggestClientFactory = (options: OpenAlexClientOptions) => SuggestOpenAlexPort;

let suggestClientFactory: SuggestClientFactory = (options) => new OpenAlexClient(options);

/** Replace the suggest-journals client factory (used by tests). */
export function setSuggestClientFactory(factory: SuggestClientFactory): void {
  suggestClientFactory = factory;
}

/** Error raised for bad command or flag usage: the HELP block accompanies it. */
class UsageError extends Error {}

function fail(message: string): never {
  throw new UsageError(message);
}

/** Read the CLI package version from its package.json (no build-time baking). */
function cliVersion(): string {
  const raw = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
  const pkg = JSON.parse(raw) as { version?: string };
  return pkg.version ?? '0.0.0';
}

function hasHelpFlag(args: string[]): boolean {
  return args.includes('--help') || args.includes('-h');
}

function readOfflineBundle(path: string): OfflineBundle {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Cannot read offline bundle ${path}: ${message}`);
  }
  const bundle = raw as OfflineBundle;
  if (!bundle || typeof bundle !== 'object' || !bundle.author || !Array.isArray(bundle.works)) {
    throw new Error(`${path}: offline bundle must contain author and works fields`);
  }
  return bundle;
}

function parseNumberOption(value: string | undefined, flag: string): number | undefined {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value)) {
    fail(`${flag} expects an integer, got '${value}'`);
  }
  return Number.parseInt(value, 10);
}

function parseEnum<T extends string>(value: string, allowed: readonly T[], flag: string): T {
  if (!allowed.includes(value as T)) {
    fail(`${flag} must be one of: ${allowed.join(', ')}`);
  }
  return value as T;
}

async function runCommand(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;

  if (command === undefined || command === '--help' || command === '-h' || command === 'help') {
    console.log(HELP);
    return 0;
  }

  if (command === '--version' || command === '-v') {
    console.log(cliVersion());
    return 0;
  }

  switch (command) {
    case 'init': {
      if (hasHelpFlag(rest)) {
        console.log(HELP);
        return 0;
      }
      const { values } = parseArgs({
        args: rest,
        options: {
          dir: { type: 'string' },
          name: { type: 'string' },
          orcid: { type: 'string' },
          affiliation: { type: 'string' },
          force: { type: 'boolean', default: false },
        },
      });
      const result = initInstance(values.dir ?? '.', {
        name: values.name,
        orcid: values.orcid,
        affiliation: values.affiliation,
        force: values.force,
      });
      console.log(`Scaffolded ResearchHQ workspace in ${result.dir} (${result.files.length} files)`);
      return 0;
    }

    case 'sync': {
      if (hasHelpFlag(rest)) {
        console.log(HELP);
        return 0;
      }
      const { values } = parseArgs({
        args: rest,
        options: {
          dir: { type: 'string' },
          'scholar-csv': { type: 'string' },
          'publications-yml': { type: 'string' },
          'private-out': { type: 'string' },
          'offline-bundle': { type: 'string' },
        },
      });
      const result = await syncPortfolio(values.dir ?? '.', {
        scholarCsvPath: values['scholar-csv'],
        publicationsYmlPath: values['publications-yml'],
        privateOut: values['private-out'],
        offlineBundle: values['offline-bundle']
          ? readOfflineBundle(values['offline-bundle'])
          : undefined,
        log: (message) => console.log(message),
      });
      console.log(
        `Sync complete: ${result.publications.length} publications, ` +
          `${result.journals.length} journals, ${result.snapshot.plannedPapers.length} planned papers`,
      );
      console.log(`Public export: ${result.publicPath}`);
      if (result.privatePath) console.log(`Private snapshot: ${result.privatePath}`);
      return 0;
    }

    case 'validate': {
      if (hasHelpFlag(rest)) {
        console.log(HELP);
        return 0;
      }
      const { values } = parseArgs({
        args: rest,
        options: {
          dir: { type: 'string' },
          'check-links': { type: 'boolean', default: false },
        },
      });
      const result = validateInstance(values.dir ?? '.');
      for (const file of result.checkedFiles) {
        console.log(`Checked ${file}`);
      }
      for (const error of result.errors) {
        console.error(`Invalid: ${error}`);
      }
      let ok = result.ok;
      if (values['check-links']) {
        const linkResult = await checkPublicUrls(values.dir ?? '.');
        for (const failure of linkResult.failures) {
          console.error(
            `Broken public URL [${failure.status}] in ${failure.source}: ${failure.url}`,
          );
        }
        if (linkResult.failures.length > 0) {
          ok = false;
        } else if (ok) {
          console.log(`Checked ${linkResult.checked} public URL(s)`);
        }
      }
      if (ok) {
        console.log('All checks passed');
        return 0;
      }
      return 1;
    }

    case 'audit': {
      if (hasHelpFlag(rest)) {
        console.log(AUDIT_HELP);
        return 0;
      }
      const { values } = parseArgs({
        args: rest,
        options: {
          dir: { type: 'string' },
          snapshot: { type: 'string' },
          limit: { type: 'string' },
          json: { type: 'boolean', default: false },
        },
      });
      const limit = parseNumberOption(values.limit, '--limit') ?? 8;
      if (limit < 0) fail('--limit expects a non-negative integer');
      const result = auditInstance({
        dir: values.dir ?? '.',
        snapshotPath: values.snapshot,
        limit,
      });
      if (values.json) {
        console.log(
          JSON.stringify(
            {
              author: result.author,
              fwci: result.fwci,
              stageCounts: result.stageCounts,
              upgradeOpportunities: result.upgradeOpportunities,
            },
            null,
            2,
          ),
        );
      } else {
        console.log(renderAuditReport(result));
      }
      return 0;
    }

    case 'add-idea': {
      if (hasHelpFlag(rest)) {
        console.log(HELP);
        return 0;
      }
      const { values } = parseArgs({
        args: rest,
        options: {
          slug: { type: 'string' },
          title: { type: 'string' },
          'short-title': { type: 'string' },
          category: { type: 'string' },
          status: { type: 'string' },
          readiness: { type: 'string' },
          quarter: { type: 'string' },
          'submission-quarter': { type: 'string' },
          year: { type: 'string' },
          'publication-year': { type: 'string' },
          stage: { type: 'string' },
          'open-science-stage': { type: 'string' },
          summary: { type: 'string' },
          milestone: { type: 'string', multiple: true },
          journal: { type: 'string', multiple: true },
          journals: { type: 'string' },
          dir: { type: 'string' },
        },
      });
      if (!values.slug || !values.title) fail('add-idea requires --slug and --title');
      const journalItems: string[] = [];
      if (values.journals) {
        journalItems.push(...values.journals.split(',').map((j: string) => j.trim()).filter(Boolean));
      }
      if (values.journal) {
        journalItems.push(...values.journal.map((j: string) => j.trim()).filter(Boolean));
      }
      const quarter = values.quarter ?? values['submission-quarter'];
      const yearStr = values.year ?? values['publication-year'];
      const stageStr = values.stage ?? values['open-science-stage'];
      const paper = addPlannedPaper(values.dir ?? '.', {
        slug: values.slug,
        title: values.title,
        shortTitle: values['short-title'],
        category: values.category ? parseEnum(values.category, PAPER_CATEGORIES, '--category') : undefined,
        status: values.status ? parseEnum(values.status, PAPER_STATUSES, '--status') : undefined,
        readinessPercent: parseNumberOption(values.readiness, '--readiness'),
        targetSubmissionQuarter: quarter,
        targetPublicationYear: parseNumberOption(yearStr, '--year'),
        targetOpenScienceStage: parseNumberOption(stageStr, '--stage'),
        summary: values.summary,
        nextMilestones: values.milestone?.map((m: string) => m.trim()).filter(Boolean),
        targetJournals: journalItems.length > 0 ? journalItems : undefined,
      });
      console.log(`Added planned paper '${paper.slug}'`);
      return 0;
    }

    case 'update-idea': {
      if (hasHelpFlag(rest)) {
        console.log(HELP);
        return 0;
      }
      const { values } = parseArgs({
        args: rest,
        options: {
          slug: { type: 'string' },
          status: { type: 'string' },
          readiness: { type: 'string' },
          quarter: { type: 'string' },
          year: { type: 'string' },
          'tool-url': { type: 'string' },
          milestone: { type: 'string' },
          dir: { type: 'string' },
        },
      });
      if (!values.slug) fail('update-idea requires --slug');
      const paper = updatePlannedPaper(values.dir ?? '.', values.slug, {
        status: values.status ? parseEnum(values.status, PAPER_STATUSES, '--status') : undefined,
        readinessPercent: parseNumberOption(values.readiness, '--readiness'),
        targetSubmissionQuarter: values.quarter,
        targetPublicationYear: parseNumberOption(values.year, '--year'),
        interactiveToolUrl: values['tool-url'],
        nextMilestonesAppend: values.milestone ? [values.milestone] : undefined,
      });
      console.log(`Updated planned paper '${paper.slug}'`);
      return 0;
    }

    case 'suggest-journals': {
      if (hasHelpFlag(rest)) {
        console.log(SUGGEST_HELP);
        return 0;
      }
      const { values } = parseArgs({
        args: rest,
        options: {
          slug: { type: 'string' },
          title: { type: 'string' },
          abstract: { type: 'string' },
          bib: { type: 'string' },
          'oa-only': { type: 'boolean', default: false },
          'diamond-only': { type: 'boolean', default: false },
          'doaj-only': { type: 'boolean', default: false },
          'max-apc': { type: 'string' },
          'min-year': { type: 'string' },
          limit: { type: 'string' },
          'write-targets': { type: 'boolean', default: false },
          dir: { type: 'string' },
          json: { type: 'boolean', default: false },
        },
      });
      const maxApcUsd = parseNumberOption(values['max-apc'], '--max-apc');
      if (maxApcUsd !== undefined && maxApcUsd < 0) fail('--max-apc expects a non-negative integer');
      const minYear = parseNumberOption(values['min-year'], '--min-year');
      const limit = parseNumberOption(values.limit, '--limit');
      const result = await suggestJournals(
        {
          dir: values.dir ?? '.',
          slug: values.slug,
          title: values.title,
          abstract: values.abstract,
          bibPath: values.bib,
          oaOnly: values['oa-only'],
          diamondOnly: values['diamond-only'],
          doajOnly: values['doaj-only'],
          maxApcUsd,
          minYear,
          limit,
          writeTargets: values['write-targets'],
        },
        suggestClientFactory({}),
      );
      if (values.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(formatSuggestJournalsReport(result));
      }
      return 0;
    }

    case 'export-public': {
      if (hasHelpFlag(rest)) {
        console.log(HELP);
        return 0;
      }
      const { values } = parseArgs({
        args: rest,
        options: { in: { type: 'string' }, out: { type: 'string' } },
      });
      if (!values.in || !values.out) fail('export-public requires --in and --out');
      let raw: unknown;
      try {
        raw = JSON.parse(readFileSync(values.in, 'utf8')) as unknown;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Cannot read private snapshot ${values.in}: ${message}`);
      }
      const parsed = PortfolioSnapshotSchema.safeParse(raw);
      if (!parsed.success) {
        // Rethrow so runCli renders it with z.prettifyError, not raw JSON.
        throw parsed.error;
      }
      const publicSnapshot = sanitizePortfolioForPublic(parsed.data);
      writeFileEnsuringDir(values.out, JSON.stringify(publicSnapshot, null, 2) + '\n');
      console.log(`Public export written to ${values.out}`);
      return 0;
    }

    case 'list-ideas': {
      if (hasHelpFlag(rest)) {
        console.log(HELP);
        return 0;
      }
      const { values } = parseArgs({ args: rest, options: { dir: { type: 'string' } } });
      const papers = listPlannedPapers(values.dir ?? '.');
      for (const paper of papers) {
        console.log(
          `${paper.slug.padEnd(32)} ${paper.status.padEnd(16)} ` +
            `${String(paper.readinessPercent).padStart(3)}%  ${paper.targetSubmissionQuarter}`,
        );
      }
      return 0;
    }

    default:
      fail(`Unknown command '${command}'`);
  }
}

/**
 * Entry point; returns the process exit code.
 *
 * Error handling policy:
 * - Zod validation errors are rendered cleanly with z.prettifyError.
 * - Unknown command or flag usage errors print the message plus HELP.
 * - Domain errors (missing files, bad YAML, network problems) print the
 *   message only.
 */
export async function runCli(argv: string[] = process.argv.slice(2)): Promise<number> {
  try {
    return await runCommand(argv);
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error(`Validation error:\n${z.prettifyError(error)}`);
      return 1;
    }
    const code = (error as { code?: string } | null)?.code;
    const isUsage = error instanceof UsageError || (typeof code === 'string' && code.startsWith('ERR_PARSE_ARGS'));
    console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    if (isUsage) {
      console.error(HELP);
    }
    return 1;
  }
}
