/**
 * Planned paper management: add, update, and list entries in
 * data/planned-papers.yaml (or the paths.plannedPapers file named in
 * researchhq.config.yaml), keeping journal-metrics.yaml in sync when new
 * target venues are named.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  parse as parseYaml,
  parseDocument as parseYamlDocument,
  stringify as stringifyYaml,
} from 'yaml';
import {
  PlannedPaperSchema,
  ResearchHqConfigSchema,
  normalizeJournalId,
  type PlannedPaper,
  type ResearchHqConfig,
  type TargetJournalCandidate,
} from '@researchhq/schema';
import {
  loadCuratedJournals,
  loadPlannedPapers,
  resolveInstancePaths,
  type InstancePaths,
} from './sync.js';

// ---------------------------------------------------------------------------
// YAML read/write helpers (planned-papers.yaml and journal-metrics.yaml)
// ---------------------------------------------------------------------------

function readYaml(path: string): unknown {
  if (!existsSync(path)) {
    throw new Error(`File not found: ${path}`);
  }
  return parseYaml(readFileSync(path, 'utf8'));
}

/** Load researchhq.config.yaml when present so custom paths are honoured. */
function loadConfigIfPresent(instanceDir: string): ResearchHqConfig | undefined {
  const configPath = join(instanceDir, 'researchhq.config.yaml');
  if (!existsSync(configPath)) return undefined;
  return ResearchHqConfigSchema.parse(parseYaml(readFileSync(configPath, 'utf8')));
}

/** resolveInstancePaths honouring paths.plannedPapers (and friends) from config. */
function resolvePaths(instanceDir: string): InstancePaths {
  return resolveInstancePaths(instanceDir, loadConfigIfPresent(instanceDir));
}

/**
 * Write YAML while preserving the leading '#' header comment block of the
 * existing file (comments at the very top, before the first YAML mapping).
 */
function writeYamlPreservingHeader(path: string, data: unknown): void {
  const headerLines: string[] = [];
  if (existsSync(path)) {
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      if (line.startsWith('#')) {
        headerLines.push(line);
      } else if (line.trim() === '' && headerLines.length > 0) {
        continue;
      } else {
        break;
      }
    }
  }
  const body = stringifyYaml(data);
  const text = headerLines.length > 0 ? `${headerLines.join('\n')}\n\n${body}` : body;
  writeFileSync(path, text, 'utf8');
}

function requirePlannedPapersFile(path: string): { plannedPapers: PlannedPaper[] } {
  const raw = readYaml(path);
  const list = (raw as { plannedPapers?: unknown }).plannedPapers;
  if (!Array.isArray(list)) {
    throw new Error(`${path}: expected a top-level 'plannedPapers' array`);
  }
  const papers = list.map((item, index) => {
    const result = PlannedPaperSchema.safeParse(item);
    if (!result.success) {
      throw new Error(`${path}: planned paper at index ${index} is invalid: ${result.error.message}`);
    }
    return result.data;
  });
  return { plannedPapers: papers };
}

// ---------------------------------------------------------------------------
// addPlannedPaper
// ---------------------------------------------------------------------------

export interface PlannedPaperInput {
  slug: string;
  title: string;
  shortTitle?: string;
  category?: PlannedPaper['category'];
  status?: PlannedPaper['status'];
  readinessPercent?: number;
  targetSubmissionQuarter?: string;
  targetPublicationYear?: number;
  targetOpenScienceStage?: number;
  currentOpenScienceStage?: number;
  summary?: string;
  keyCitations?: string[];
  targetJournals?: Array<string | { name: string; fitScore?: number; fitRationale?: string }>;
  nextMilestones?: string[];
  privateNotes?: string | null;
}

/**
 * Append a new validated PlannedPaper to data/planned-papers.yaml. Throws when
 * the slug already exists. New target journals are added as minimal entries in
 * data/journal-metrics.yaml so every venue has a home for metrics.
 */
