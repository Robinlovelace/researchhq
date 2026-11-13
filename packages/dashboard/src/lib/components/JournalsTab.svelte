<script lang="ts">
  import {
    ArrowDown,
    ArrowUp,
    BookOpen,
    Eye,
    EyeOff,
    ListFilter,
    Search,
    Target,
    TrendingUp
  } from '@lucide/svelte';
  import type { JournalMetric } from '@researchhq/schema';
  import { compareStrings } from '#lib/stores/portfolio.svelte';
  import type { PortfolioStore } from '#lib/stores/portfolio.svelte';

  let { store }: { store: PortfolioStore } = $props();

  // ---------------------------------------------------------------------------
  // Summary banner data
  // ---------------------------------------------------------------------------
  const journals = $derived(store.snapshot?.journals ?? []);
  const publishedJournals = $derived(journals.filter((j) => j.authorPublishedCount > 0));
  const targetJournals = $derived(journals.filter((j) => j.targetPaperCount > 0));
  const peerReviewedPublishedCount = $derived(
    publishedJournals.filter((j) => !j.venueType || j.venueType === 'journal').length
  );

  const jifStats = $derived.by(() => {
    const pairs = publishedJournals
      .map((j) => ({ jif: j.jif, count: j.authorPublishedCount }))
      .filter((p): p is { jif: number; count: number } => typeof p.jif === 'number' && p.jif > 0);
    const weightSum = pairs.reduce((acc, p) => acc + p.count, 0);
    const weighted =
      weightSum > 0 ? pairs.reduce((acc, p) => acc + p.jif * p.count, 0) / weightSum : null;
    const simple = pairs.length > 0 ? pairs.reduce((acc, p) => acc + p.jif, 0) / pairs.length : null;
    return { weighted, simple, venueCount: pairs.length, articleCount: weightSum };
  });

  const topJournal = $derived.by(() => {
    let best: JournalMetric | null = null;
    for (const j of publishedJournals) {
      if (!best || j.authorPublishedCount > best.authorPublishedCount) best = j;
    }
    return best;
  });

  // ---------------------------------------------------------------------------
  // Scatter plot (JIF vs OpenAlex 2yr mean citedness)
  // ---------------------------------------------------------------------------
  let showScatter = $state(true);
  let zoomToCore = $state(true);
  let highlightedId = $state<string | null>(null);

  type JournalRole = 'published' | 'target' | 'both';

  function journalRole(j: JournalMetric): JournalRole {
    const isPublished = j.authorPublishedCount > 0;
    const isTarget = j.targetPaperCount > 0;
    if (isPublished && isTarget) return 'both';
    return isPublished ? 'published' : 'target';
  }

  const plottedJournals = $derived.by(() => {
    return store.filteredJournals.filter(
      (j) =>
        typeof j.jif === 'number' &&
        j.jif > 0 &&
        j.twoYearMeanCitedness != null &&
        (j.authorPublishedCount > 0 || j.targetPaperCount > 0)
    );
  });

  const roleCounts = $derived.by(() => {
    let published = 0;
    let target = 0;
    let both = 0;
    for (const j of plottedJournals) {
      const role = journalRole(j);
      if (role === 'both') both++;
      else if (role === 'target') target++;
      else published++;
    }
    return { published, target, both };
  });

  const jifMax = $derived.by(() => {
    let max = 1;
    for (const j of plottedJournals) {
      const jif = j.jif ?? 0;
      if (jif > max) max = jif;
    }
    return max;
  });

  // Zoom cap keeps outliers such as Nature Sustainability (JIF 32) from
  // crushing the 2-11 JIF range where transport and GIS journals live.
  const yMax = $derived(zoomToCore ? Math.min(jifMax, 12) : jifMax);

  const xMax = $derived.by(() => {
    let max = 1;
    for (const j of plottedJournals) {
      const x = j.twoYearMeanCitedness ?? 0;
      if (x > max) max = x;
    }
    return max;
  });

  const chartWidth = 640;
  const chartHeight = 380;
  const margin = { top: 16, right: 24, bottom: 46, left: 58 };
  const innerWidth = chartWidth - margin.left - margin.right;
  const innerHeight = chartHeight - margin.top - margin.bottom;

  function xScale(value: number): number {
    return margin.left + (Math.max(0, value) / xMax) * innerWidth;
  }

  function yScale(value: number): number {
    return margin.top + innerHeight - (Math.max(0, Math.min(value, yMax)) / yMax) * innerHeight;
  }

  const xTickValues = $derived.by(() => Array.from({ length: 5 }, (_, i) => (xMax / 4) * i));
  const yTickValues = $derived.by(() => Array.from({ length: 5 }, (_, i) => (yMax / 4) * i));

  function formatTick(value: number): string {
    return value >= 10 ? value.toFixed(0) : value.toFixed(1);
  }

  function diamondPath(cx: number, cy: number, size: number): string {
    return `M ${cx} ${cy - size} L ${cx + size} ${cy} L ${cx} ${cy + size} L ${cx - size} ${cy} Z`;
  }

  const highlightedJournal = $derived.by(
    () => journals.find((j) => j.id === highlightedId) ?? null
  );

  function selectPoint(j: JournalMetric): void {
    highlightedId = highlightedId === j.id ? null : j.id;
    store.announce(
      highlightedId
        ? `Highlighted journal: ${j.name}`
        : 'Cleared journal highlight'
    );
  }

  function metricSourceTip(source: JournalMetric['metricSource']): string {
    if (source === 'hybrid') {
      return 'Metric provenance: hybrid (OpenAlex automated data merged with curated publisher records)';
    }
    if (source === 'curated') {
      return 'Metric provenance: curated (locally maintained publisher data, e.g. Clarivate JCR)';
    }
    return 'Metric provenance: OpenAlex (automated source records)';
  }

  // ---------------------------------------------------------------------------
  // Sortable journals table
  // ---------------------------------------------------------------------------
  type SortDir = 'asc' | 'desc';
  type JournalSortKey =
    | 'name'
    | 'published'
    | 'citations'
    | 'mean'
    | 'jif'
    | 'citedness'
    | 'hindex'
    | 'oa'
    | 'targets';

  let sortCol = $state<JournalSortKey>('name');
  let sortDir = $state<SortDir>('asc');

  const journalSortLabels: Record<JournalSortKey, string> = {
    name: 'Journal and Publisher',
    published: 'Published Papers',
    citations: 'Total Citations',
    mean: 'Mean Citations',
    jif: 'Impact Factor (JIF)',
    citedness: 'OpenAlex 2yr Citedness',
    hindex: 'Journal h-index',
    oa: 'OA Model and APC',
    targets: 'Target Pipeline'
  };

  const journalAccessors: Record<JournalSortKey, (j: JournalMetric) => string | number> = {
    name: (j) => j.name,
    published: (j) => j.authorPublishedCount,
    citations: (j) => j.authorCitationsTotal,
    mean: (j) => j.authorCitationsMean,
    jif: (j) => j.jif ?? -1,
    citedness: (j) => j.twoYearMeanCitedness ?? -1,
    hindex: (j) => j.journalHIndex ?? -1,
    oa: (j) => j.oaModel ?? 'unknown',
    targets: (j) => j.targetPaperCount
  };

  function toggleSort(col: JournalSortKey): void {
    if (sortCol === col) {
      sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      sortCol = col;
      sortDir = 'asc';
    }
    store.announce(
      `Sorted by ${journalSortLabels[sortCol]}, ${sortDir === 'asc' ? 'ascending' : 'descending'}`
    );
  }

  const sortedJournals = $derived.by(() => {
    const list = [...store.filteredJournals];
    const dir = sortDir === 'asc' ? 1 : -1;
    const get = journalAccessors[sortCol];
    return list.sort((a, b) => {
      const av = get(a);
      const bv = get(b);
      if (typeof av === 'string' || typeof bv === 'string') {
        return compareStrings(String(av), String(bv)) * dir;
      }
      return (av - bv) * dir;
    });
  });
