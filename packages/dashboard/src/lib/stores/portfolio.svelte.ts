import {
  computeHIndex,
  computeI10Index,
  PlannedPaperSchema,
  type JournalMetric,
  type OpenScienceStage,
  type PlannedPaper,
  type PortfolioSnapshot,
  type Publication,
  type TimeSeriesPoint
} from '@researchhq/schema';

export type DashboardTab = 'overview' | 'timeseries' | 'journals' | 'publications' | 'pipeline';
export type CitationSourceMode = 'best' | 'openalex' | 'scholar';
export type PubTypeFilter = 'all' | 'article' | 'book' | 'software' | 'other';

const STORAGE_IDEAS_PREFIX = 'researchhq-local-ideas-v2';
const STORAGE_PROGRESS_PREFIX = 'researchhq-paper-progress-v2';

/**
 * Storage namespace: the active snapshot's author identity. Local drafts and
 * progress overrides are namespaced per researcher so they never leak across
 * authors sharing one GitHub Pages origin, nor into the ?demo=1 persona.
 */
export function storageNamespace(snapshot: PortfolioSnapshot | null): string {
  return snapshot?.author.orcid || snapshot?.author.openalexId || 'default';
}

/** Locally persisted, per-paper progress overrides (percent complete / status). */
export interface PaperProgressOverride {
  readinessPercent?: number;
  status?: PlannedPaper['status'];
  /** Repository baseline the override was recorded against (stale-guard). */
  baseReadinessPercent?: number;
  baseStatus?: string;
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export function compareStrings(a: string, b: string): number {
  return collator.compare(a, b);
}

export class PortfolioStore {
  snapshot = $state<PortfolioSnapshot | null>(null);
  activeTab = $state<DashboardTab>('overview');
  citationMode = $state<CitationSourceMode>('best');

  // Publication Explorer filters
  searchQuery = $state<string>('');
  pubTypeFilter = $state<PubTypeFilter>('all');
  stageFilter = $state<number | 'all'>('all');
  journalFilter = $state<string | null>(null);
  yearFilter = $state<number | null>(null);
  oaOnlyFilter = $state<boolean>(false);
  featuredOnlyFilter = $state<boolean>(false);

  // Journals Explorer filters
  journalSearch = $state<string>('');
  journalScopeFilter = $state<'all' | 'published' | 'targets' | 'oa'>('all');
  includeNonJournalVenues = $state<boolean>(false);

  // Pipeline Explorer filters & local drafts
  pipelineCategoryFilter = $state<'all' | PlannedPaper['category']>('all');
  localDraftPapers = $state<PlannedPaper[]>([]);
  localProgressOverrides = $state<Record<string, PaperProgressOverride>>({});

  // Active modals & live status announcement
  selectedPublication = $state<Publication | null>(null);
  // The open detail dialog is tracked by slug so the rendered paper always
  // re-merges the latest local progress override (live slider / status edits).
  selectedPlannedSlug = $state<string | null>(null);
  showIdeaComposer = $state<boolean>(false);
  statusAnnouncement = $state<string>('');

  get selectedPlannedPaper(): PlannedPaper | null {
    if (this.selectedPlannedSlug === null) return null;
    return this.allPlannedPapers.find((p) => p.slug === this.selectedPlannedSlug) ?? null;
  }

  set selectedPlannedPaper(paper: PlannedPaper | null) {
    this.selectedPlannedSlug = paper?.slug ?? null;
  }

  constructor(initial?: PortfolioSnapshot) {
    if (initial) {
      this.snapshot = initial;
    }
  }

  /** Non-reactive: the storage namespace currently hydrated into local state. */
  private loadedNamespace: string | null = null;

  /**
   * Swap the active snapshot (initial data, repo refresh, or demo toggle) and
   * re-hydrate local drafts / progress overrides from the new author
   * namespace so nothing leaks across researchers or into the demo persona.
   */
  setSnapshot(snapshot: PortfolioSnapshot): void {
    this.snapshot = snapshot;
    const ns = storageNamespace(snapshot);
    if (typeof window !== 'undefined' && ns !== this.loadedNamespace) {
      this.hydrateLocalDrafts();
    }
  }

