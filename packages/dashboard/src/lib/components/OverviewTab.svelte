<script lang="ts">
  import {
    OPEN_SCIENCE_STAGE_DESCRIPTIONS,
    OPEN_SCIENCE_STAGE_LABELS,
    computeFwciSummary,
    computeOpenScienceGaps,
    type OpenScienceStage,
    type OpenScienceUpgradeOpportunity
  } from '@researchhq/schema';
  import {
    Award,
    BookOpen,
    CheckCircle2,
    ExternalLink,
    FileCode2,
    Globe,
    Layers,
    Rocket,
    Sparkles,
    TrendingUp,
    Copy,
    Check
  } from '@lucide/svelte';
  import type { PortfolioStore } from '#lib/stores/portfolio.svelte';
  import { safeHref } from '#lib/utils/url';

  let { store }: { store: PortfolioStore } = $props();

  const author = $derived(store.snapshot!.author);
  const metrics = $derived(author.metrics);

  const stages: OpenScienceStage[] = [1, 2, 3, 4, 5];

  // Data-driven pointer to the conceptual / open-science methodology paper
  // (no hardcoded slug: matches any paper of that category or slug theme).
  const conceptualPaper = $derived.by(() => {
    return (
      store.allPlannedPapers.find(
        (p) => p.slug.includes('open-science') || p.category === 'conceptual-methodology'
      ) ?? null
    );
  });

  const roadmap = $derived(store.roadmapYearRange);

  const scholarI10 = $derived(metrics.i10IndexScholar ?? null);

  const topCited = $derived.by(() => {
    const pubs = [...(store.snapshot?.publications ?? [])];
    return pubs.sort((a, b) => store.getCitations(b) - store.getCitations(a)).slice(0, 6);
  });

  const featuredStage5 = $derived.by(() => {
    return (store.snapshot?.publications ?? []).filter(
      (p) => p.openScienceStage === 5 || p.featured
    );
  });

  const nearestPlanned = $derived.by(() => {
    return [...store.allPlannedPapers]
      .sort((a, b) => b.readinessPercent - a.readinessPercent)
      .slice(0, 4);
  });

  const publishedJournalsCount = $derived.by(() => {
    return (store.snapshot?.journals ?? []).filter(
      (j) => j.authorPublishedCount > 0 && (!j.venueType || j.venueType === 'journal')
    ).length;
  });

  function stageCount(s: OpenScienceStage): number {
    return metrics.stageCounts[String(s) as '1' | '2' | '3' | '4' | '5'] ?? 0;
  }

  // FWCI (Field-Weighted Citation Impact) summary for the Impact Indices card
  const fwciSummary = $derived(computeFwciSummary(store.snapshot?.publications ?? []));

  // Highest-impact works that still have an open science upgrade step left
  const upgradeGaps = $derived(computeOpenScienceGaps(store.snapshot?.publications ?? [], 5));

  let copiedGapId = $state<string | null>(null);

  /** URL field per target stage, matching the overrides.yaml openScience shape. */
  const URL_FIELD_BY_STAGE: Record<number, string> = {
    1: 'oaUrl',
    2: 'dataUrl',
    3: 'codeUrl',
    4: 'reproducibleRepoUrl',
    5: 'interactiveToolUrl'
  };

  function yamlOverrideFor(gap: OpenScienceUpgradeOpportunity): string {
    const escapeYaml = (value: string): string => value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const matchLine = gap.doi
      ? `    doi: "${escapeYaml(gap.doi)}"`
      : `    titleMatch: "${escapeYaml(gap.title)}"`;
    const urlField = URL_FIELD_BY_STAGE[gap.targetStage] ?? 'codeUrl';
    // Entry key only (no top-level `overrides:` wrapper) and a per-publication
    // id suffix so pasting several entries into data/overrides.yaml stays
    // valid YAML without key collisions.
    const entryKey = `${gap.overrideKeySuggestion}-${gap.publicationId.toLowerCase()}`;
    return [
      `  ${entryKey}:`,
      matchLine,
      `    # openScienceStage: ${gap.targetStage} # uncomment after adding verified URL`,
      '    openScience:',
      `      ${urlField}: "https://github.com/..." # ${gap.actionLabel}`
    ].join('\n');
  }

  async function copyGapOverride(gap: OpenScienceUpgradeOpportunity): Promise<void> {
    try {
      await navigator.clipboard.writeText(yamlOverrideFor(gap));
      copiedGapId = gap.publicationId;
      store.announce(`YAML override copied for: ${gap.title}`);
      window.setTimeout(() => {
        if (copiedGapId === gap.publicationId) copiedGapId = null;
      }, 2000);
    } catch {
      store.announce('Clipboard unavailable: copy the YAML override manually');
    }
  }

  function openGapPublication(gap: OpenScienceUpgradeOpportunity): void {
    const publication =
      store.snapshot?.publications.find((p) => p.id === gap.publicationId) ?? null;
    if (publication) {
      store.selectedPublication = publication;
    }
  }
