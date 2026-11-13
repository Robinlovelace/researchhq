<script lang="ts">
  import { CalendarRange, Table2 } from '@lucide/svelte';
  import type { PortfolioStore } from '#lib/stores/portfolio.svelte';

  let { store }: { store: PortfolioStore } = $props();

  type SeriesMetric = 'outputs' | 'annual-citations' | 'cohort-citations';

  let metric = $state<SeriesMetric>('outputs');
  let showDataTable = $state<boolean>(false);
  let hoveredYear = $state<number | null>(null);

  const series = $derived(store.timeSeriesWithDrafts);

  // Data-driven current year (never a hardcoded '26' string check).
  const currentYear = new Date().getFullYear();

  const maxBarValue = $derived.by(() => {
    let maxVal = 1;
    for (const pt of series) {
      if (metric === 'outputs') {
        maxVal = Math.max(
          maxVal,
          pt.publishedCount + pt.plannedPublicationsCount + pt.plannedSubmissionsCount
        );
      } else if (metric === 'annual-citations') {
        maxVal = Math.max(maxVal, pt.citationsEarnedInYear);
      } else {
        maxVal = Math.max(maxVal, pt.citationsOfCohort);
      }
    }
    return maxVal;
  });

  const activePoint = $derived.by(() => {
    if (hoveredYear !== null) {
      return series.find((p) => p.year === hoveredYear) ?? null;
    }
    return series[series.length - 1] ?? null;
  });

  // Dynamic planned-year range: every year carrying in-flight or planned
  // submissions / publications, derived from the snapshot time series.
  const plannedYears = $derived.by(() => {
    const years = series
      .filter((pt) => pt.plannedSubmissionsCount > 0 || pt.plannedPublicationsCount > 0)
      .map((pt) => pt.year);
    if (years.length === 0) {
      const currentYear = new Date().getFullYear();
      return { start: currentYear, end: currentYear + 2 };
    }
    return { start: Math.min(...years), end: Math.max(...years) };
  });

  const chartWidth = 920;
  const chartHeight = 320;
  const padLeft = 48;
  const padRight = 20;
  const padTop = 24;
  const padBottom = 46;
  const innerW = chartWidth - padLeft - padRight;
  const innerH = chartHeight - padTop - padBottom;
</script>