export function addPlannedPaper(instanceDir: string, input: PlannedPaperInput): PlannedPaper {
  const paths = resolvePaths(instanceDir);
  const papers = requirePlannedPapersFile(paths.plannedPapers);

  if (papers.plannedPapers.some((p) => p.slug === input.slug)) {
    throw new Error(`A planned paper with slug '${input.slug}' already exists`);
  }

  if (normalizeJournalId(input.slug) === '') {
    throw new Error(`Invalid slug: '${input.slug}'`);
  }

  const currentYear = new Date().getFullYear();
  const targetJournals = (input.targetJournals ?? []).map((entry, index) => {
    const name = typeof entry === 'string' ? entry : entry.name;
    const fitScore = typeof entry === 'object' && entry.fitScore !== undefined ? entry.fitScore : 50;
    const fitRationale =
      typeof entry === 'object' && entry.fitRationale !== undefined
        ? entry.fitRationale
        : 'Named when the idea was added; refine during scoping';
    return {
      journalId: normalizeJournalId(name),
      journalName: name,
      rank: index + 1,
      fitScore: Math.min(100, Math.max(0, fitScore)),
      fitRationale,
    };
  });

  const candidate: PlannedPaper = PlannedPaperSchema.parse({
    slug: input.slug,
    title: input.title,
    shortTitle: input.shortTitle ?? input.title,
    category: input.category ?? 'flagship-project',
    status: input.status ?? 'idea',
    readinessPercent: input.readinessPercent ?? 10,
    targetSubmissionQuarter: input.targetSubmissionQuarter ?? `${currentYear + 1}-Q1`,
    targetPublicationYear: input.targetPublicationYear ?? currentYear + 2,
    targetOpenScienceStage: input.targetOpenScienceStage ?? 5,
    currentOpenScienceStage: input.currentOpenScienceStage ?? 0,
    summary: input.summary ?? '',
    methodologyHighlights: [],
    keyCitations: input.keyCitations ?? [],
    collaborators: [],
    repoUrls: [],
    nextMilestones: input.nextMilestones ?? [],
    targetJournals,
    privateNotes: input.privateNotes ?? null,
  });

  papers.plannedPapers.push(candidate);
  writeYamlPreservingHeader(paths.plannedPapers, { plannedPapers: papers.plannedPapers });

  ensureTargetJournalsRegistered(instanceDir, targetJournals.map((t) => t.journalName));
  return candidate;
}

/** Append minimal entries for named journals that are not yet curated. */
export function ensureTargetJournalsRegistered(instanceDir: string, journalNames: string[]): void {
  const paths = resolvePaths(instanceDir);
  const journalMetricsPath = paths.journalMetrics;
  const existing = loadCuratedJournals(journalMetricsPath);
  const existingIds = new Set(existing.map((j) => normalizeJournalId(j.id)));

  const raw = readYaml(journalMetricsPath);
  const journals = Array.isArray((raw as { journals?: unknown }).journals)
    ? ((raw as { journals: unknown[] }).journals as unknown[]).slice()
    : [];

  let changed = false;
  for (const name of journalNames) {
    const id = normalizeJournalId(name);
    if (existingIds.has(id)) continue;
    journals.push({ id, name });
    existingIds.add(id);
    changed = true;
  }
  if (changed) {
    writeYamlPreservingHeader(journalMetricsPath, { journals });
  }
}

// ---------------------------------------------------------------------------
// updatePlannedPaper
// ---------------------------------------------------------------------------

export interface PlannedPaperPatch {
  status?: PlannedPaper['status'];
  readinessPercent?: number;
  targetSubmissionQuarter?: string;
  targetPublicationYear?: number;
  interactiveToolUrl?: string | null;
  currentOpenScienceStage?: number;
  /** Extra milestone lines appended to nextMilestones. */
  nextMilestonesAppend?: string[];
}