</script>

<div class="space-y-8">
  <!-- Summary banner cards -->
  <section aria-labelledby="journal-kpi-heading">
    <h2 id="journal-kpi-heading" class="sr-only">Journal summary metrics</h2>
    <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <div class="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-card)] p-4 shadow-xs">
        <div class="flex items-center justify-between text-xs font-semibold tracking-wide text-[var(--ink-muted)] uppercase">
          <span>Journals Published In</span>
          <BookOpen class="h-4 w-4 text-[var(--accent-primary)]" aria-hidden="true" />
        </div>
        <div class="mt-2 flex items-baseline gap-2">
          <span class="text-3xl font-bold tracking-tight">{peerReviewedPublishedCount}</span>
          <span class="text-xs font-medium text-[var(--ink-muted)]">peer-reviewed venues</span>
        </div>
        <p class="mt-1 text-xs text-[var(--ink-muted)]">
          Venues with at least one indexed article of yours
        </p>
      </div>

      <div class="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-card)] p-4 shadow-xs">
        <div class="flex items-center justify-between text-xs font-semibold tracking-wide text-[var(--ink-muted)] uppercase">
          <span>Weighted Mean JIF</span>
          <TrendingUp class="h-4 w-4 text-[var(--accent-secondary)]" aria-hidden="true" />
        </div>
        <div class="mt-2 flex items-baseline gap-2">
          <span class="text-3xl font-bold tracking-tight">
            {jifStats.weighted != null ? jifStats.weighted.toFixed(2) : 'n/a'}
          </span>
          <span class="text-xs font-medium text-[var(--ink-muted)]">Clarivate JCR</span>
        </div>
        <p class="mt-1 text-xs text-[var(--ink-muted)]">
          {#if jifStats.simple != null}
            Weighted by {jifStats.articleCount} articles across {jifStats.venueCount} venues · simple mean {jifStats.simple.toFixed(2)}
          {:else}
            No Clarivate JIF data available yet
          {/if}
        </p>
      </div>

      <div class="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-card)] p-4 shadow-xs">
        <div class="flex items-center justify-between text-xs font-semibold tracking-wide text-[var(--ink-muted)] uppercase">
          <span>Highest-Output Journal</span>
          <ListFilter class="h-4 w-4 text-[var(--accent-primary)]" aria-hidden="true" />
        </div>
        <div class="mt-2 flex items-baseline gap-2">
          {#if topJournal}
            <span class="text-lg font-bold tracking-tight">{topJournal.shortName ?? topJournal.name}</span>
            <span class="text-xs font-medium text-[var(--ink-muted)]">
              {topJournal.authorPublishedCount} papers
            </span>
          {:else}
            <span class="text-lg font-bold tracking-tight">-</span>
          {/if}
        </div>
        <p class="mt-1 truncate text-xs text-[var(--ink-muted)]" title={topJournal?.name ?? ''}>
          {topJournal?.name ?? 'No published articles indexed yet'}
        </p>
      </div>

      <div class="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-card)] p-4 shadow-xs">
        <div class="flex items-center justify-between text-xs font-semibold tracking-wide text-[var(--ink-muted)] uppercase">
          <span>Target Venues</span>
          <Target class="h-4 w-4 text-[var(--accent-violet)]" aria-hidden="true" />
        </div>
        <div class="mt-2 flex items-baseline gap-2">
          <span class="text-3xl font-bold tracking-tight">{targetJournals.length}</span>
          <span class="text-xs font-medium text-[var(--ink-muted)]">candidate journals</span>
        </div>
        <p class="mt-1 text-xs text-[var(--ink-muted)]">
          Venues targeted by the {store.roadmapYearRange.start}-{store.roadmapYearRange.end} planned paper pipeline
        </p>
      </div>
    </div>
  </section>

  <!-- Interactive scatter plot: Clarivate JIF vs OpenAlex 2yr mean citedness -->
  <section
    aria-labelledby="jif-scatter-heading"
    class="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-card)] p-6 shadow-xs"
  >
    <figure>
      <div class="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <h2 id="jif-scatter-heading" class="text-lg font-bold">
            Journal Impact vs OpenAlex Citedness
          </h2>
          <p class="text-xs text-[var(--ink-muted)]">
            Clarivate Journal Impact Factor (y) against OpenAlex 2yr mean citedness (x) · click a
            point to highlight the venue
          </p>
        </div>
        <div class="flex flex-wrap items-center gap-x-4 gap-y-2">
          <label
            for="jif-zoom-checkbox"
            class="inline-flex min-h-8 cursor-pointer items-center gap-2 text-xs font-medium text-[var(--ink-secondary)]"
          >
            <input id="jif-zoom-checkbox" type="checkbox" bind:checked={zoomToCore} class="h-4 w-4" />
            <span>Zoom to standard JIF range (JIF &lt;= 12)</span>
          </label>
          <button
            type="button"
            onclick={() => (showScatter = !showScatter)}
            class="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-subtle)] px-2.5 py-1 text-xs font-semibold hover:border-[var(--accent-primary)]"
          >
            {#if showScatter}
              <EyeOff class="h-3.5 w-3.5" aria-hidden="true" />
              <span>Hide chart</span>
            {:else}
              <Eye class="h-3.5 w-3.5" aria-hidden="true" />
              <span>Show chart</span>
            {/if}
          </button>
        </div>
      </div>

      {#if showScatter}
        <div class="mt-4 overflow-x-auto">
          <svg
            viewBox="0 0 640 380"
            role="group"
            class="min-w-[560px]"
            aria-label="Scatter plot of Clarivate Journal Impact Factor against OpenAlex 2yr mean citedness for published and target venues"
          >
            <!-- Grid lines and axis ticks -->
            {#each xTickValues as tick (tick)}
              <line
                x1={xScale(tick)}
                y1={margin.top}
                x2={xScale(tick)}
                y2={margin.top + innerHeight}
                stroke="var(--border-subtle)"
                stroke-opacity="0.5"
              />
              <text
                x={xScale(tick)}
                y={chartHeight - margin.bottom + 16}
                text-anchor="middle"
                font-size="10"
                fill="var(--ink-muted)"
              >
                {formatTick(tick)}
              </text>
            {/each}
            {#each yTickValues as tick (tick)}
              <line
                x1={margin.left}
                y1={yScale(tick)}
                x2={margin.left + innerWidth}
                y2={yScale(tick)}
                stroke="var(--border-subtle)"
                stroke-opacity="0.5"
              />
              <text
                x={margin.left - 8}
                y={yScale(tick) + 3}
                text-anchor="end"
                font-size="10"
                fill="var(--ink-muted)"
              >
                {formatTick(tick)}
              </text>
            {/each}

            <!-- Axis frame -->
            <line
              x1={margin.left}
              y1={margin.top + innerHeight}
              x2={margin.left + innerWidth}
              y2={margin.top + innerHeight}
              stroke="var(--border-strong)"
            />
            <line
              x1={margin.left}
              y1={margin.top}
              x2={margin.left}
              y2={margin.top + innerHeight}
              stroke="var(--border-strong)"
            />

            <!-- Axis labels -->
            <text
              x={margin.left + innerWidth / 2}
              y={chartHeight - 6}
              text-anchor="middle"
              font-size="11"
              font-weight="600"
              fill="var(--ink-secondary)"
            >
              OpenAlex 2yr Mean Citedness
            </text>
            <text
              transform="translate(14, {margin.top + innerHeight / 2}) rotate(-90)"
              text-anchor="middle"
              font-size="11"
              font-weight="600"
              fill="var(--ink-secondary)"
            >
              Clarivate JIF (JCR)
            </text>

            <!-- Data points: shape encodes venue role, colour is a redundant cue only -->
            {#each plottedJournals as j (j.id)}
              {@const role = journalRole(j)}
              {@const jifVal = j.jif ?? 0}
              {@const aboveZoom = jifVal > yMax}
              {@const cy = yScale(jifVal)}
              {@const cx = xScale(j.twoYearMeanCitedness ?? 0)}
              {@const isHi = highlightedId === j.id}
              <g
                role="button"
                tabindex="0"
                aria-label="{j.name}: JIF {jifVal.toFixed(1)}, OpenAlex 2yr {(j.twoYearMeanCitedness ?? 0).toFixed(2)}, {j.authorPublishedCount} published, {j.targetPaperCount} targeted"
                class="cursor-pointer"
                onclick={() => selectPoint(j)}
                onkeydown={(e: KeyboardEvent) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    selectPoint(j);
                  }
                }}
              >
                <title>
                  {j.name} (JIF {jifVal.toFixed(1)}{aboveZoom ? ', above zoom range, shown at cap' : ''}, OpenAlex 2yr {(j.twoYearMeanCitedness ?? 0).toFixed(2)}, {j.authorPublishedCount} published, {j.targetPaperCount} targeted)
                </title>
                {#if role === 'published'}
                  <circle
                    cx={cx}
                    cy={cy}
                    r={isHi ? 9 : 7}
                    fill="var(--accent-primary)"
                    stroke={isHi ? 'var(--ink-primary)' : 'var(--surface-card)'}
                    stroke-width="1.5"
                  />
                {:else if role === 'target'}
                  <path
                    d={diamondPath(cx, cy, isHi ? 10 : 8)}
                    fill="var(--accent-violet)"
                    fill-opacity="0.15"
                    stroke="var(--accent-violet)"
                    stroke-width="2"
                    stroke-dasharray="4 3"
                  />
                {:else}
                  <circle
                    cx={cx}
                    cy={cy}
                    r={isHi ? 6 : 5}
                    fill="var(--accent-secondary)"
                    stroke="var(--surface-card)"
                    stroke-width="1"
                  />
                  <circle
                    cx={cx}
                    cy={cy}
                    r={isHi ? 11 : 9}
                    fill="none"
                    stroke={isHi ? 'var(--ink-primary)' : 'var(--accent-secondary)'}
                    stroke-width="2"
                  />
                {/if}
                {#if aboveZoom}
                  <!-- Upward marker: JIF exceeds the zoomed axis cap -->
                  <text
                    x={cx}
                    y={cy - 14}
                    text-anchor="middle"
                    font-size="9"
                    font-weight="700"
                    fill="var(--accent-primary)"
                    aria-hidden="true"
                  >
                    ▲
                  </text>
                {/if}
              </g>
            {/each}

            {#if plottedJournals.length === 0}
              <text
                x={margin.left + innerWidth / 2}
                y={margin.top + innerHeight / 2}
                text-anchor="middle"
                font-size="13"
                fill="var(--ink-muted)"
              >
                No venues with both JIF and OpenAlex citedness match the current filters
              </text>
            {/if}
          </svg>
        </div>
      {/if}

      <figcaption class="mt-3 space-y-2 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-subtle)]/60 px-4 py-3 text-xs">
        <!-- Shape legend (shape and stroke, not colour alone) -->
        <div class="flex flex-wrap items-center gap-x-5 gap-y-2">
          <span class="inline-flex items-center gap-1.5">
            <svg viewBox="0 0 16 16" class="h-4 w-4" aria-hidden="true">
              <circle cx="8" cy="8" r="6" fill="var(--accent-primary)" stroke="var(--surface-card)" stroke-width="1" />
            </svg>
            <span>Published only</span>
          </span>
          <span class="inline-flex items-center gap-1.5">
            <svg viewBox="0 0 16 16" class="h-4 w-4" aria-hidden="true">
              <path d="M 8 1 L 15 8 L 8 15 L 1 8 Z" fill="var(--accent-violet)" fill-opacity="0.15" stroke="var(--accent-violet)" stroke-width="1.5" stroke-dasharray="3 2" />
            </svg>
            <span>Target only</span>
          </span>
          <span class="inline-flex items-center gap-1.5">
            <svg viewBox="0 0 16 16" class="h-4 w-4" aria-hidden="true">
              <circle cx="8" cy="8" r="3" fill="var(--accent-secondary)" />
              <circle cx="8" cy="8" r="6" fill="none" stroke="var(--accent-secondary)" stroke-width="1.5" />
            </svg>
            <span>Both published and target</span>
          </span>
          <span class="text-[var(--ink-muted)]">
            {plottedJournals.length} venues plotted ({roleCounts.published} published only, {roleCounts.target} target only, {roleCounts.both} both)
          </span>
        </div>

        <!-- Responsible metrics note: JIF is a journal-level average (DORA) -->
        <p class="border-t border-[var(--border-subtle)]/60 pt-2 text-[var(--ink-muted)]">
          Responsible metrics: the Journal Impact Factor describes journal-level averages only and
          is not a measure of the quality or impact of individual papers or authors (see the San
          Francisco Declaration on Research Assessment, DORA).
        </p>

        <!-- Highlighted journal inspector -->
        {#if highlightedJournal}
          <div class="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--border-subtle)] pt-2">
            <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span class="text-sm font-bold text-[var(--ink-primary)]">{highlightedJournal.name}</span>
              {#if highlightedJournal.jif != null}
                <span>JIF {highlightedJournal.jif.toFixed(2)}</span>
              {/if}
              {#if highlightedJournal.twoYearMeanCitedness != null}
                <span>OpenAlex 2yr {highlightedJournal.twoYearMeanCitedness.toFixed(2)}</span>
              {/if}
              <span>{highlightedJournal.authorPublishedCount} published · {highlightedJournal.targetPaperCount} targeted</span>
            </div>
            <div class="flex flex-wrap items-center gap-2">
              {#if highlightedJournal.authorPublishedCount > 0}
                <button
                  type="button"
                  onclick={() =>
                    store.filterByJournalAndNavigate(highlightedJournal.id, highlightedJournal.name)}
                  aria-label="Filter papers in {highlightedJournal.name}"
                  class="inline-flex min-h-7 items-center gap-1 rounded-md bg-[var(--accent-primary)] px-2.5 py-1 font-semibold text-[var(--accent-primary-ink)] hover:opacity-90"
                >
                  <ListFilter class="h-3 w-3" aria-hidden="true" />
                  <span>Filter papers</span>
                </button>
              {/if}
              <button
                type="button"
                onclick={() => (highlightedId = null)}
                class="inline-flex min-h-7 items-center rounded-md border border-[var(--border-subtle)] px-2.5 py-1 font-semibold hover:border-[var(--accent-primary)]"
              >
                Clear highlight
              </button>
            </div>
          </div>
        {:else}
          <p class="text-[var(--ink-muted)]">
            Click any point to highlight that journal and filter its publications from here.
          </p>
        {/if}
      </figcaption>
    </figure>
  </section>

  <!-- Filter bar -->
  <search aria-label="Journal filters" class="block rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-card)] p-4 shadow-xs">
    <div class="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
      <div class="flex flex-1 flex-col gap-3 sm:flex-row sm:items-end">
        <div class="flex-1">
          <label for="journal-search-input" class="mb-1 block text-xs font-semibold text-[var(--ink-secondary)]">
            Search journals
          </label>
          <div class="relative">
            <Search class="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-[var(--ink-muted)]" aria-hidden="true" />
            <input
              id="journal-search-input"
              type="search"
              bind:value={store.journalSearch}
              placeholder="Name, publisher, or scope tag"
              class="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-subtle)] py-2 pr-3 pl-9 text-sm placeholder:text-[var(--ink-muted)]"
            />
          </div>
        </div>
        <div role="group" aria-label="Journal scope" class="flex flex-wrap items-center gap-1.5">
          {#each [['all', 'All'], ['published', 'Published'], ['targets', 'Targets'], ['oa', 'Open Access']] as [scope, label] (scope)}
            <button
              type="button"
              aria-pressed={store.journalScopeFilter === scope}
              onclick={() => (store.journalScopeFilter = scope as typeof store.journalScopeFilter)}
              class="min-h-8 rounded-lg border px-3 py-1 text-xs font-semibold {store.journalScopeFilter === scope
                ? 'border-[var(--accent-primary)] bg-[var(--accent-primary)] text-[var(--accent-primary-ink)]'
                : 'border-[var(--border-subtle)] bg-[var(--surface-subtle)] text-[var(--ink-secondary)] hover:border-[var(--accent-primary)]'}"
            >
              {label}
            </button>
          {/each}
        </div>
      </div>
      <label
        for="journal-nonjournal-checkbox"
        class="inline-flex min-h-8 shrink-0 cursor-pointer items-center gap-2 text-xs font-medium text-[var(--ink-secondary)]"
      >
        <input id="journal-nonjournal-checkbox" type="checkbox" bind:checked={store.includeNonJournalVenues} class="h-4 w-4" />
        <span>Include book series &amp; repositories</span>
      </label>
    </div>
  </search>

  <!-- Sortable journals table -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div
    tabindex="0"
    role="region"
    aria-labelledby="journal-table-heading"
    class="table-wrapper"
  >
    <h2 id="journal-table-heading" class="sr-only">Journals table</h2>
    <table class="data-table responsive-cards">
      <caption class="sr-only-live">
        Sortable journals table: sort with the header buttons, filter papers with the action column
      </caption>
      <thead>
        <tr>
          <th scope="col" aria-sort={sortCol === 'name' ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}>
            <button type="button" class="sort-btn" onclick={() => toggleSort('name')}>
              <span>Journal &amp; Publisher</span>
              {#if sortCol === 'name'}
                {#if sortDir === 'asc'}
                  <ArrowUp class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {:else}
                  <ArrowDown class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {/if}
              {/if}
            </button>
          </th>
          <th scope="col" aria-sort={sortCol === 'published' ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}>
            <button type="button" class="sort-btn" onclick={() => toggleSort('published')}>
              <span>Published Papers</span>
              {#if sortCol === 'published'}
                {#if sortDir === 'asc'}
                  <ArrowUp class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {:else}
                  <ArrowDown class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {/if}
              {/if}
            </button>
          </th>
          <th scope="col" aria-sort={sortCol === 'citations' ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}>
            <button type="button" class="sort-btn" onclick={() => toggleSort('citations')}>
              <span>Total Citations</span>
              {#if sortCol === 'citations'}
                {#if sortDir === 'asc'}
                  <ArrowUp class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {:else}
                  <ArrowDown class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {/if}
              {/if}
            </button>
          </th>
          <th scope="col" aria-sort={sortCol === 'mean' ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}>
            <button type="button" class="sort-btn" onclick={() => toggleSort('mean')}>
              <span>Mean Citations</span>
              {#if sortCol === 'mean'}
                {#if sortDir === 'asc'}
                  <ArrowUp class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {:else}
                  <ArrowDown class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {/if}
              {/if}
            </button>
          </th>
          <th scope="col" title="Clarivate Journal Citation Reports Impact Factor" aria-sort={sortCol === 'jif' ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}>
            <button type="button" class="sort-btn" onclick={() => toggleSort('jif')}>
              <span>Impact Factor (JIF)</span>
              {#if sortCol === 'jif'}
                {#if sortDir === 'asc'}
                  <ArrowUp class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {:else}
                  <ArrowDown class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {/if}
              {/if}
            </button>
          </th>
          <th scope="col" aria-sort={sortCol === 'citedness' ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}>
            <button type="button" class="sort-btn" onclick={() => toggleSort('citedness')}>
              <span>OpenAlex 2yr Citedness</span>
              {#if sortCol === 'citedness'}
                {#if sortDir === 'asc'}
                  <ArrowUp class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {:else}
                  <ArrowDown class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {/if}
              {/if}
            </button>
          </th>
          <th scope="col" aria-sort={sortCol === 'hindex' ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}>
            <button type="button" class="sort-btn" onclick={() => toggleSort('hindex')}>
              <span>Journal h-index</span>
              {#if sortCol === 'hindex'}
                {#if sortDir === 'asc'}
                  <ArrowUp class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {:else}
                  <ArrowDown class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {/if}
              {/if}
            </button>
          </th>
          <th scope="col" aria-sort={sortCol === 'oa' ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}>
            <button type="button" class="sort-btn" onclick={() => toggleSort('oa')}>
              <span>OA Model &amp; APC</span>
              {#if sortCol === 'oa'}
                {#if sortDir === 'asc'}
                  <ArrowUp class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {:else}
                  <ArrowDown class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {/if}
              {/if}
            </button>
          </th>
          <th scope="col" aria-sort={sortCol === 'targets' ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}>
            <button type="button" class="sort-btn" onclick={() => toggleSort('targets')}>
              <span>Target Pipeline</span>
              {#if sortCol === 'targets'}
                {#if sortDir === 'asc'}
                  <ArrowUp class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {:else}
                  <ArrowDown class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {/if}
              {/if}
            </button>
          </th>
          <th scope="col" class="col-padded">Action</th>
        </tr>
      </thead>
      <tbody>
        {#each sortedJournals as j (j.id)}
          <tr>
            <td data-label="Journal &amp; Publisher" class="cell-title">
              <span class="font-semibold text-[var(--ink-primary)]">{j.name}</span>
              {#if j.shortName}
                <span class="block text-xs text-[var(--ink-muted)]">{j.shortName}</span>
              {/if}
              <span class="mt-1 flex flex-wrap items-center gap-1">
                {#if j.sjrQuartile}
                  <span class="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-subtle)] px-1.5 py-0.5 text-[11px] font-bold text-[var(--accent-secondary)]">
                    {j.sjrQuartile}
                  </span>
                {/if}
                <span
                  class="rounded-md bg-[var(--surface-subtle)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--ink-muted)]"
                  title={metricSourceTip(j.metricSource)}
                >
                  {j.metricSource}
                </span>
              </span>
              {#if j.publisher}
                <span class="block text-xs text-[var(--ink-muted)]">{j.publisher}</span>
              {/if}
            </td>
            <td data-label="Published Papers" class="tabular-nums">{j.authorPublishedCount}</td>
            <td data-label="Total Citations" class="tabular-nums">{j.authorCitationsTotal.toLocaleString()}</td>
            <td data-label="Mean Citations" class="tabular-nums">{j.authorCitationsMean.toFixed(1)}</td>
            <td data-label="Impact Factor (JIF)" class="tabular-nums">
              {#if j.jif != null}
                <span title="Clarivate JCR Impact Factor{j.jifYear != null ? ` (${j.jifYear} edition)` : ''}">
                  {j.jif.toFixed(2)}
                </span>
                {#if j.jifYear != null}
                  <span class="block text-[11px] text-[var(--ink-muted)]">{j.jifYear} JCR</span>
                {/if}
              {:else}
                <span class="text-[var(--ink-muted)]">n/a</span>
              {/if}
            </td>
            <td data-label="OpenAlex 2yr Citedness" class="tabular-nums">
              {j.twoYearMeanCitedness != null ? j.twoYearMeanCitedness.toFixed(2) : 'n/a'}
            </td>
            <td data-label="Journal h-index" class="tabular-nums">
              {j.journalHIndex != null ? j.journalHIndex : '-'}
            </td>
            <td data-label="OA Model &amp; APC">
              {#if j.oaModel}
                <span class="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-subtle)] px-1.5 py-0.5 text-[11px] font-semibold capitalize">
                  {j.oaModel}
                </span>
              {:else}
                <span class="text-[var(--ink-muted)]">unknown</span>
              {/if}
              {#if j.apcUsd != null}
                <span class="block text-[11px] text-[var(--ink-muted)] tabular-nums">
                  APC ${j.apcUsd.toLocaleString()}
                </span>
              {:else if j.oaModel === 'diamond'}
                <span class="block text-[11px] text-[var(--ink-muted)]">no APC</span>
              {/if}
            </td>
            <td data-label="Target Pipeline" class="tabular-nums">
              {#if j.targetPaperCount > 0}
                {j.targetPaperCount}
              {:else}
                <span class="text-[var(--ink-muted)]">-</span>
              {/if}
            </td>
            <td data-label="Action">
              {#if j.authorPublishedCount > 0}
                <button
                  type="button"
                  onclick={() => store.filterByJournalAndNavigate(j.id, j.name)}
                  aria-label="Filter papers in {j.name}"
                  class="inline-flex min-h-8 items-center gap-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-subtle)] px-2.5 py-1 text-xs font-semibold hover:border-[var(--accent-primary)]"
                >
                  <ListFilter class="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Filter papers</span>
                </button>
              {:else}
                <span class="text-[var(--ink-muted)]">-</span>
              {/if}
            </td>
          </tr>
        {/each}
        {#if sortedJournals.length === 0}
          <tr>
            <td colspan="10" class="text-center text-sm text-[var(--ink-muted)]">
              No journals match the current filters.
            </td>
          </tr>
        {/if}
      </tbody>
    </table>
  </div>
</div>