  hydrateLocalDrafts(): void {
    if (typeof window === 'undefined') return;
    const ns = storageNamespace(this.snapshot);
    this.loadedNamespace = ns;
    const ideasKey = `${STORAGE_IDEAS_PREFIX}:${ns}`;
    const progressKey = `${STORAGE_PROGRESS_PREFIX}:${ns}`;
    // Re-hydration is a full reset: a namespace with no stored data must
    // clear whatever the previously active namespace had loaded.
    this.localDraftPapers = [];
    this.localProgressOverrides = {};
    try {
      const raw = window.localStorage.getItem(ideasKey);
      if (raw) {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          // Validate every draft against the shared Zod schema: invalid or
          // malformed items are ignored instead of crashing the dashboard.
          const valid: PlannedPaper[] = [];
          for (const item of parsed) {
            const result = PlannedPaperSchema.safeParse(item);
            if (result.success) {
              valid.push(result.data);
            }
          }
          this.localDraftPapers = valid;
        }
      }
    } catch {
      // Ignore storage parse failures
    }
    try {
      const rawProgress = window.localStorage.getItem(progressKey);
      if (rawProgress) {
        const parsedProgress: unknown = JSON.parse(rawProgress);
        if (parsedProgress && typeof parsedProgress === 'object' && !Array.isArray(parsedProgress)) {
          // Validate every override entry: readinessPercent must be an integer
          // 0..100 (the snapshot schema shape, Zod-checked) and status must be
          // one of the PlannedPaper status enum values. Invalid entries are
          // dropped instead of crashing the dashboard.
          const overrides: Record<string, PaperProgressOverride> = {};
          for (const [slug, value] of Object.entries(
            parsedProgress as Record<string, unknown>
          )) {
            if (!value || typeof value !== 'object') continue;
            const candidate = value as Record<string, unknown>;
            const override: PaperProgressOverride = {};
            if (candidate.readinessPercent !== undefined) {
              const readiness = PlannedPaperSchema.shape.readinessPercent.safeParse(
                candidate.readinessPercent
              );
              if (readiness.success && Number.isInteger(readiness.data)) {
                override.readinessPercent = readiness.data;
              }
            }
            if (candidate.status !== undefined) {
              const status = PlannedPaperSchema.shape.status.safeParse(candidate.status);
              if (status.success) {
                override.status = status.data;
              }
            }
            if (typeof candidate.baseReadinessPercent === 'number') {
              override.baseReadinessPercent = candidate.baseReadinessPercent;
            }
            if (typeof candidate.baseStatus === 'string') {
              override.baseStatus = candidate.baseStatus;
            }
            if (
              override.readinessPercent !== undefined ||
              override.status !== undefined
            ) {
              overrides[slug] = override;
            }
          }
          this.localProgressOverrides = overrides;
        }
      }
    } catch {
      // Ignore storage parse failures
    }
    this.pruneStaleOverrides();
  }

  /**
   * Drop override fields whose recorded repository baseline no longer matches
   * the snapshot, so an updated readinessPercent / status in the repository
   * YAML is never permanently shadowed by a stale local override.
   */
  private pruneStaleOverrides(): void {
    const repoPapers = this.snapshot?.plannedPapers ?? [];
    if (repoPapers.length === 0 || Object.keys(this.localProgressOverrides).length === 0) {
      return;
    }
    let changed = false;
    const next: Record<string, PaperProgressOverride> = { ...this.localProgressOverrides };
    for (const paper of repoPapers) {
      const override = next[paper.slug];
      if (!override) continue;
      const pruned: PaperProgressOverride = { ...override };
      if (
        pruned.readinessPercent !== undefined &&
        pruned.baseReadinessPercent !== undefined &&
        pruned.baseReadinessPercent !== paper.readinessPercent
      ) {
        delete pruned.readinessPercent;
        changed = true;
      }
      if (
        pruned.status !== undefined &&
        pruned.baseStatus !== undefined &&
        pruned.baseStatus !== paper.status
      ) {
        delete pruned.status;
        changed = true;
      }
      if (pruned.readinessPercent === undefined && pruned.status === undefined) {
        delete next[paper.slug];
      } else {
        next[paper.slug] = pruned;
      }
    }
    if (changed) {
      this.localProgressOverrides = next;
      this.persistProgressOverrides();
    }
  }