/** Mutable planned-paper fields shared by updatePlannedPaper and target writes. */
interface PlannedPaperFieldPatch {
  status?: PlannedPaper['status'];
  readinessPercent?: number;
  targetSubmissionQuarter?: string;
  targetPublicationYear?: number;
  interactiveToolUrl?: string | null;
  currentOpenScienceStage?: number;
  /** Extra milestone lines appended to nextMilestones. */
  nextMilestonesAppend?: string[];
  /** Full replacement of the targetJournals list. */
  targetJournals?: TargetJournalCandidate[];
}

/**
 * Apply a patch to one planned paper, validating through PlannedPaperSchema
 * before anything is written. The file is mutated in place through
 * YAML.parseDocument so inline comments on untouched entries survive
 * stringification (plain parse + re-stringify would drop them).
 */
function mutatePlannedPaper(
  instanceDir: string,
  slug: string,
  patch: PlannedPaperFieldPatch,
): PlannedPaper {
  const paths = resolvePaths(instanceDir);
  const papers = requirePlannedPapersFile(paths.plannedPapers);
  const paper = papers.plannedPapers.find((p) => p.slug === slug);
  if (!paper) {
    throw new Error(`No planned paper with slug '${slug}' in ${paths.plannedPapers}`);
  }

  const draft: PlannedPaper = structuredClone(paper);
  if (patch.status !== undefined) draft.status = patch.status;
  if (patch.readinessPercent !== undefined) {
    draft.readinessPercent = Math.min(100, Math.max(0, patch.readinessPercent));
  }
  if (patch.targetSubmissionQuarter !== undefined) {
    draft.targetSubmissionQuarter = patch.targetSubmissionQuarter;
  }
  if (patch.targetPublicationYear !== undefined) {
    draft.targetPublicationYear = patch.targetPublicationYear;
  }
  if (patch.interactiveToolUrl !== undefined) {
    draft.interactiveToolUrl = patch.interactiveToolUrl;
  }
  if (patch.currentOpenScienceStage !== undefined) {
    draft.currentOpenScienceStage = patch.currentOpenScienceStage;
  }
  if (patch.nextMilestonesAppend !== undefined) {
    // Append then dedupe so repeated milestones never pile up.
    draft.nextMilestones = [
      ...new Set([...draft.nextMilestones, ...patch.nextMilestonesAppend]),
    ];
  }
  if (patch.targetJournals !== undefined) {
    draft.targetJournals = patch.targetJournals;
  }
  const updated = PlannedPaperSchema.parse(draft);

  const doc = parseYamlDocument(readFileSync(paths.plannedPapers, 'utf8'));
  const listNode = doc.getIn(['plannedPapers']) as { items?: unknown[] } | undefined;
  const entryCount = listNode?.items?.length ?? 0;
  let index = -1;
  for (let i = 0; i < entryCount; i++) {
    if (String(doc.getIn(['plannedPapers', i, 'slug'])) === slug) {
      index = i;
      break;
    }
  }
  if (index === -1) {
    throw new Error(`No planned paper with slug '${slug}' in ${paths.plannedPapers}`);
  }

  const assigns: Array<{ path: (string | number)[]; value: unknown }> = [];
  if (patch.status !== undefined) {
    assigns.push({ path: ['plannedPapers', index, 'status'], value: patch.status });
  }
  if (patch.readinessPercent !== undefined) {
    assigns.push({ path: ['plannedPapers', index, 'readinessPercent'], value: updated.readinessPercent });
  }
  if (patch.targetSubmissionQuarter !== undefined) {
    assigns.push({ path: ['plannedPapers', index, 'targetSubmissionQuarter'], value: patch.targetSubmissionQuarter });
  }
  if (patch.targetPublicationYear !== undefined) {
    assigns.push({ path: ['plannedPapers', index, 'targetPublicationYear'], value: patch.targetPublicationYear });
  }
  if (patch.interactiveToolUrl !== undefined) {
    assigns.push({ path: ['plannedPapers', index, 'interactiveToolUrl'], value: patch.interactiveToolUrl });
  }
  if (patch.currentOpenScienceStage !== undefined) {
    assigns.push({ path: ['plannedPapers', index, 'currentOpenScienceStage'], value: patch.currentOpenScienceStage });
  }
  if (patch.nextMilestonesAppend !== undefined) {
    assigns.push({ path: ['plannedPapers', index, 'nextMilestones'], value: updated.nextMilestones });
  }
  if (patch.targetJournals !== undefined) {
    assigns.push({ path: ['plannedPapers', index, 'targetJournals'], value: updated.targetJournals });
  }
  for (const assign of assigns) {
    doc.setIn(assign.path, doc.createNode(assign.value));
  }
  writeFileSync(paths.plannedPapers, String(doc), 'utf8');
  return updated;
}