</script>

<div class="space-y-8">
  <!-- Executive KPI Grid -->
  <section aria-labelledby="kpi-heading">
    <h2 id="kpi-heading" class="sr-only">Portfolio key metrics</h2>
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
      <div class="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-card)] p-4 shadow-xs">
        <div class="flex items-center justify-between text-xs font-semibold tracking-wide text-[var(--ink-muted)] uppercase">
          <span>Citations</span>
          <TrendingUp class="h-4 w-4 text-[var(--accent-primary)]" aria-hidden="true" />
        </div>
        <div class="mt-2 flex items-baseline gap-2">
          <span class="text-3xl font-bold tracking-tight">
            {(store.citationMode === 'scholar'
              ? (metrics.citedByScholar ?? store.liveSummaryStats.totalCitationsComputed)
              : metrics.citedByCount
            ).toLocaleString()}
          </span>
        </div>
        <p class="mt-1 text-xs text-[var(--ink-muted)]">
          OpenAlex: {metrics.citedByCount.toLocaleString()}
          {#if metrics.citedByScholar != null}
            · Scholar: {metrics.citedByScholar.toLocaleString()}+
          {/if}
        </p>
      </div>

      <div class="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-card)] p-4 shadow-xs">
        <div class="flex items-center justify-between text-xs font-semibold tracking-wide text-[var(--ink-muted)] uppercase">
          <span>Impact Indices</span>
          <Award class="h-4 w-4 text-[var(--accent-secondary)]" aria-hidden="true" />
        </div>
        <div class="mt-2 flex items-baseline gap-3">
          <div>
            <span class="text-3xl font-bold tracking-tight">
              {store.citationMode === 'scholar'
                ? (metrics.hIndexScholar ?? store.liveSummaryStats.hIndexComputed)
                : metrics.hIndex}
            </span>
            <span class="ml-0.5 text-xs font-medium text-[var(--ink-muted)]">h-index</span>
          </div>
          <div class="border-l border-[var(--border-subtle)] pl-3">
            <span class="text-2xl font-bold tracking-tight">
              {store.citationMode === 'scholar'
                ? (scholarI10 ?? store.liveSummaryStats.i10IndexComputed)
                : metrics.i10Index}
            </span>
            <span class="ml-0.5 text-xs font-medium text-[var(--ink-muted)]">i10</span>
          </div>
        </div>
        <p class="mt-1 text-xs text-[var(--ink-muted)]">
          {#if metrics.hIndexScholar != null}
            OpenAlex h={metrics.hIndex} · Scholar h={metrics.hIndexScholar}
          {:else if metrics.twoYearMeanCitedness}
            2yr mean citedness: {metrics.twoYearMeanCitedness.toFixed(2)}
          {/if}
        </p>
        {#if fwciSummary.medianFwci !== null}
          <p class="mt-1 text-xs text-[var(--ink-muted)]">
            Median FWCI {fwciSummary.medianFwci.toFixed(2)}x (n = {fwciSummary.evaluatedCount}) ({fwciSummary.aboveWorldAverageShare}% &gt; 1.0)
          </p>
        {/if}
      </div>

      <div class="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-card)] p-4 shadow-xs">
        <div class="flex items-center justify-between text-xs font-semibold tracking-wide text-[var(--ink-muted)] uppercase">
          <span>Research Outputs</span>
          <BookOpen class="h-4 w-4 text-[var(--accent-primary)]" aria-hidden="true" />
        </div>
        <div class="mt-2 flex items-baseline gap-2">
          <span class="text-3xl font-bold tracking-tight">{metrics.worksCount}</span>
          <span class="text-xs font-medium text-[var(--ink-muted)]">indexed works</span>
        </div>
        <p class="mt-1 text-xs text-[var(--ink-muted)]">
          {metrics.peerReviewedCount} journal articles across {publishedJournalsCount} journals
        </p>
      </div>

      <div class="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-card)] p-4 shadow-xs">
        <div class="flex items-center justify-between text-xs font-semibold tracking-wide text-[var(--ink-muted)] uppercase">
          <span>Open Access</span>
          <Globe class="h-4 w-4 text-[var(--accent-primary)]" aria-hidden="true" />
        </div>
        <div class="mt-2 flex items-baseline gap-2">
          <span class="text-3xl font-bold tracking-tight">{metrics.oaPercentage.toFixed(0)}%</span>
          <span class="text-xs font-medium text-[var(--ink-muted)]">openly readable</span>
        </div>
        <p class="mt-1 text-xs text-[var(--ink-muted)]">
          {stageCount(4) + stageCount(5)} Stage 4-5 reproducible / tool outputs
        </p>
      </div>

      <div class="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-card)] p-4 shadow-xs">
        <div class="flex items-center justify-between text-xs font-semibold tracking-wide text-[var(--ink-muted)] uppercase">
          <span>Future Pipeline</span>
          <Rocket class="h-4 w-4 text-[var(--accent-violet)]" aria-hidden="true" />
        </div>
        <div class="mt-2 flex items-baseline gap-2">
          <span class="text-3xl font-bold tracking-tight">{store.allPlannedPapers.length}</span>
          <span class="text-xs font-medium text-[var(--ink-muted)]">planned papers</span>
        </div>
        <p class="mt-1 text-xs text-[var(--ink-muted)]">
          {roadmap.start}-{roadmap.end} roadmap · {store.allPlannedPapers.filter((p) => p.targetOpenScienceStage === 5).length} targeting Stage 5
        </p>
      </div>
    </div>
  </section>

  <!-- 5 Stages of Open Science Interactive Ladder -->
  <section
    aria-labelledby="open-science-heading"
    class="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-card)] p-6 shadow-xs"
  >
    <div class="flex flex-col justify-between gap-2 sm:flex-row sm:items-end">
      <div>
        <div class="inline-flex items-center gap-1.5 text-xs font-semibold tracking-wide text-[var(--accent-primary)] uppercase">
          <Layers class="h-3.5 w-3.5" aria-hidden="true" />
          <span>Open & Reproducible Science Maturity Model</span>
        </div>
        <h2 id="open-science-heading" class="mt-1 text-xl font-bold">
          The 5 Stages of Open Science Across Outputs
        </h2>
        <p class="mt-1 max-w-3xl text-sm text-[var(--ink-secondary)]">
          Select any stage below to inspect matching publications, from openly readable articles (Stage 1) to deployed interactive planning tools used by practitioners and citizens (Stage 5).
        </p>
      </div>
      <button
        type="button"
        onclick={() => {
          if (conceptualPaper) {
            store.selectedPlannedPaper = conceptualPaper;
          } else {
            store.activeTab = 'pipeline';
          }
        }}
        class="inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-subtle)] px-3 py-1.5 text-xs font-semibold text-[var(--ink-primary)] hover:border-[var(--accent-primary)]"
      >
        <Sparkles class="h-3.5 w-3.5 text-[var(--accent-primary)]" aria-hidden="true" />
        <span>View planned 5-Stages paper</span>
      </button>
    </div>

    <ol class="mt-5 grid grid-cols-1 gap-3 md:grid-cols-5">
      {#each stages as stage (stage)}
        {@const count = stageCount(stage)}
        {@const pct = metrics.worksCount > 0 ? Math.round((count / metrics.worksCount) * 100) : 0}
        <li class="flex">
          <button
            type="button"
            onclick={() => store.filterByStageAndNavigate(stage)}
            class="group flex w-full flex-col justify-between rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-subtle)]/50 p-4 text-left transition hover:border-[var(--accent-primary)] hover:bg-[var(--surface-subtle)]"
          >
            <div>
              <div class="flex items-center justify-between gap-2">
                <span
                  class="inline-flex items-center rounded-md border border-[var(--border-subtle)] bg-[var(--surface-card)] px-2 py-0.5 text-xs font-bold text-[var(--accent-primary)]"
                >
                  Stage {stage}
                </span>
                <span class="text-lg font-bold text-[var(--ink-primary)]">{count}</span>
              </div>
            <span class="mt-2.5 block text-sm font-bold text-[var(--ink-primary)] group-hover:underline">
              {OPEN_SCIENCE_STAGE_LABELS[stage]}
            </span>
            <span class="mt-1.5 block text-xs leading-relaxed text-[var(--ink-secondary)]">
              {OPEN_SCIENCE_STAGE_DESCRIPTIONS[stage]}
            </span>
            </div>
            <div class="mt-4">
              <div class="flex items-center justify-between text-[11px] font-medium text-[var(--ink-muted)]">
                <span>{pct}% of indexed works</span>
                <span class="text-[var(--accent-primary)]">Filter -></span>
              </div>
              <div class="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[var(--border-subtle)]/50">
                <div
                  class="h-full rounded-full bg-[var(--accent-primary)]"
                  style="width: {Math.max(pct, count > 0 ? 6 : 0)}%"
                  data-progress-fill
                ></div>
              </div>
            </div>
          </button>
        </li>
      {/each}
    </ol>

    {#if upgradeGaps.length > 0}
      <!-- Open Science Upgrade Opportunities: highest-impact works one stage short -->
      <details
        class="mt-5 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-subtle)]/40 p-4"
      >
        <summary class="cursor-pointer text-sm font-semibold text-[var(--ink-primary)] hover:text-[var(--accent-primary)]">
          Open Science Upgrade Opportunities ({upgradeGaps.length} high-impact works)
        </summary>
        <ul class="mt-3 space-y-2">
          {#each upgradeGaps as gap (gap.publicationId)}
            <li
              class="flex flex-wrap items-start justify-between gap-2 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)] p-3"
            >
              <div class="min-w-0 flex-1">
                <button
                  type="button"
                  onclick={() => openGapPublication(gap)}
                  class="text-left text-sm font-semibold text-[var(--ink-primary)] hover:text-[var(--accent-primary)] hover:underline"
                >
                  {gap.title}
                </button>
                <div class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--ink-muted)]">
                  <span class="font-semibold text-[var(--accent-primary)]">
                    [Stage {gap.currentStage} -&gt; Stage {gap.targetStage}]
                  </span>
                  <span>{gap.citations} citations</span>
                  {#if gap.fwci !== null}
                    <span>FWCI {gap.fwci.toFixed(2)}</span>
                  {/if}
                  <span>{gap.year}</span>
                </div>
                <p class="mt-1 text-xs text-[var(--ink-secondary)]">
                  Next step: {gap.actionLabel}
                </p>
              </div>
              <button
                type="button"
                onclick={() => copyGapOverride(gap)}
                class="inline-flex min-h-8 shrink-0 items-center gap-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)] px-2.5 py-1 text-xs font-semibold text-[var(--ink-primary)] hover:border-[var(--border-strong)]"
              >
                {#if copiedGapId === gap.publicationId}
                  <Check class="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Copied</span>
                {:else}
                  <Copy class="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Copy YAML override</span>
                {/if}
              </button>
            </li>
          {/each}
        </ul>
      </details>
    {/if}
  </section>

  <!-- Two-Column Spotlight: Top-Cited Works & Upcoming Pipeline -->
  <div class="contain-section grid grid-cols-1 gap-6 lg:grid-cols-2">
    <section
      aria-labelledby="top-cited-heading"
      class="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-card)] p-6 shadow-xs"
    >
      <div class="flex items-center justify-between gap-2">
        <div>
          <h2 id="top-cited-heading" class="text-lg font-bold">Highest-Cited Outputs</h2>
          <p class="text-xs text-[var(--ink-muted)]">
            Click any publication for full metadata, Open Science links, and BibTeX
          </p>
        </div>
        <button
          type="button"
          onclick={() => (store.activeTab = 'publications')}
          class="min-h-8 rounded-lg px-2.5 py-1 text-xs font-semibold text-[var(--accent-primary)] hover:bg-[var(--surface-subtle)]"
        >
          View all ({metrics.worksCount}) ->
        </button>
      </div>

      <ul class="mt-4 divide-y divide-[var(--border-subtle)]">
        {#each topCited as pub (pub.id)}
          <li class="py-3 first:pt-0 last:pb-0">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0 flex-1">
                <button
                  type="button"
                  onclick={() => (store.selectedPublication = pub)}
                  class="text-left text-sm font-semibold text-[var(--ink-primary)] hover:text-[var(--accent-primary)] hover:underline"
                >
                  {pub.title}
                </button>
                <div class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--ink-muted)]">
                  <span>{pub.year}</span>
                  {#if pub.venue}
                    <span>·</span>
                    <span class="font-medium text-[var(--ink-secondary)]">{pub.venue}</span>
                  {/if}
                  {#if pub.openScienceStage >= 4}
                    <span
                      class="inline-flex items-center gap-1 rounded-full border border-[var(--accent-primary)]/40 px-2 py-0.2 text-[11px] font-semibold text-[var(--accent-primary)]"
                    >
                      <CheckCircle2 class="h-3 w-3" aria-hidden="true" />
                      Stage {pub.openScienceStage}
                    </span>
                  {/if}
                </div>
              </div>
              <div class="shrink-0 text-right">
                <span class="inline-block rounded-lg bg-[var(--surface-subtle)] px-2.5 py-1 text-sm font-bold tabular-nums">
                  {store.getCitations(pub).toLocaleString()}
                </span>
                <div class="mt-0.5 text-[10px] text-[var(--ink-muted)]">citations</div>
              </div>
            </div>
          </li>
        {/each}
      </ul>
    </section>

    <section
      aria-labelledby="pipeline-spotlight-heading"
      class="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-card)] p-6 shadow-xs"
    >
      <div class="flex items-center justify-between gap-2">
        <div>
          <h2 id="pipeline-spotlight-heading" class="text-lg font-bold">
            Active & Planned Papers Roadmap
          </h2>
          <p class="text-xs text-[var(--ink-muted)]">
            Highest-readiness manuscripts in the {roadmap.start}-{roadmap.end} publication pipeline
          </p>
        </div>
        <button
          type="button"
          onclick={() => (store.activeTab = 'pipeline')}
          class="min-h-8 rounded-lg px-2.5 py-1 text-xs font-semibold text-[var(--accent-primary)] hover:bg-[var(--surface-subtle)]"
        >
          Open planner ({store.allPlannedPapers.length}) ->
        </button>
      </div>

      <ul class="mt-4 divide-y divide-[var(--border-subtle)]">
        {#each nearestPlanned as paper (paper.slug)}
          {@const topTarget = paper.targetJournals[0]}
          <li class="py-3 first:pt-0 last:pb-0">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0 flex-1">
                <button
                  type="button"
                  onclick={() => (store.selectedPlannedPaper = paper)}
                  class="text-left text-sm font-semibold text-[var(--ink-primary)] hover:text-[var(--accent-primary)] hover:underline"
                >
                  {paper.title}
                </button>
                <div class="mt-1 flex flex-wrap items-center gap-2 text-xs text-[var(--ink-muted)]">
                  <span class="rounded-md bg-[var(--surface-subtle)] px-1.5 py-0.5 font-semibold text-[var(--ink-secondary)]">
                    {paper.targetSubmissionQuarter}
                  </span>
                  <span class="capitalize">{paper.status.replace('-', ' ')}</span>
                  {#if topTarget}
                    <span>· Target #1: <strong class="text-[var(--ink-secondary)]">{topTarget.journalName}</strong></span>
                  {/if}
                </div>
              </div>
              <div class="w-16 shrink-0 text-right">
                <span class="text-sm font-bold text-[var(--accent-primary)] tabular-nums">
                  {paper.readinessPercent}%
                </span>
                <div class="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-subtle)]">
                  <div
                    class="h-full rounded-full bg-[var(--accent-primary)]"
                    style="width: {paper.readinessPercent}%"
                    data-progress-fill
                  ></div>
                </div>
              </div>
            </div>
          </li>
        {/each}
      </ul>
    </section>
  </div>

  <!-- Deployed Stage 5 & Flagship Open Tools Strip -->
  {#if featuredStage5.length > 0}
    <section
      aria-labelledby="flagship-tools-heading"
      class="contain-section rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-card)] p-6 shadow-xs"
    >
      <h2 id="flagship-tools-heading" class="text-lg font-bold">
        Flagship Open-Source Tools, Packages & Reproducible Books
      </h2>
      <p class="mt-0.5 text-xs text-[var(--ink-muted)]">
        Outputs linking peer-reviewed scholarship directly to open software and deployed decision-support systems
      </p>
      <div class="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {#each featuredStage5.slice(0, 9) as pub (pub.id)}
          <div
            class="flex flex-col justify-between rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-subtle)]/40 p-4"
          >
            <div>
              <div class="flex items-center justify-between gap-2 text-xs">
                <span class="font-semibold text-[var(--accent-primary)]">
                  Stage {pub.openScienceStage} · {pub.year}
                </span>
                <span class="font-semibold tabular-nums text-[var(--ink-muted)]">
                  {store.getCitations(pub)} cites
                </span>
              </div>
              <button
                type="button"
                onclick={() => (store.selectedPublication = pub)}
                class="mt-1.5 line-clamp-2 text-left text-sm font-semibold text-[var(--ink-primary)] hover:text-[var(--accent-primary)] hover:underline"
              >
                {pub.title}
              </button>
            </div>
            <div class="mt-3 flex flex-wrap items-center gap-2 pt-2 border-t border-[var(--border-subtle)]/60">
              {#if pub.openScience.interactiveToolUrl}
                <a
                  href={safeHref(pub.openScience.interactiveToolUrl) ?? undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="inline-flex min-h-7 items-center gap-1 rounded-md bg-[var(--accent-primary)] px-2.5 py-1 text-xs font-semibold text-[var(--accent-primary-ink)] no-underline hover:opacity-90"
                >
                  <Globe class="h-3 w-3" aria-hidden="true" />
                  <span>{pub.openScience.interactiveToolName || 'Launch tool'}</span>
                  <ExternalLink class="h-3 w-3" aria-hidden="true" />
                </a>
              {/if}
              {#if pub.openScience.codeUrl}
                <a
                  href={safeHref(pub.openScience.codeUrl) ?? undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                  class="inline-flex min-h-7 items-center gap-1 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-card)] px-2.5 py-1 text-xs font-medium text-[var(--ink-primary)] no-underline hover:border-[var(--accent-primary)]"
                >
                  <FileCode2 class="h-3 w-3" aria-hidden="true" />
                  <span>Code</span>
                </a>
              {/if}
            </div>
          </div>
        {/each}
      </div>
    </section>
  {/if}
</div>