  addOrUpdateLocalIdea(paper: PlannedPaper): void {
    // Defensive re-validation: never persist an item that violates the schema
    const validated = PlannedPaperSchema.safeParse(paper);
    if (!validated.success) {
      this.announce('Could not save the idea: the draft data is incomplete');
      return;
    }
    const validPaper: PlannedPaper = validated.data;
    const idx = this.localDraftPapers.findIndex((p) => p.slug === validPaper.slug);
    if (idx >= 0) {
      this.localDraftPapers[idx] = validPaper;
    } else {
      this.localDraftPapers = [...this.localDraftPapers, validPaper];
    }
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(
        `${STORAGE_IDEAS_PREFIX}:${storageNamespace(this.snapshot)}`,
        JSON.stringify(this.localDraftPapers)
      );
      } catch {
        // Ignore quota errors
      }
    }
    this.announce(`Saved planned paper idea: ${validPaper.shortTitle}`);
  }

  removeLocalIdea(slug: string): void {
    this.localDraftPapers = this.localDraftPapers.filter((p) => p.slug !== slug);
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(
          `${STORAGE_IDEAS_PREFIX}:${storageNamespace(this.snapshot)}`,
          JSON.stringify(this.localDraftPapers)
        );
      } catch {
        // Ignore storage errors
      }
    }
  }

  hasProgressOverride(slug: string): boolean {
    const override = this.localProgressOverrides[slug];
    return (
      override !== undefined &&
      (override.readinessPercent !== undefined || override.status !== undefined)
    );
  }

  persistProgressOverrides(): void {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(
        `${STORAGE_PROGRESS_PREFIX}:${storageNamespace(this.snapshot)}`,
        JSON.stringify(this.localProgressOverrides)
      );
    } catch {
      // Ignore quota or serialization errors
    }
  }

  setPaperProgress(
    slug: string,
    patch: { readinessPercent?: number; status?: PlannedPaper['status'] }
  ): void {
    const override: PaperProgressOverride = { ...this.localProgressOverrides[slug] };
    const repoPaper = this.snapshot?.plannedPapers.find((p) => p.slug === slug);
    if (repoPaper) {
      // Record the repository baseline this override was taken against, so a
      // later repo YAML update invalidates the stored override instead of
      // permanently shadowing the fresh value.
      override.baseReadinessPercent = repoPaper.readinessPercent;
      override.baseStatus = repoPaper.status;
    }
    if (patch.readinessPercent !== undefined) {
      // Clamp to an integer 0..100 so the value always satisfies the schema
      const clamped = Math.max(0, Math.min(100, Math.round(Number(patch.readinessPercent))));
      if (Number.isFinite(clamped)) {
        override.readinessPercent = clamped;
      }
    }
    if (patch.status !== undefined) {
      override.status = patch.status;
    }
    this.localProgressOverrides = { ...this.localProgressOverrides, [slug]: override };
    this.persistProgressOverrides();
    const title = this.allPlannedPapers.find((p) => p.slug === slug)?.shortTitle ?? slug;
    const bits: string[] = [];
    if (override.readinessPercent !== undefined) {
      bits.push(`percent complete ${override.readinessPercent}%`);
    }
    if (override.status !== undefined) {
      bits.push(`status ${override.status.replace(/-/g, ' ')}`);
    }
    this.announce(`${title}: ${bits.join(', ')}`);
  }

  resetPaperProgress(slug: string): void {
    const next = { ...this.localProgressOverrides };
    delete next[slug];
    this.localProgressOverrides = next;
    this.persistProgressOverrides();
    // The selected paper re-merges from the snapshot or local draft base
    const title = this.allPlannedPapers.find((p) => p.slug === slug)?.shortTitle ?? slug;
    this.announce(`Reset local progress edits for ${title}`);
  }

  announce(msg: string): void {
    // Clear first, then set inside a microtask so repeated identical
    // announcements (same sort / filter message twice in a row) are re-spoken
    // by screen readers instead of being swallowed as unchanged text.
    this.statusAnnouncement = '';
    queueMicrotask(() => {
      this.statusAnnouncement = msg;
    });
  }

  getCitations(pub: Publication): number {
    if (this.citationMode === 'openalex') {
      return pub.citationsOpenAlex ?? pub.citations;
    }
    if (this.citationMode === 'scholar') {
      return pub.citationsScholar ?? pub.citations;
    }
    return Math.max(pub.citations, pub.citationsOpenAlex ?? 0, pub.citationsScholar ?? 0);
  }

  allPlannedPapers = $derived.by<PlannedPaper[]>(() => {
    const mergeOverride = (paper: PlannedPaper): PlannedPaper => {
      const override = this.localProgressOverrides[paper.slug];
      if (!override) return paper;
      // Repository papers only: a recorded baseline that no longer matches the
      // snapshot value means the repo YAML was updated, so the stale override
      // field is dropped instead of permanently shadowing the fresh value.
      const isRepoPaper = (this.snapshot?.plannedPapers ?? []).some(
        (p) => p.slug === paper.slug
      );
      const staleReadiness =
        isRepoPaper &&
        override.readinessPercent !== undefined &&
        override.baseReadinessPercent !== undefined &&
        override.baseReadinessPercent !== paper.readinessPercent;
      const staleStatus =
        isRepoPaper &&
        override.status !== undefined &&
        override.baseStatus !== undefined &&
        override.baseStatus !== paper.status;
      const useReadiness = override.readinessPercent !== undefined && !staleReadiness;
      const useStatus = override.status !== undefined && !staleStatus;
      if (!useReadiness && !useStatus) return paper;
      return {
        ...paper,
        ...(useReadiness ? { readinessPercent: override.readinessPercent } : {}),
        ...(useStatus ? { status: override.status } : {})
      };
    };
    const base = this.snapshot?.plannedPapers ?? [];
    const bySlug = new Map<string, PlannedPaper>();
    for (const p of base) bySlug.set(p.slug, mergeOverride(p));
    for (const d of this.localDraftPapers) bySlug.set(d.slug, mergeOverride(d));
    return Array.from(bySlug.values());
  });

  filteredPlannedPapers = $derived.by<PlannedPaper[]>(() => {
    const all = this.allPlannedPapers;
    if (this.pipelineCategoryFilter === 'all') return all;
    return all.filter((p) => p.category === this.pipelineCategoryFilter);
  });

  filteredPublications = $derived.by<Publication[]>(() => {
    const pubs = this.snapshot?.publications ?? [];
    const q = this.searchQuery.trim().toLowerCase();

    return pubs.filter((p) => {
      if (this.pubTypeFilter !== 'all') {
        if (this.pubTypeFilter === 'book') {
          if (p.type !== 'book' && p.type !== 'book-chapter') return false;
        } else if (p.type !== this.pubTypeFilter) {
          return false;
        }
      }
      if (this.stageFilter !== 'all' && p.openScienceStage !== this.stageFilter) {
        return false;
      }
      if (this.journalFilter) {
        const matchId = p.journalId === this.journalFilter;
        const matchVenue =
          p.venue?.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') ===
          this.journalFilter;
        if (!matchId && !matchVenue) return false;
      }
      if (this.yearFilter !== null && p.year !== this.yearFilter) {
        return false;
      }
      if (this.oaOnlyFilter) {
        const oa = p.openScience.oaStatus;
        if (!oa || oa === 'closed' || oa === 'unknown') return false;
      }
      if (this.featuredOnlyFilter && !p.featured) {
        return false;
      }
      if (q) {
        const hay = [
          p.title,
          p.venue ?? '',
          p.doi ?? '',
          p.authors.join(' '),
          p.topics.join(' '),
          p.openScience.interactiveToolName ?? ''
        ]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  });

  filteredJournals = $derived.by<JournalMetric[]>(() => {
    const journals = this.snapshot?.journals ?? [];
    const q = this.journalSearch.trim().toLowerCase();

    return journals.filter((j) => {
      if (!this.includeNonJournalVenues) {
        if (j.venueType && j.venueType !== 'journal') return false;
      }
      if (this.journalScopeFilter === 'published' && j.authorPublishedCount === 0) return false;
      if (this.journalScopeFilter === 'targets' && j.targetPaperCount === 0) return false;
      if (this.journalScopeFilter === 'oa') {
        const oaOk = j.isOa || j.oaModel === 'diamond' || j.oaModel === 'gold';
        if (!oaOk) return false;
      }
      if (q) {
        const hay = [
          j.name,
          j.shortName ?? '',
          j.publisher ?? '',
          j.scopeTags.join(' ')
        ]
          .join(' ')
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  });

  liveSummaryStats = $derived.by(() => {
    const pubs = this.snapshot?.publications ?? [];
    const cites = pubs.map((p) => this.getCitations(p));
    const totalCitationsComputed = cites.reduce((a, b) => a + b, 0);
    return {
      totalCitationsComputed,
      hIndexComputed: computeHIndex(cites),
      i10IndexComputed: computeI10Index(cites)
    };
  });

  timeSeriesWithDrafts = $derived.by<TimeSeriesPoint[]>(() => {
    const base = this.snapshot?.timeSeries ?? [];
    if (this.localDraftPapers.length === 0) return base;
    // Only overlay genuinely local drafts: a draft whose slug already exists
    // in the repository snapshot is an in-place edit and must not be
    // double-counted in the future time series.
    const repositorySlugs = new Set((this.snapshot?.plannedPapers ?? []).map((p) => p.slug));
    const overlayDrafts = this.localDraftPapers.filter((d) => !repositorySlugs.has(d.slug));
    if (overlayDrafts.length === 0) return base;
    // Overlay the remaining local draft papers onto future time series points
    return base.map((pt) => {
      const extraSub = overlayDrafts.filter((d) =>
        d.targetSubmissionQuarter.startsWith(`${pt.year}-Q`)
      );
      const extraPub = overlayDrafts.filter((d) => d.targetPublicationYear === pt.year);
      if (extraSub.length === 0 && extraPub.length === 0) return pt;
      const slugs = Array.from(
        new Set([...pt.plannedPaperSlugs, ...extraSub.map((d) => d.slug), ...extraPub.map((d) => d.slug)])
      );
      return {
        ...pt,
        plannedSubmissionsCount: pt.plannedSubmissionsCount + extraSub.length,
        plannedPublicationsCount: pt.plannedPublicationsCount + extraPub.length,
        plannedPaperSlugs: slugs
      };
    });
  });

  roadmapYearRange = $derived.by<{ start: number; end: number }>(() => {
    const papers = this.allPlannedPapers;
    let start = Number.POSITIVE_INFINITY;
    let end = 0;
    for (const p of papers) {
      const quarterYear = Number.parseInt(p.targetSubmissionQuarter.slice(0, 4), 10);
      if (Number.isFinite(quarterYear) && quarterYear > 0 && quarterYear < start) {
        start = quarterYear;
      }
      if (p.targetPublicationYear > end) end = p.targetPublicationYear;
    }
    if (!Number.isFinite(start) || end === 0) {
      const currentYear = new Date().getFullYear();
      return { start: currentYear, end: currentYear + 2 };
    }
    return { start, end };
  });

  filterByJournalAndNavigate(journalId: string, journalName: string): void {
    this.journalFilter = journalId;
    this.activeTab = 'publications';
    this.announce(`Filtered publications to journal: ${journalName}`);
  }

  filterByStageAndNavigate(stage: OpenScienceStage): void {
    this.stageFilter = stage;
    this.activeTab = 'publications';
    this.announce(`Filtered publications to Open Science Stage ${stage}`);
  }

  filterByYearAndNavigate(year: number, isFuture: boolean): void {
    if (isFuture) {
      this.activeTab = 'pipeline';
      this.announce(`Viewing planned publications pipeline for ${year}`);
    } else {
      this.yearFilter = year;
      this.activeTab = 'publications';
      this.announce(`Filtered publications to year ${year}`);
    }
  }

  resetPublicationFilters(): void {
    this.searchQuery = '';
    this.pubTypeFilter = 'all';
    this.stageFilter = 'all';
    this.journalFilter = null;
    this.yearFilter = null;
    this.oaOnlyFilter = false;
    this.featuredOnlyFilter = false;
    this.announce('Cleared all publication filters');
  }
}