/** Update fields on an existing planned paper identified by slug. */
export function updatePlannedPaper(
  instanceDir: string,
  slug: string,
  patch: PlannedPaperPatch,
): PlannedPaper {
  return mutatePlannedPaper(instanceDir, slug, patch);
}

/**
 * Replace the targetJournals list of one planned paper (used by
 * suggest-journals --write-targets). Ranks must be unique and within 1..5 and
 * journalIds unique, enforced by PlannedPaperSchema during the write.
 */
export function setPlannedPaperTargetJournals(
  instanceDir: string,
  slug: string,
  candidates: TargetJournalCandidate[],
): PlannedPaper {
  return mutatePlannedPaper(instanceDir, slug, { targetJournals: candidates });
}

// ---------------------------------------------------------------------------
// listPlannedPapers
// ---------------------------------------------------------------------------

/**
 * Append minimal stub entries ({ id, name, openalexSourceId }) for journals
 * newly discovered by suggest-journals so every target venue has a curated
 * row and `researchhq validate` stays green. Mutated through parseDocument so
 * existing entries (and their comments) survive untouched.
 */
export function ensureJournalMetricStubEntries(
  instanceDir: string,
  entries: Array<{ id: string; name: string; openalexSourceId?: string | null }>,
): void {
  const paths = resolvePaths(instanceDir);
  const journalMetricsPath = paths.journalMetrics;

  const existing = loadCuratedJournals(journalMetricsPath);
  const existingIds = new Set(existing.map((j) => normalizeJournalId(j.id)));
  const fresh = entries
    .map((e) => ({
      id: normalizeJournalId(e.id),
      name: e.name,
      ...(e.openalexSourceId ? { openalexSourceId: e.openalexSourceId } : {}),
    }))
    .filter((e) => e.id !== '' && e.name !== '' && !existingIds.has(e.id));
  if (fresh.length === 0) return;

  if (!existsSync(journalMetricsPath)) {
    writeYamlPreservingHeader(journalMetricsPath, { journals: fresh });
    return;
  }

  const doc = parseYamlDocument(readFileSync(journalMetricsPath, 'utf8'));
  const seq = doc.getIn(['journals']) as { items?: unknown[] } | undefined;
  if (!seq || !Array.isArray(seq.items)) {
    throw new Error(`${journalMetricsPath}: expected a top-level 'journals' array`);
  }
  const freshNode = doc.createNode(fresh) as { items?: unknown[] };
  seq.items.push(...(freshNode.items ?? []));
  writeFileSync(journalMetricsPath, String(doc), 'utf8');
}

/**
 * Return planned papers sorted by readiness (descending), then by target
 * submission quarter (ascending) so the next deadlines surface first.
 */
export function listPlannedPapers(instanceDir: string): PlannedPaper[] {
  const paths = resolvePaths(instanceDir);
  const papers = loadPlannedPapers(paths.plannedPapers);
  return papers.slice().sort((a, b) => {
    if (b.readinessPercent !== a.readinessPercent) {
      return b.readinessPercent - a.readinessPercent;
    }
    return a.targetSubmissionQuarter.localeCompare(b.targetSubmissionQuarter);
  });
}
