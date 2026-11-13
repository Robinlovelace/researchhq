<script lang="ts">
  import {
    BookOpen,
    ExternalLink,
    FlaskConical,
    GitBranch,
    KanbanSquare,
    Lock,
    Plus,
    Rocket,
    Table2,
    Trash2
  } from '@lucide/svelte';
  import type { JournalMetric, PlannedPaper, TargetJournalCandidate } from '@researchhq/schema';
  import type { PortfolioStore } from '#lib/stores/portfolio.svelte';
  import { safeHref } from '#lib/utils/url';

  let { store }: { store: PortfolioStore } = $props();

  type PipelineView = 'kanban' | 'matrix';

  let view = $state<PipelineView>('kanban');

  // ---------------------------------------------------------------------------
  // Category filter (bound to the shared store so other tabs stay in sync)
  // ---------------------------------------------------------------------------

  const categoryOptions: Array<{
    value: 'all' | PlannedPaper['category'];
    label: string;
  }> = [
    { value: 'all', label: 'All ideas' },
    { value: 'flagship-project', label: 'Flagship' },
    { value: 'conceptual-methodology', label: 'Open Science' },
    { value: 'literature-gap', label: 'Literature Gap' }
  ];

  const CATEGORY_BADGES: Record<PlannedPaper['category'], { label: string; className: string }> = {
    'flagship-project': {
      label: 'Flagship Project',
      className:
        'bg-[color-mix(in_oklab,var(--accent-primary)_14%,transparent)] text-[var(--accent-primary)]'
    },
    'conceptual-methodology': {
      label: 'Open Science Framework',
      className:
        'bg-[color-mix(in_oklab,var(--accent-violet)_14%,transparent)] text-[var(--accent-violet)]'
    },
    'literature-gap': {
      label: 'Literature Gap',
      className:
        'bg-[color-mix(in_oklab,var(--accent-secondary)_14%,transparent)] text-[var(--accent-secondary)]'
    }
  };

  const STATUS_LABELS: Record<PlannedPaper['status'], string> = {
    idea: 'Idea',
    scoping: 'Scoping',
    'active-analysis': 'Active Analysis',
    drafting: 'Drafting',
    'under-review': 'Under Review',
    revision: 'Revision',
    accepted: 'Accepted'
  };

  // ---------------------------------------------------------------------------
  // Kanban lanes (content-visibility applied via the shared .kanban-lane class)
  // ---------------------------------------------------------------------------

  interface Lane {
    id: string;
    title: string;
    description: string;
    statuses: PlannedPaper['status'][];
    papers: PlannedPaper[];
  }

  const lanes = $derived.by<Lane[]>(() => {
    const papers = store.filteredPlannedPapers;
    const laneDefs: Array<Pick<Lane, 'id' | 'title' | 'description' | 'statuses'>> = [
      {
        id: 'concept',
        title: 'Concept & Literature Gap',
        description: 'Ideas being scoped against the literature',
        statuses: ['idea', 'scoping']
      },
      {
        id: 'analysis',
        title: 'Active Analysis',
        description: 'Data processing and modelling in flight',
        statuses: ['active-analysis']
      },
      {
        id: 'drafting',
        title: 'Drafting Manuscript',
        description: 'Writing figures, tables, and prose',
        statuses: ['drafting']
      },
      {
        id: 'review',
        title: 'Under Review & Accepted',
        description: 'Peer review, revision, and accepted work',
        statuses: ['under-review', 'revision', 'accepted']
      }
    ];
    return laneDefs.map((lane) => ({
      ...lane,
      papers: papers.filter((paper) => lane.statuses.includes(paper.status))
    }));
  });

  // ---------------------------------------------------------------------------
  // Journal metric helpers (live JIF / 2yr lookups from the OpenAlex snapshot)
  // ---------------------------------------------------------------------------

  function journalMetricFor(
    storeRef: PortfolioStore,
    journalId: string
  ): JournalMetric | undefined {
    return storeRef.snapshot?.journals.find((journal) => journal.id === journalId);
  }

  function journalPill(storeRef: PortfolioStore, candidate: TargetJournalCandidate): string {
    const journal = journalMetricFor(storeRef, candidate.journalId);
    const venue = journal?.shortName ?? journal?.name ?? candidate.journalName;
    const impact =
      journal?.jif != null
        ? `JIF ${journal.jif}`
        : journal?.twoYearMeanCitedness != null
          ? `2yr ${journal.twoYearMeanCitedness}`
          : 'metrics pending';
    return `#${candidate.rank} ${venue} · ${impact} · Fit ${Math.round(candidate.fitScore)}%`;
  }

  function rankedJournals(paper: PlannedPaper): TargetJournalCandidate[] {
    return [...paper.targetJournals].sort((a, b) => a.rank - b.rank);
  }

  function journalAtRank(
    paper: PlannedPaper,
    rank: 1 | 2 | 3
  ): TargetJournalCandidate | undefined {
    return rankedJournals(paper).find((candidate) => candidate.rank === rank);
  }

  function isLocalDraft(paper: PlannedPaper): boolean {
    return store.localDraftPapers.some((draft) => draft.slug === paper.slug);
  }

  const pillClass =
    'inline-flex items-center rounded-full bg-[var(--surface-subtle)] px-2 py-0.5 text-[0.65rem] font-medium text-[var(--ink-secondary)]';
  const chipLinkClass =
    'inline-flex items-center gap-1 rounded-full border border-[var(--border-subtle)] bg-[var(--surface-subtle)] px-2 py-0.5 text-[0.65rem] font-medium text-[var(--ink-secondary)] hover:text-[var(--ink-primary)] hover:border-[var(--border-strong)]';

  // Data-driven roadmap copy: year range and per-category paper counts come
  // from the snapshot instead of hardcoded slugs and hardcoded years.
  const roadmap = $derived(store.roadmapYearRange);
  const allPapers = $derived(store.allPlannedPapers);
  const categoryCounts = $derived.by(() => ({
    flagship: allPapers.filter((p) => p.category === 'flagship-project').length,
    openScience: allPapers.filter((p) => p.category === 'conceptual-methodology').length,
    literatureGap: allPapers.filter((p) => p.category === 'literature-gap').length
  }));

  function pluralize(count: number, singular: string): string {
    return `${count} ${singular}${count === 1 ? '' : 's'}`;
  }