<div class="space-y-6">
  <section
    aria-labelledby="timeseries-heading"
    class="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-card)] p-6 shadow-xs"
  >
    <div class="flex flex-col justify-between gap-4 lg:flex-row lg:items-center">
      <div>
        <div class="inline-flex items-center gap-1.5 text-xs font-semibold tracking-wide text-[var(--accent-primary)] uppercase">
          <CalendarRange class="h-3.5 w-3.5" aria-hidden="true" />
          <span>Historical Output &amp; {plannedYears.start}-{plannedYears.end} Trajectory</span>
        </div>
        <h2 id="timeseries-heading" class="mt-1 text-xl font-bold">
          Publications, Citations &amp; Planned Pipeline Over Time
        </h2>
        <p class="mt-1 text-sm text-[var(--ink-secondary)]">
          Click any historical year bar to filter published outputs, or click a hatched
          planned-year bar to inspect planned submissions and target publications.
        </p>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <div
          role="group"
          aria-label="Time series metric"
          class="inline-flex rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-subtle)] p-0.5 text-xs font-semibold"
        >
          <button
            type="button"
            aria-pressed={metric === 'outputs'}
            onclick={() => (metric = 'outputs')}
            class="min-h-8 rounded-md px-3 py-1 {metric === 'outputs'
              ? 'bg-[var(--surface-card)] text-[var(--ink-primary)] shadow-xs'
              : 'text-[var(--ink-muted)] hover:text-[var(--ink-primary)]'}"
          >
            Outputs + Pipeline
          </button>
          <button
            type="button"
            aria-pressed={metric === 'annual-citations'}
            onclick={() => (metric = 'annual-citations')}
            class="min-h-8 rounded-md px-3 py-1 {metric === 'annual-citations'
              ? 'bg-[var(--surface-card)] text-[var(--ink-primary)] shadow-xs'
              : 'text-[var(--ink-muted)] hover:text-[var(--ink-primary)]'}"
          >
            Citations / Year
          </button>
          <button
            type="button"
            aria-pressed={metric === 'cohort-citations'}
            onclick={() => (metric = 'cohort-citations')}
            class="min-h-8 rounded-md px-3 py-1 {metric === 'cohort-citations'
              ? 'bg-[var(--surface-card)] text-[var(--ink-primary)] shadow-xs'
              : 'text-[var(--ink-muted)] hover:text-[var(--ink-primary)]'}"
          >
            Cohort Citations
          </button>
        </div>

        <button
          type="button"
          aria-pressed={showDataTable}
          onclick={() => (showDataTable = !showDataTable)}
          class="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-subtle)] px-3 py-1 text-xs font-semibold text-[var(--ink-primary)]"
        >
          <Table2 class="h-3.5 w-3.5" aria-hidden="true" />
          <span>{showDataTable ? 'Hide table' : 'Show accessible table'}</span>
        </button>
      </div>
    </div>

    <!-- Legend (Pattern + Border + Shape, never color alone) -->
    <div class="mt-4 flex flex-wrap items-center gap-4 text-xs text-[var(--ink-secondary)]">
      {#if metric === 'outputs'}
        <span class="inline-flex items-center gap-1.5">
          <span class="inline-block h-3 w-3 rounded-xs bg-[var(--accent-primary)]"></span>
          <span>Journal Articles</span>
        </span>
        <span class="inline-flex items-center gap-1.5">
          <span class="inline-block h-3 w-3 rounded-xs bg-[var(--accent-secondary)] opacity-75"></span>
          <span>Books, Chapters & Software</span>
        </span>
        <span class="inline-flex items-center gap-1.5">
          <span
            class="inline-block h-3 w-4 rounded-xs border-2 border-dashed border-[var(--accent-violet)] bg-[var(--accent-violet)]/20"
          ></span>
          <span>Planned target publications ({plannedYears.start}-{plannedYears.end})</span>
        </span>
        <span class="inline-flex items-center gap-1.5">
          <span
            class="inline-block h-3 w-4 rounded-xs border-2 border-dashed border-[var(--accent-secondary)] bg-[var(--accent-secondary)]/20"
          ></span>
          <span>Planned submissions ({plannedYears.start}-{plannedYears.end})</span>
        </span>
      {:else if metric === 'annual-citations'}
        <span class="inline-flex items-center gap-1.5">
          <span class="inline-block h-3 w-3 rounded-xs bg-[var(--accent-secondary)]"></span>
          <span>OpenAlex citations received across all works in year</span>
        </span>
        <span class="text-[var(--ink-muted)]">
          Note: OpenAlex annual citation counts cover approximately the most recent 10 years, and {currentYear} is a partial year to date (YTD).
        </span>
      {:else}
        <span class="inline-flex items-center gap-1.5">
          <span class="inline-block h-3 w-3 rounded-xs bg-[var(--accent-amber)]"></span>
          <span>Cumulative citations earned by works published in year</span>
        </span>
      {/if}
    </div>

    <!-- Interactive SVG Chart inside semantic <figure> -->
    <figure class="mt-4">
      <div class="overflow-x-auto">
        <svg
          viewBox="0 0 {chartWidth} {chartHeight}"
          role="group"
          aria-labelledby="ts-svg-title ts-svg-desc"
          class="w-full min-w-[640px] select-none"
        >
          <title id="ts-svg-title">
            Annual research {metric === 'outputs' ? `outputs and planned ${plannedYears.start}-${plannedYears.end} pipeline` : 'citation trajectory'}
          </title>
          <desc id="ts-svg-desc">
            Interactive bar chart from {series[0]?.year ?? 2011} through {series[series.length - 1]?.year ?? 2028}. Use the Show accessible table toggle for full tabular values.
          </desc>

          <defs>
            <pattern
              id="planned-hatch"
              width="6"
              height="6"
              patternTransform="rotate(45 0 0)"
              patternUnits="userSpaceOnUse"
            >
              <line
                x1="0"
                y1="0"
                x2="0"
                y2="6"
                stroke="var(--accent-violet)"
                stroke-width="2"
              />
            </pattern>
            <pattern
              id="planned-hatch-sub"
              width="6"
              height="6"
              patternTransform="rotate(-45 0 0)"
              patternUnits="userSpaceOnUse"
            >
              <line
                x1="0"
                y1="0"
                x2="0"
                y2="6"
                stroke="var(--accent-secondary)"
                stroke-width="2"
              />
            </pattern>
          </defs>

          <!-- Horizontal gridlines -->
          {#each [0, 0.25, 0.5, 0.75, 1] as tick (tick)}
            {@const y = padTop + innerH * (1 - tick)}
            {@const val = Math.round(maxBarValue * tick)}
            <line
              x1={padLeft}
              y1={y}
              x2={chartWidth - padRight}
              y2={y}
              stroke="var(--border-subtle)"
              stroke-dasharray={tick === 0 ? undefined : '3 3'}
            />
            <text
              x={padLeft - 8}
              y={y + 4}
              text-anchor="end"
              fill="var(--ink-muted)"
              font-size="11"
            >
              {val}
            </text>
          {/each}

          <!-- Bars -->
          {#if series.length > 0}
            {@const step = innerW / series.length}
            {@const barW = Math.max(10, Math.min(34, step * 0.72))}
            {#each series as pt, idx (pt.year)}
              {@const x = padLeft + idx * step + (step - barW) / 2}
              {@const plannedTotal = pt.plannedPublicationsCount + pt.plannedSubmissionsCount}
              {@const yearLabel =
                metric === 'annual-citations' && pt.year === currentYear
                  ? `${pt.year} (YTD)`
                  : String(pt.year)}
              {@const primaryVal =
                metric === 'outputs'
                  ? pt.publishedCount
                  : metric === 'annual-citations'
                    ? pt.citationsEarnedInYear
                    : pt.citationsOfCohort}
              {@const primaryH = (primaryVal / maxBarValue) * innerH}
              {@const articleH =
                metric === 'outputs' ? (pt.articlesCount / maxBarValue) * innerH : 0}
              {@const otherPubH = metric === 'outputs' ? primaryH - articleH : 0}
              {@const plannedPubH =
                metric === 'outputs' ? (pt.plannedPublicationsCount / maxBarValue) * innerH : 0}
              {@const plannedSubH =
                metric === 'outputs' ? (pt.plannedSubmissionsCount / maxBarValue) * innerH : 0}

              <g
                role="button"
                tabindex="0"
                aria-label="{yearLabel}: {metric === 'outputs'
                  ? `${pt.publishedCount} published (${pt.articlesCount} articles), ${pt.plannedSubmissionsCount} planned submissions, ${pt.plannedPublicationsCount} planned publications`
                  : `${primaryVal} citations`}"
                onmouseenter={() => (hoveredYear = pt.year)}
                onfocus={() => (hoveredYear = pt.year)}
                onclick={() =>
                  store.filterByYearAndNavigate(
                    pt.year,
                    pt.isFuture || (pt.publishedCount === 0 && plannedTotal > 0)
                  )}
                onkeydown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    store.filterByYearAndNavigate(
                      pt.year,
                      pt.isFuture || (pt.publishedCount === 0 && plannedTotal > 0)
                    );
                  }
                }}
                class="cursor-pointer"
              >
                <!-- Hover column backdrop -->
                <rect
                  x={padLeft + idx * step}
                  y={padTop}
                  width={step}
                  height={innerH}
                  fill={hoveredYear === pt.year
                    ? 'color-mix(in oklab, var(--accent-primary) 10%, transparent)'
                    : 'transparent'}
                />

                {#if metric === 'outputs'}
                  {#if articleH > 0}
                    <rect
                      x={x}
                      y={padTop + innerH - articleH}
                      width={barW}
                      height={articleH}
                      rx="2"
                      fill="var(--accent-primary)"
                    />
                  {/if}
                  {#if otherPubH > 0}
                    <rect
                      x={x}
                      y={padTop + innerH - articleH - otherPubH}
                      width={barW}
                      height={otherPubH}
                      rx="2"
                      fill="var(--accent-secondary)"
                      opacity="0.75"
                    />
                  {/if}
                  {#if plannedPubH > 0}
                    <rect
                      x={x}
                      y={padTop + innerH - primaryH - plannedPubH}
                      width={barW}
                      height={plannedPubH}
                      rx="2"
                      fill="url(#planned-hatch)"
                      stroke="var(--accent-violet)"
                      stroke-width="1.5"
                      stroke-dasharray="3 2"
                    />
                  {/if}
                  {#if plannedSubH > 0}
                    <rect
                      x={x}
                      y={padTop + innerH - primaryH - plannedPubH - plannedSubH}
                      width={barW}
                      height={plannedSubH}
                      rx="2"
                      fill="url(#planned-hatch-sub)"
                      stroke="var(--accent-secondary)"
                      stroke-width="1.5"
                      stroke-dasharray="3 2"
                    />
                  {/if}
                {:else}
                  {#if primaryH > 0}
                    <rect
                      x={x}
                      y={padTop + innerH - primaryH}
                      width={barW}
                      height={primaryH}
                      rx="2"
                      fill={metric === 'annual-citations'
                        ? 'var(--accent-secondary)'
                        : 'var(--accent-amber)'}
                    />
                  {/if}
                {/if}
              </g>

              <text
                x={x + barW / 2}
                y={padTop + innerH + 18}
                text-anchor="middle"
                fill={pt.isFuture ? 'var(--accent-violet)' : 'var(--ink-secondary)'}
                font-size="10.5"
                font-weight={pt.isFuture || hoveredYear === pt.year ? '700' : '500'}
              >
                {pt.year === currentYear || idx % 2 === 0 || pt.isFuture
                  ? pt.year
                  : `'${String(pt.year).slice(-2)}`}
              </text>
              {#if pt.isFuture}
                <text
                  x={x + barW / 2}
                  y={padTop + innerH + 31}
                  text-anchor="middle"
                  fill="var(--accent-violet)"
                  font-size="9"
                  font-weight="600"
                >
                  plan
                </text>
              {/if}
            {/each}
          {/if}
        </svg>
      </div>

      <!-- Inspector readout bar -->
      {#if activePoint}
        <figcaption
          class="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-subtle)]/60 px-4 py-3 text-xs"
        >
          <div class="flex flex-wrap items-center gap-x-4 gap-y-1">
            <span class="text-sm font-bold text-[var(--ink-primary)]">
              {activePoint.year}{#if metric === 'annual-citations' && activePoint.year === currentYear}
                (YTD)
              {/if}
              {#if activePoint.isFuture}
                <span class="ml-1 rounded-md bg-[var(--accent-violet)]/15 px-1.5 py-0.5 text-[11px] font-semibold text-[var(--accent-violet)]">
                  Projected Pipeline
                </span>
              {/if}
            </span>
            <span>
              Published: <strong>{activePoint.publishedCount}</strong> ({activePoint.articlesCount} articles, {activePoint.booksAndChaptersCount} books/chapters)
            </span>
            <span>
              Open Access: <strong>{activePoint.oaCount}</strong> · Stage 4-5: <strong>{activePoint.stage4PlusCount}</strong>
            </span>
            <span>
              Citations in year: <strong>{activePoint.citationsEarnedInYear}</strong> · Cohort citations: <strong>{activePoint.citationsOfCohort}</strong>
            </span>
          </div>
          {#if activePoint.plannedPaperSlugs.length > 0}
            <div class="flex flex-wrap items-center gap-1.5">
              <span class="font-semibold text-[var(--accent-violet)]">
                In-flight / planned ({activePoint.plannedSubmissionsCount} sub, {activePoint.plannedPublicationsCount} target pub):
              </span>
              {#each activePoint.plannedPaperSlugs as slug (slug)}
                {@const found = store.allPlannedPapers.find((p) => p.slug === slug)}
                <button
                  type="button"
                  onclick={() => {
                    if (found) store.selectedPlannedPaper = found;
                  }}
                  class="min-h-6 rounded-md border border-[var(--accent-violet)]/40 bg-[var(--surface-card)] px-2 py-0.5 font-semibold text-[var(--ink-primary)] hover:border-[var(--accent-violet)]"
                >
                  {found?.shortTitle ?? slug}
                </button>
              {/each}
            </div>
          {/if}
        </figcaption>
      {/if}
    </figure>

    <!-- Accessible Data Table Companion -->
    {#if showDataTable}
      <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
      <div
        tabindex="0"
        role="region"
        aria-labelledby="timeseries-heading"
        class="table-wrapper mt-5"
      >
        <table class="data-table">
          <thead>
            <tr>
              <th scope="col" class="col-padded">Year</th>
              <th scope="col" class="col-padded">Published Total</th>
              <th scope="col" class="col-padded">Journal Articles</th>
              <th scope="col" class="col-padded">Books & Chapters</th>
              <th scope="col" class="col-padded">Open Access</th>
              <th scope="col" class="col-padded">Stage 4-5</th>
              <th scope="col" class="col-padded">Citations in Year</th>
              <th scope="col" class="col-padded">Cohort Citations</th>
              <th scope="col" class="col-padded">Planned Submissions</th>
              <th scope="col" class="col-padded">Planned Publications</th>
            </tr>
          </thead>
          <tbody>
            {#each series as pt (pt.year)}
              <tr>
                <td class="font-semibold">
                  {pt.year}
                  {#if pt.isFuture}
                    <span class="ml-1 text-xs text-[var(--accent-violet)]">(Planned)</span>
                  {/if}
                </td>
                <td class="tabular-nums">{pt.publishedCount}</td>
                <td class="tabular-nums">{pt.articlesCount}</td>
                <td class="tabular-nums">{pt.booksAndChaptersCount}</td>
                <td class="tabular-nums">{pt.oaCount}</td>
                <td class="tabular-nums">{pt.stage4PlusCount}</td>
                <td class="tabular-nums">{pt.citationsEarnedInYear}</td>
                <td class="tabular-nums">{pt.citationsOfCohort}</td>
                <td class="tabular-nums">{pt.plannedSubmissionsCount}</td>
                <td class="tabular-nums">{pt.plannedPublicationsCount}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>
</div>
