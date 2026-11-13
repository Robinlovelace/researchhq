<script lang="ts">
  import {
    ArrowDown,
    ArrowUp,
    Download,
    ExternalLink,
    FileCode2,
    Globe,
    RotateCcw,
    Search,
    X
  } from '@lucide/svelte';
  import {
    OPEN_SCIENCE_STAGE_LABELS,
    type OpenScienceStage,
    type Publication
  } from '@researchhq/schema';
  import { compareStrings } from '#lib/stores/portfolio.svelte';
  import type { PortfolioStore } from '#lib/stores/portfolio.svelte';
  import { buildBibtex, downloadTextFile } from '#lib/utils/bibtex';
  import { doiHref, safeHref } from '#lib/utils/url';

  let { store }: { store: PortfolioStore } = $props();

  // ---------------------------------------------------------------------------
  // Result paging: show the first 50 by default, expand on demand
  // ---------------------------------------------------------------------------
  const totalFiltered = $derived(store.filteredPublications.length);
  let shownCount = $state(50);
  const sortedPublications = $derived.by(() => sortPublications(store.filteredPublications));
  const visiblePublications = $derived(sortedPublications.slice(0, shownCount));

  // ---------------------------------------------------------------------------
  // Sortable publications table
  // ---------------------------------------------------------------------------
  type SortDir = 'asc' | 'desc';
  type PubSortKey = 'title' | 'year' | 'venue' | 'stage' | 'citations';

  let sortCol = $state<PubSortKey>('year');
  let sortDir = $state<SortDir>('desc');

  const pubSortLabels: Record<PubSortKey, string> = {
    title: 'Title and Authors',
    year: 'Year',
    venue: 'Venue',
    stage: 'Open Science Stage',
    citations: 'Citations'
  };

  function sortPublications(list: Publication[]): Publication[] {
    const dir = sortDir === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      switch (sortCol) {
        case 'title':
          return compareStrings(a.title, b.title) * dir;
        case 'venue':
          return compareStrings(a.venue ?? '', b.venue ?? '') * dir;
        case 'year':
          return (a.year - b.year) * dir;
        case 'stage':
          return (a.openScienceStage - b.openScienceStage) * dir;
        case 'citations':
          return (store.getCitations(a) - store.getCitations(b)) * dir;
      }
    });
  }

  function toggleSort(col: PubSortKey): void {
    if (sortCol === col) {
      sortDir = sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      sortCol = col;
      sortDir = col === 'year' || col === 'citations' ? 'desc' : 'asc';
    }
    store.announce(
      `Sorted by ${pubSortLabels[sortCol]}, ${sortDir === 'asc' ? 'ascending' : 'descending'}`
    );
  }

  // ---------------------------------------------------------------------------
  // Active filter pills
  // ---------------------------------------------------------------------------
  const journalName = $derived.by(() => {
    if (!store.journalFilter) return null;
    const found = (store.snapshot?.journals ?? []).find((j) => j.id === store.journalFilter);
    return found?.name ?? store.journalFilter;
  });

  const activePills = $derived.by(() => {
    const pills: { key: string; label: string; clear: () => void }[] = [];
    if (store.journalFilter) {
      pills.push({
        key: 'journal',
        label: `Journal: ${journalName ?? ''}`,
        clear: () => (store.journalFilter = null)
      });
    }
    if (store.yearFilter !== null) {
      pills.push({
        key: 'year',
        label: `Year: ${store.yearFilter}`,
        clear: () => (store.yearFilter = null)
      });
    }
    if (store.pubTypeFilter !== 'all') {
      pills.push({
        key: 'type',
        label: `Type: ${store.pubTypeFilter}`,
        clear: () => (store.pubTypeFilter = 'all')
      });
    }
    if (store.stageFilter !== 'all') {
      pills.push({
        key: 'stage',
        label: `Stage: ${store.stageFilter}`,
        clear: () => (store.stageFilter = 'all')
      });
    }
    if (store.oaOnlyFilter) {
      pills.push({
        key: 'oa',
        label: 'Open Access only',
        clear: () => (store.oaOnlyFilter = false)
      });
    }
    if (store.featuredOnlyFilter) {
      pills.push({
        key: 'featured',
        label: 'Featured only',
        clear: () => (store.featuredOnlyFilter = false)
      });
    }
    return pills;
  });

  // ---------------------------------------------------------------------------
  // Polite announcement when the filtered publication count changes
  // (debounced so typing in the search box does not spam the live region)
  // ---------------------------------------------------------------------------

  let filterCountAnnounceTimer: ReturnType<typeof setTimeout> | undefined;
  let filterCountAnnouncePrimed = false;

  $effect(() => {
    const count = totalFiltered;
    if (!filterCountAnnouncePrimed) {
      filterCountAnnouncePrimed = true;
      return;
    }
    if (filterCountAnnounceTimer) clearTimeout(filterCountAnnounceTimer);
    filterCountAnnounceTimer = setTimeout(() => {
      store.announce(`${count} publications match the current filters`);
    }, 400);
    return () => {
      if (filterCountAnnounceTimer) clearTimeout(filterCountAnnounceTimer);
    };
  });

  // ---------------------------------------------------------------------------
  // BibTeX export (shared helpers in #lib/utils/bibtex)
  // ---------------------------------------------------------------------------

  function exportBibtex(): void {
    const bib = buildBibtex(store.filteredPublications);
    if (!bib) {
      store.announce('No publications match the current filters, nothing exported');
      return;
    }
    downloadTextFile(bib, 'researchhq-publications.bib', 'application/x-bibtex');
    store.announce(`Exported BibTeX for ${store.filteredPublications.length} publications`);
  }