</script>

<div class="space-y-6">
  <!-- ===================================================================== -->
  <!-- Header & Toolbar                                                       -->
  <!-- ===================================================================== -->
  <section
    aria-labelledby="pipeline-heading"
    class="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-card)] p-6 shadow-xs"
  >
    <div class="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
      <div>
        <div
          class="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--accent-primary)]"
        >
          <Rocket class="h-3.5 w-3.5" aria-hidden="true" />
          <span>Future Publications Roadmap ({roadmap.start}-{roadmap.end})</span>
        </div>
        <h2 id="pipeline-heading" class="mt-1 text-xl font-bold">
          Pipeline: Planned Papers &amp; Target Journals
        </h2>
        <p class="mt-1 max-w-3xl text-sm text-[var(--ink-secondary)]">
          This live {roadmap.start}-{roadmap.end} roadmap tracks
          {pluralize(allPapers.length, 'planned paper')}: {pluralize(categoryCounts.flagship, 'flagship project')},
          {pluralize(categoryCounts.openScience, 'Open Science framework')}, and
          {pluralize(categoryCounts.literatureGap, 'literature-gap paper')}. Ideas you add
          locally with the New Paper Idea button appear here instantly, next to the
          repository-sourced pipeline.
        </p>
      </div>

      <button
        type="button"
        onclick={() => (store.showIdeaComposer = true)}
        class="inline-flex min-h-10 flex-none items-center gap-1.5 rounded-lg bg-[var(--accent-primary)] px-4 py-2 text-sm font-semibold text-[var(--accent-primary-ink)] shadow-xs transition hover:opacity-90"
      >
        <Plus class="h-4 w-4" aria-hidden="true" />
        <span>New Paper Idea</span>
      </button>
    </div>

    <div class="mt-4 flex flex-wrap items-center gap-3">
      <div
        role="group"
        aria-label="Filter papers by category"
        class="inline-flex rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-subtle)] p-0.5 text-xs font-semibold"
      >
        {#each categoryOptions as option (option.value)}
          <button
            type="button"
            aria-pressed={store.pipelineCategoryFilter === option.value}
            onclick={() => (store.pipelineCategoryFilter = option.value)}
            class="min-h-8 rounded-md px-3 py-1 {store.pipelineCategoryFilter === option.value
              ? 'bg-[var(--surface-card)] text-[var(--ink-primary)] shadow-xs'
              : 'text-[var(--ink-muted)] hover:text-[var(--ink-primary)]'}"
          >
            {option.label}
          </button>
        {/each}
      </div>

      <div
        role="group"
        aria-label="Pipeline view mode"
        class="inline-flex rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-subtle)] p-0.5 text-xs font-semibold"
      >
        <button
          type="button"
          aria-pressed={view === 'kanban'}
          onclick={() => (view = 'kanban')}
          class="inline-flex min-h-8 items-center gap-1.5 rounded-md px-3 py-1 {view === 'kanban'
            ? 'bg-[var(--surface-card)] text-[var(--ink-primary)] shadow-xs'
            : 'text-[var(--ink-muted)] hover:text-[var(--ink-primary)]'}"
        >
          <KanbanSquare class="h-3.5 w-3.5" aria-hidden="true" />
          <span>Kanban Roadmap</span>
        </button>
        <button
          type="button"
          aria-pressed={view === 'matrix'}
          onclick={() => (view = 'matrix')}
          class="inline-flex min-h-8 items-center gap-1.5 rounded-md px-3 py-1 {view === 'matrix'
            ? 'bg-[var(--surface-card)] text-[var(--ink-primary)] shadow-xs'
            : 'text-[var(--ink-muted)] hover:text-[var(--ink-primary)]'}"
        >
          <Table2 class="h-3.5 w-3.5" aria-hidden="true" />
          <span>Target Journal Matrix</span>
        </button>
      </div>
    </div>
  </section>

  {#if view === 'kanban'}
    <!-- =================================================================== -->
    <!-- View 1: Kanban Roadmap                                               -->
    <!-- =================================================================== -->
    <div class="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
      {#each lanes as lane (lane.id)}
        <section
          class="kanban-lane flex flex-col gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-card)] p-4"
          aria-label="{lane.title}: {lane.papers.length} papers"
        >
          <header class="flex items-center justify-between gap-2">
            <div>
              <h3 class="text-sm font-bold text-[var(--ink-primary)]">{lane.title}</h3>
              <p class="text-[0.7rem] text-[var(--ink-muted)]">{lane.description}</p>
            </div>
            <span
              class="rounded-full bg-[var(--surface-subtle)] px-2 py-0.5 text-xs font-semibold text-[var(--ink-secondary)]"
            >
              {lane.papers.length}
            </span>
          </header>

          <div class="flex flex-col gap-3">
            {#each lane.papers as paper, paperIndex (paper.slug)}
              {@const badge = CATEGORY_BADGES[paper.category]}
              {@const isDraft = isLocalDraft(paper)}
              <article
                class="flex flex-col gap-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-card)] p-4 shadow-xs"
              >
                <div class="flex flex-wrap items-center gap-1.5">
                  <span
                    class="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide {badge.className}"
                  >
                    {#if paper.category === 'flagship-project'}
                      <Rocket class="h-3 w-3" aria-hidden="true" />
                    {:else if paper.category === 'conceptual-methodology'}
                      <BookOpen class="h-3 w-3" aria-hidden="true" />
                    {:else}
                      <FlaskConical class="h-3 w-3" aria-hidden="true" />
                    {/if}
                    {badge.label}
                  </span>
                  <span class="text-[0.7rem] font-medium text-[var(--ink-muted)]">
                    {paper.targetSubmissionQuarter} -> {paper.targetPublicationYear}
                  </span>
                </div>

                <!-- Percent complete bar (full width, own line so narrow lanes
                     never crush it) + single-click quick-step buttons -->
                <div class="flex flex-col gap-1">
                  <div
                    class="h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-subtle)]"
                    role="progressbar"
                    aria-valuenow={paper.readinessPercent}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-label="Percent complete: {paper.shortTitle}"
                  >
                    <div
                      class="h-full rounded-full bg-[var(--accent-primary)]"
                      style="width: {paper.readinessPercent}%"
                      data-progress-fill
                    ></div>
                  </div>
                  <div class="flex items-center gap-2">
                    <button
                      type="button"
                      aria-label="Decrease percent complete for {paper.shortTitle}: -10%"
                      onclick={() =>
                        store.setPaperProgress(paper.slug, {
                          readinessPercent: paper.readinessPercent - 10
                        })}
                      class="inline-flex min-h-6 items-center justify-center rounded-md border border-[var(--border-subtle)] bg-[var(--surface-subtle)] px-1.5 py-0.5 text-[0.6rem] font-bold text-[var(--ink-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--ink-primary)]"
                    >
                      -10%
                    </button>
                    <button
                      type="button"
                      aria-label="Increase percent complete for {paper.shortTitle}: +10%"
                      onclick={() =>
                        store.setPaperProgress(paper.slug, {
                          readinessPercent: paper.readinessPercent + 10
                        })}
                      class="inline-flex min-h-6 items-center justify-center rounded-md border border-[var(--border-subtle)] bg-[var(--surface-subtle)] px-1.5 py-0.5 text-[0.6rem] font-bold text-[var(--ink-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--ink-primary)]"
                    >
                      +10%
                    </button>
                    <span class="text-[0.65rem] font-semibold text-[var(--ink-muted)]">
                      Percent complete: {paper.readinessPercent}%
                    </span>
                  </div>
                </div>
                {#if store.hasProgressOverride(paper.slug)}
                  <span
                    class="w-fit rounded-md bg-[color-mix(in_oklab,var(--accent-amber)_14%,transparent)] px-1.5 py-0.5 text-[0.65rem] font-semibold text-[var(--accent-amber)]"
                  >
                    Modified locally
                  </span>
                {/if}

                <button
                  type="button"
                  class="text-left text-sm font-bold leading-snug text-[var(--ink-primary)] hover:text-[var(--accent-primary)]"
                  onclick={() => (store.selectedPlannedPaper = paper)}
                >
                  {paper.title}
                </button>

                {#if paper.summary}
                  <p class="line-clamp-3 text-xs text-[var(--ink-secondary)]">{paper.summary}</p>
                {/if}

                {#if paper.scientificGapFilled}
                  <p
                    class="rounded-lg border-l-2 border-[var(--accent-amber)] bg-[var(--surface-subtle)] p-2 text-xs text-[var(--ink-secondary)]"
                  >
                    <span class="font-semibold text-[var(--accent-amber)]">Gap filled:</span>
                    {paper.scientificGapFilled}
                  </p>
                {/if}

                <span
                  class="inline-flex w-fit items-center rounded-full border border-[var(--border-subtle)] bg-[var(--surface-subtle)] px-2 py-0.5 text-[0.65rem] font-semibold text-[var(--ink-secondary)]"
                >
                  Stage {paper.currentOpenScienceStage} -> Target Stage {paper.targetOpenScienceStage}
                </span>

                {#if paper.targetJournals.length > 0}
                  <div class="flex flex-wrap gap-1.5">
                    {#each rankedJournals(paper) as candidate, candidateIndex (candidateIndex)}
                      <span class={pillClass}>{journalPill(store, candidate)}</span>
                    {/each}
                  </div>
                {/if}

                {#if paper.repoUrls.length > 0 || paper.interactiveToolUrl}
                  <div class="flex flex-wrap items-center gap-1.5">
                    {#each paper.repoUrls as repo, repoIndex (repoIndex)}
                      {@const repoHref = safeHref(repo.url)}
                      {#if repoHref}
                        <a
                          class={chipLinkClass}
                          href={repoHref}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <GitBranch class="h-3 w-3" aria-hidden="true" />
                          {repo.label}
                        </a>
                      {:else if repo.url === '' || repo.visibility === 'private'}
                        <!-- redactUrlInPublic stripped the private URL at export time -->
                        <span
                          class="inline-flex items-center gap-1 rounded-full border border-dashed border-[var(--border-subtle)] px-2 py-0.5 text-[0.65rem] text-[var(--ink-muted)]"
                        >
                          <Lock class="h-3 w-3" aria-hidden="true" />
                          {repo.label} (Private)
                        </span>
                      {:else}
                        <!-- Unusable href: render as non-interactive text, never <a> without href -->
                        <span
                          class="inline-flex items-center gap-1 rounded-full border border-[var(--border-subtle)] px-2 py-0.5 text-[0.65rem] text-[var(--ink-muted)]"
                        >
                          {repo.label}
                        </span>
                      {/if}
                    {/each}
                    {#if paper.interactiveToolUrl}
                      {@const toolHref = safeHref(paper.interactiveToolUrl)}
                      {#if toolHref}
                        <a
                          class={chipLinkClass}
                          href={toolHref}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          <ExternalLink class="h-3 w-3" aria-hidden="true" />
                          Live tool
                        </a>
                      {:else}
                        <span
                          class="inline-flex items-center gap-1 rounded-full border border-[var(--border-subtle)] px-2 py-0.5 text-[0.65rem] text-[var(--ink-muted)]"
                        >
                          Live tool
                        </span>
                      {/if}
                    {/if}
                  </div>
                {/if}

                {#if isDraft}
                  <div
                    class="mt-auto flex items-center justify-between gap-2 border-t border-[var(--border-subtle)] pt-2"
                  >
                    <span
                      class="inline-flex items-center gap-1 rounded-full bg-[color-mix(in_oklab,var(--accent-amber)_14%,transparent)] px-2 py-0.5 text-[0.65rem] font-semibold text-[var(--accent-amber)]"
                    >
                      <BookOpen class="h-3 w-3" aria-hidden="true" />
                      Local Draft
                    </span>
                    <button
                      type="button"
                      class="inline-flex min-h-8 items-center gap-1 rounded-lg border border-[var(--border-subtle)] px-2 py-1 text-[0.7rem] font-semibold text-[var(--ink-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--ink-primary)]"
                      onclick={() => store.removeLocalIdea(paper.slug)}
                    >
                      <Trash2 class="h-3.5 w-3.5" aria-hidden="true" />
                      Remove draft
                    </button>
                  </div>
                {/if}
              </article>
            {:else}
              <p
                class="rounded-lg border border-dashed border-[var(--border-subtle)] p-3 text-xs text-[var(--ink-muted)]"
              >
                No papers in this lane yet.
              </p>
            {/each}
          </div>
        </section>
      {/each}
    </div>
  {:else}
    <!-- =================================================================== -->
    <!-- View 2: Target Journal Matrix                                        -->
    <!-- =================================================================== -->
    <section aria-labelledby="matrix-heading">
      <h3 id="matrix-heading" class="mb-2 text-sm font-semibold text-[var(--ink-secondary)]">
        Target Journal Matrix: every filtered planned paper, ranked journal candidates side by side
      </h3>
      <!-- svelte-ignore a11y_no_noninteractive_tabindex: scrollable region needs keyboard access -->
      <div class="table-wrapper" tabindex="0" role="region" aria-labelledby="matrix-heading">
        <table class="data-table responsive-cards">
          <caption class="sr-only-live">
            Comparison of planned papers by category, status, target quarter and year, Open Science target, and ranked target journals with journal impact factors
          </caption>
          <thead>
            <tr>
              <th scope="col" class="col-padded">Planned Paper</th>
              <th scope="col" class="col-padded">Category &amp; Status</th>
              <th scope="col" class="col-padded">Target Quarter / Year</th>
              <th scope="col" class="col-padded">Open Science Target</th>
              <th scope="col" class="col-padded">Rank #1 Journal (JIF / 2yr)</th>
              <th scope="col" class="col-padded">Rank #2 Journal (JIF / 2yr)</th>
              <th scope="col" class="col-padded">Rank #3 Journal</th>
              <th scope="col" class="col-padded">Details</th>
            </tr>
          </thead>
          <tbody>
            {#each store.filteredPlannedPapers as paper (paper.slug)}
              <tr>
                <td class="cell-title" data-label="Planned Paper">
                  <button
                    type="button"
                    class="text-left font-semibold text-[var(--accent-secondary)] hover:underline"
                    onclick={() => (store.selectedPlannedPaper = paper)}
                  >
                    {paper.title}
                  </button>
                </td>
                <td data-label="Category &amp; Status">
                  <span
                    class="inline-flex items-center rounded-full px-2 py-0.5 text-[0.65rem] font-semibold uppercase tracking-wide {CATEGORY_BADGES[
                      paper.category
                    ].className}"
                  >
                    {CATEGORY_BADGES[paper.category].label}
                  </span>
                  <span class="mt-1 block text-xs text-[var(--ink-muted)]">
                    {STATUS_LABELS[paper.status]}
                  </span>
                  <span class="mt-1 block text-xs text-[var(--ink-muted)]">
                    Percent complete: {paper.readinessPercent}%
                    {#if store.hasProgressOverride(paper.slug)}
                      <span class="font-semibold text-[var(--accent-amber)]"> (modified locally)</span>
                    {/if}
                  </span>
                </td>
                <td data-label="Target Quarter / Year">
                  {paper.targetSubmissionQuarter} -> {paper.targetPublicationYear}
                </td>
                <td data-label="Open Science Target">Stage {paper.targetOpenScienceStage}</td>
                <td data-label="Rank #1 Journal (JIF / 2yr)">
                  {#if journalAtRank(paper, 1)}
                    <span class={pillClass}>{journalPill(store, journalAtRank(paper, 1)!)}</span>
                  {:else}
                    <span class="text-xs text-[var(--ink-muted)]">Not set</span>
                  {/if}
                </td>
                <td data-label="Rank #2 Journal (JIF / 2yr)">
                  {#if journalAtRank(paper, 2)}
                    <span class={pillClass}>{journalPill(store, journalAtRank(paper, 2)!)}</span>
                  {:else}
                    <span class="text-xs text-[var(--ink-muted)]">Not set</span>
                  {/if}
                </td>
                <td data-label="Rank #3 Journal">
                  {#if journalAtRank(paper, 3)}
                    <span class={pillClass}>{journalPill(store, journalAtRank(paper, 3)!)}</span>
                  {:else}
                    <span class="text-xs text-[var(--ink-muted)]">Not set</span>
                  {/if}
                </td>
                <td data-label="Details">
                  <button
                    type="button"
                    class="inline-flex min-h-8 items-center gap-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-subtle)] px-2.5 py-1 text-xs font-semibold text-[var(--ink-primary)] hover:border-[var(--border-strong)]"
                    onclick={() => (store.selectedPlannedPaper = paper)}
                  >
                    Details
                  </button>
                </td>
              </tr>
            {:else}
              <tr>
                <td colspan="8" class="text-center text-sm text-[var(--ink-muted)]">
                  No planned papers match the current category filter.
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <p class="mt-2 text-xs text-[var(--ink-muted)]" role="status">
        {store.filteredPlannedPapers.length}
        planned papers shown. Scroll the matrix horizontally on small screens: the wrapper is a focusable region.
      </p>
    </section>
  {/if}
</div>