</script>

<div class="space-y-6">
  <!-- Search and filter panel -->
  <search aria-label="Publication filters" class="block rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-card)] p-4 shadow-xs">
    <div class="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
      <div class="md:col-span-2">
        <label for="pub-search-input" class="mb-1 block text-xs font-semibold text-[var(--ink-secondary)]">
          Search publications
        </label>
        <div class="relative">
          <Search class="pointer-events-none absolute top-2.5 left-3 h-4 w-4 text-[var(--ink-muted)]" aria-hidden="true" />
          <input
            id="pub-search-input"
            type="search"
            bind:value={store.searchQuery}
            placeholder="Title, author, venue, DOI, or topic"
            class="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-subtle)] py-2 pr-3 pl-9 text-sm placeholder:text-[var(--ink-muted)]"
          />
        </div>
      </div>
      <div>
        <label for="pub-type-select" class="mb-1 block text-xs font-semibold text-[var(--ink-secondary)]">
          Output type
        </label>
        <select
          id="pub-type-select"
          bind:value={store.pubTypeFilter}
          class="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-subtle)] px-3 py-2 text-sm"
        >
          <option value="all">All types</option>
          <option value="article">Journal articles</option>
          <option value="book">Books and chapters</option>
          <option value="software">Software</option>
          <option value="other">Other outputs</option>
        </select>
      </div>
      <div>
        <label for="pub-stage-select" class="mb-1 block text-xs font-semibold text-[var(--ink-secondary)]">
          Open Science Stage
        </label>
        <select
          id="pub-stage-select"
          value={store.stageFilter === 'all' ? 'all' : String(store.stageFilter)}
          onchange={(e: Event) => {
            const value = (e.currentTarget as HTMLSelectElement).value;
            store.stageFilter = value === 'all' ? 'all' : Number(value);
          }}
          class="w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-subtle)] px-3 py-2 text-sm"
        >
          <option value="all">All stages</option>
          <option value="5">Stage 5: Deployed tool</option>
          <option value="4">Stage 4: Reproducible paper</option>
          <option value="3">Stage 3: Open code</option>
          <option value="2">Stage 2: Open data</option>
          <option value="1">Stage 1: Open access</option>
          <option value="0">Stage 0: Unassessed</option>
        </select>
      </div>
    </div>
    <div class="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
      <label for="pub-oa-checkbox" class="inline-flex min-h-8 cursor-pointer items-center gap-2 text-xs font-medium text-[var(--ink-secondary)]">
        <input id="pub-oa-checkbox" type="checkbox" bind:checked={store.oaOnlyFilter} class="h-4 w-4" />
        <span>Open Access only</span>
      </label>
      <label for="pub-featured-checkbox" class="inline-flex min-h-8 cursor-pointer items-center gap-2 text-xs font-medium text-[var(--ink-secondary)]">
        <input id="pub-featured-checkbox" type="checkbox" bind:checked={store.featuredOnlyFilter} class="h-4 w-4" />
        <span>Flagship / Featured only</span>
      </label>
    </div>

    <!-- Active filter pills, reset, and BibTeX export -->
    <div class="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--border-subtle)] pt-3">
      {#if activePills.length > 0}
        <span class="text-xs font-semibold text-[var(--ink-muted)]">Active filters:</span>
        {#each activePills as pill (pill.key)}
          <span class="inline-flex items-center gap-1 rounded-full border border-[var(--accent-primary)]/40 bg-[var(--surface-subtle)] py-0.5 pr-1 pl-2.5 text-xs font-semibold text-[var(--ink-primary)]">
            {pill.label}
            <button
              type="button"
              onclick={pill.clear}
              aria-label="Remove filter {pill.label}"
              class="inline-flex h-5 w-5 items-center justify-center rounded-full hover:bg-[var(--surface-subtle)]"
            >
              <X class="h-3 w-3" aria-hidden="true" />
            </button>
          </span>
        {/each}
      {:else}
        <span class="text-xs text-[var(--ink-muted)]">No active filters</span>
      {/if}
      <div class="ms-auto flex flex-wrap items-center gap-2">
        <button
          type="button"
          onclick={() => store.resetPublicationFilters()}
          class="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-subtle)] px-3 py-1 text-xs font-semibold hover:border-[var(--accent-primary)]"
        >
          <RotateCcw class="h-3.5 w-3.5" aria-hidden="true" />
          <span>Reset filters</span>
        </button>
        <button
          type="button"
          onclick={exportBibtex}
          class="inline-flex min-h-8 items-center gap-1.5 rounded-lg bg-[var(--accent-primary)] px-3 py-1 text-xs font-semibold text-[var(--accent-primary-ink)] hover:opacity-90"
        >
          <Download class="h-3.5 w-3.5" aria-hidden="true" />
          <span>Export filtered BibTeX</span>
        </button>
      </div>
    </div>
  </search>

  <!-- Result count and paging -->
  <div class="flex flex-wrap items-center justify-between gap-3">
    <p class="text-sm text-[var(--ink-secondary)]">
      Showing <strong class="text-[var(--ink-primary)]">{visiblePublications.length}</strong>
      of <strong class="text-[var(--ink-primary)]">{totalFiltered}</strong> publications
      {#if totalFiltered !== (store.snapshot?.publications.length ?? 0)}
        <span class="text-[var(--ink-muted)]">
          (filtered from {store.snapshot?.publications.length ?? 0} total)
        </span>
      {/if}
    </p>
    <div class="flex flex-wrap items-center gap-2">
      {#if totalFiltered > shownCount}
        <button
          type="button"
          onclick={() => (shownCount = totalFiltered)}
          class="min-h-8 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-subtle)] px-3 py-1 text-xs font-semibold hover:border-[var(--accent-primary)]"
        >
          Show all ({totalFiltered})
        </button>
      {:else if shownCount > 50 && totalFiltered > 50}
        <button
          type="button"
          onclick={() => (shownCount = 50)}
          class="min-h-8 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-subtle)] px-3 py-1 text-xs font-semibold hover:border-[var(--accent-primary)]"
        >
          Show first 50
        </button>
      {/if}
    </div>
  </div>

  <!-- Sortable publications table -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div
    tabindex="0"
    role="region"
    aria-labelledby="pub-table-heading"
    class="table-wrapper"
  >
    <h2 id="pub-table-heading" class="sr-only">Publications table</h2>
    <table class="data-table responsive-cards">
      <caption class="sr-only-live">
        Sortable publications table: open the detail modal from the title, sort with the header buttons
      </caption>
      <thead>
        <tr>
          <th scope="col" aria-sort={sortCol === 'title' ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}>
            <button type="button" class="sort-btn" onclick={() => toggleSort('title')}>
              <span>Title &amp; Authors</span>
              {#if sortCol === 'title'}
                {#if sortDir === 'asc'}
                  <ArrowUp class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {:else}
                  <ArrowDown class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {/if}
              {/if}
            </button>
          </th>
          <th scope="col" aria-sort={sortCol === 'year' ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}>
            <button type="button" class="sort-btn" onclick={() => toggleSort('year')}>
              <span>Year</span>
              {#if sortCol === 'year'}
                {#if sortDir === 'asc'}
                  <ArrowUp class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {:else}
                  <ArrowDown class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {/if}
              {/if}
            </button>
          </th>
          <th scope="col" aria-sort={sortCol === 'venue' ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}>
            <button type="button" class="sort-btn" onclick={() => toggleSort('venue')}>
              <span>Venue</span>
              {#if sortCol === 'venue'}
                {#if sortDir === 'asc'}
                  <ArrowUp class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {:else}
                  <ArrowDown class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {/if}
              {/if}
            </button>
          </th>
          <th scope="col" aria-sort={sortCol === 'stage' ? (sortDir === 'asc' ? 'ascending' : 'descending') : undefined}>
            <button type="button" class="sort-btn" onclick={() => toggleSort('stage')}>
              <span>Open Science Stage</span>
              {#if sortCol === 'stage'}
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
              <span>Citations</span>
              {#if sortCol === 'citations'}
                {#if sortDir === 'asc'}
                  <ArrowUp class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {:else}
                  <ArrowDown class="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {/if}
              {/if}
            </button>
          </th>
        </tr>
      </thead>
      <tbody>
        {#each visiblePublications as pub (pub.id)}
          <tr>
            <td data-label="Title &amp; Authors" class="cell-title">
              <button
                type="button"
                onclick={() => (store.selectedPublication = pub)}
                class="text-left font-semibold text-[var(--ink-primary)] hover:text-[var(--accent-primary)] hover:underline"
              >
                {pub.title}
              </button>
              <span class="mt-0.5 block text-xs text-[var(--ink-muted)]">
                {pub.authors.slice(0, 3).join(', ')}{pub.authors.length > 3 ? ' et al.' : ''}
              </span>
              <span class="mt-1 flex flex-wrap gap-1.5">
                {#if pub.doi && doiHref(pub.doi)}
                  <a
                    href={doiHref(pub.doi)}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="inline-flex min-h-6 items-center gap-1 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-subtle)] px-1.5 text-[11px] font-semibold text-[var(--ink-secondary)] no-underline hover:border-[var(--accent-primary)]"
                  >
                    <ExternalLink class="h-3 w-3" aria-hidden="true" />
                    DOI
                  </a>
                {/if}
                {#if pub.openScience.codeUrl && safeHref(pub.openScience.codeUrl)}
                  <a
                    href={safeHref(pub.openScience.codeUrl)}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="inline-flex min-h-6 items-center gap-1 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-subtle)] px-1.5 text-[11px] font-semibold text-[var(--ink-secondary)] no-underline hover:border-[var(--accent-primary)]"
                  >
                    <FileCode2 class="h-3 w-3" aria-hidden="true" />
                    Code
                  </a>
                {/if}
                {#if pub.openScience.interactiveToolUrl && safeHref(pub.openScience.interactiveToolUrl)}
                  <a
                    href={safeHref(pub.openScience.interactiveToolUrl)}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="inline-flex min-h-6 items-center gap-1 rounded-md bg-[var(--accent-primary)] px-1.5 text-[11px] font-semibold text-[var(--accent-primary-ink)] no-underline hover:opacity-90"
                  >
                    <Globe class="h-3 w-3" aria-hidden="true" />
                    {pub.openScience.interactiveToolName ?? 'Interactive tool'}
                  </a>
                {/if}
              </span>
            </td>
            <td data-label="Year" class="tabular-nums">{pub.year}</td>
            <td data-label="Venue">
              {#if pub.venue}
                {pub.venue}
              {:else}
                <span class="text-[var(--ink-muted)]">-</span>
              {/if}
            </td>
            <td data-label="Open Science Stage">
              <span
                class="inline-flex min-h-6 items-center rounded-full border border-[var(--accent-primary)]/40 px-2 text-[11px] font-bold text-[var(--accent-primary)]"
                title={OPEN_SCIENCE_STAGE_LABELS[pub.openScienceStage as OpenScienceStage]}
              >
                Stage {pub.openScienceStage}
              </span>
            </td>
            <td data-label="Citations" class="tabular-nums">
              <span class="font-semibold">{store.getCitations(pub)}</span>
              {#if pub.citationsOpenAlex != null && pub.citationsScholar != null && pub.citationsOpenAlex !== pub.citationsScholar}
                <span class="block text-[11px] text-[var(--ink-muted)]">
                  OA: {pub.citationsOpenAlex} · GS: {pub.citationsScholar}
                </span>
              {/if}
            </td>
          </tr>
        {/each}
        {#if visiblePublications.length === 0}
          <tr>
            <td colspan="5" class="text-center text-sm text-[var(--ink-muted)]">
              No publications match the current filters. Adjust the filters above or press Reset
              filters.
            </td>
          </tr>
        {/if}
      </tbody>
    </table>
  </div>
</div>
