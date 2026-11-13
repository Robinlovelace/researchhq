<script lang="ts">
  import {
    BarChart3,
    BookMarked,
    CalendarRange,
    ExternalLink,
    FileSpreadsheet,
    Github,
    LayoutDashboard,
    Plus,
    Rocket
  } from '@lucide/svelte';
  import { asset } from '$app/paths';
  import { onMount } from 'svelte';
  import IdeaComposerDialog from '#lib/components/IdeaComposerDialog.svelte';
  import JournalsTab from '#lib/components/JournalsTab.svelte';
  import OverviewTab from '#lib/components/OverviewTab.svelte';
  import PipelineTab from '#lib/components/PipelineTab.svelte';
  import PlannedPaperDetailDialog from '#lib/components/PlannedPaperDetailDialog.svelte';
  import PublicationDetailDialog from '#lib/components/PublicationDetailDialog.svelte';
  import PublicationsTab from '#lib/components/PublicationsTab.svelte';
  import ThemeToggle from '#lib/components/ThemeToggle.svelte';
  import TimeSeriesTab from '#lib/components/TimeSeriesTab.svelte';
  import { buildPortfolioJsonLdTag } from '#lib/utils/jsonld';
  import { safeHref } from '#lib/utils/url';
  import {
    PortfolioStore,
    type DashboardTab
  } from '#lib/stores/portfolio.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  // svelte-ignore state_referenced_locally
  const store = new PortfolioStore(data.snapshot);

  $effect(() => {
    store.setSnapshot(data.snapshot);
  });

  // ---------------------------------------------------------------------------
  // Shareable URL state & deep-linking (?tab=&stage=&venue=&q=&pub=&paper=)
  // ---------------------------------------------------------------------------

  const TAB_IDS: readonly DashboardTab[] = [
    'overview',
    'timeseries',
    'journals',
    'publications',
    'pipeline'
  ];

  let hydratedFromUrl = $state(false);
  let embedMode = $state(false);
  let demoMode = $state(false);
  // Request counter guarding the async demo fetch: rapid toggling on then off
  // must never leave the demo persona displayed when demoMode === false.
  let demoReqId = 0;
  const activeSnapshot = $derived(store.snapshot ?? data.snapshot);

  async function loadDemoSnapshotIfNeeded(enableDemo: boolean): Promise<void> {
    const req = ++demoReqId;
    if (enableDemo) {
      if (store.snapshot?.author.name.includes('(Demo Persona)')) return;
      try {
        const res = await fetch(asset('data/demo-portfolio.json'));
        const demoSnapshot = res.ok ? ((await res.json()) as typeof data.snapshot) : null;
        if (req !== demoReqId || !demoSnapshot) return;
        store.setSnapshot(demoSnapshot);
      } catch {
        // Keep default snapshot on network error
      }
    } else {
      if (req !== demoReqId) return;
      if (store.snapshot !== data.snapshot) {
        store.setSnapshot(data.snapshot);
      }
    }
  }

  function applyUrlParams(): void {
    const params = new URLSearchParams(window.location.search);
    embedMode = params.get('embed') === '1';
    const nextDemo = params.get('demo') === '1';
    if (nextDemo !== demoMode) {
      demoMode = nextDemo;
      void loadDemoSnapshotIfNeeded(nextDemo);
    }
    const tab = params.get('tab');
    if (tab && (TAB_IDS as readonly string[]).includes(tab)) {
      store.activeTab = tab as DashboardTab;
    }
    const stage = params.get('stage');
    if (stage !== null) {
      const stageNum = Number(stage);
      store.stageFilter =
        Number.isInteger(stageNum) && stageNum >= 0 && stageNum <= 5 ? stageNum : 'all';
    }
    const venue = params.get('venue');
    if (venue !== null) {
      store.journalFilter = venue || null;
    }
    const q = params.get('q');
    if (q !== null) {
      store.searchQuery = q;
    }
    const pub = params.get('pub');
    if (pub) {
      store.selectedPublication =
        store.snapshot?.publications.find((p) => p.id === pub) ?? null;
    }
    const paper = params.get('paper');
    if (paper) {
      store.selectedPlannedPaper =
        store.allPlannedPapers.find((p) => p.slug === paper) ?? null;
    }
  }

  $effect(() => {
    if (typeof window === 'undefined') return;
    if (!hydratedFromUrl) {
      // First run only: hydrate local drafts first, then hydrate the initial
      // tab, filters, and open detail dialog from window.location.search.
      store.hydrateLocalDrafts();
      hydratedFromUrl = true;
      if (new URLSearchParams(window.location.search).get('demo') === '1') {
        demoMode = true;
        // Demo deep links (?demo=1&paper=... / &pub=...) must resolve against
        // demo-portfolio.json, so load the demo snapshot BEFORE the URL's
        // paper/pub params are matched against the active snapshot.
        void loadDemoSnapshotIfNeeded(true).then(() => applyUrlParams());
        return;
      }
      applyUrlParams();
      return;
    }
    // After mount: keep the URL in sync (replaceState, no history spam).
    // Clone the live URL and mutate only our own keys so unknown params
    // (embed, utm_*, ...) are preserved verbatim.
    const url = new URL(window.location.href);
    if (store.activeTab !== 'overview') url.searchParams.set('tab', store.activeTab);
    else url.searchParams.delete('tab');
    if (store.selectedPublication) url.searchParams.set('pub', store.selectedPublication.id);
    else url.searchParams.delete('pub');
    if (store.selectedPlannedPaper) {
      url.searchParams.set('paper', store.selectedPlannedPaper.slug);
    } else {
      url.searchParams.delete('paper');
    }
    if (demoMode) url.searchParams.set('demo', '1');
    else url.searchParams.delete('demo');
    const qs = url.searchParams.toString();
    const current = window.location.search.replace(/^\?/, '');
    if (qs !== current) {
      window.history.replaceState(
        window.history.state,
        '',
        `${url.pathname}${qs ? `?${qs}` : ''}${url.hash}`
      );
    }
  });

  onMount(() => {
    store.hydrateLocalDrafts();
    // Browser back / forward and manual URL edits re-hydrate the state
    const onPopState = () => applyUrlParams();
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  });

  const tabs: Array<{ id: DashboardTab; label: string }> = [
    { id: 'overview', label: 'Overview & Open Science' },
    { id: 'timeseries', label: 'Time Series (Past & Future)' },
    { id: 'journals', label: 'Journals & Impact Metrics' },
    { id: 'publications', label: 'Publications Explorer' },
    { id: 'pipeline', label: 'Future Papers Pipeline' }
  ];

  let tabButtons = $state<Array<HTMLButtonElement | null>>([]);

  function handleTabKeydown(event: KeyboardEvent, idx: number) {
    let nextIdx = idx;
    if (event.key === 'ArrowRight') {
      nextIdx = (idx + 1) % tabs.length;
    } else if (event.key === 'ArrowLeft') {
      nextIdx = (idx - 1 + tabs.length) % tabs.length;
    } else if (event.key === 'Home') {
      nextIdx = 0;
    } else if (event.key === 'End') {
      nextIdx = tabs.length - 1;
    } else {
      return;
    }
    event.preventDefault();
    const target = tabs[nextIdx];
    if (target) {
      store.activeTab = target.id;
      tabButtons[nextIdx]?.focus();
    }
  }
</script>

<svelte:head>
  <title>{activeSnapshot.author.name} - ResearchHQ Portfolio & Planned Papers</title>
  <meta
    name="description"
    content="Interactive academic research outputs, journal impact metrics, Open Science maturity scorecard, and {store.roadmapYearRange.start}-{store.roadmapYearRange.end} future publications roadmap for {activeSnapshot.author.name}."
  />
  <meta
    property="og:title"
    content="{activeSnapshot.author.name} - ResearchHQ Portfolio & Planned Papers"
  />
  <meta
    property="og:description"
    content="Interactive academic research outputs, journal impact metrics, Open Science maturity scorecard, and future publications roadmap for {activeSnapshot.author.name}."
  />
  <meta property="og:type" content="profile" />
  {#if activeSnapshot.author.website}
    <meta property="og:url" content={activeSnapshot.author.website} />
  {/if}
  {@html buildPortfolioJsonLdTag(activeSnapshot)}
</svelte:head>

<!-- Single polite status live region for table sorting & filter announcements -->
<div role="status" aria-live="polite" class="sr-only-live">
  {store.statusAnnouncement}
</div>

<div
  class="flex min-h-dvh flex-col"
  data-hydrated={hydratedFromUrl ? 'true' : undefined}
  data-embed-mode={embedMode ? 'true' : undefined}
>
  <!-- Semantic Banner Landmark -->
  <header class="border-b border-[var(--border-subtle)] bg-[var(--surface-card)]">
    <div class="mx-auto max-w-7xl px-4 pt-5 pb-0 sm:px-6 lg:px-8">
      <div class="flex flex-col justify-between gap-4 md:flex-row md:items-start">
        <div>
          <div class="flex flex-wrap items-center gap-2 text-xs font-semibold text-[var(--accent-primary)]">
            <span class="rounded-md bg-[var(--accent-primary)]/12 px-2 py-0.5">ResearchHQ</span>
            <span class="hidden sm:inline">·</span>
            <span class="text-[var(--ink-muted)]">{activeSnapshot.author.affiliation}</span>
          </div>
          <h1
            id="dashboard-title"
            tabindex="-1"
            class="mt-1.5 {embedMode
              ? 'text-lg font-bold'
              : 'text-2xl font-extrabold tracking-tight sm:text-3xl'} focus:outline-none"
          >
            {activeSnapshot.author.name}
          </h1>
          {#if !embedMode}
            <p class="mt-1 max-w-3xl text-sm text-[var(--ink-secondary)]">
              {activeSnapshot.author.role} · Research outputs, hybrid journal impact analytics, 5-stage Open Science scorecard, and {store.roadmapYearRange.start}-{store.roadmapYearRange.end} publication roadmap
            </p>
          {/if}
        </div>

        <!-- Global Controls: Citation Mode, Add Idea CTA, Theme Toggle -->
        <div class="flex flex-wrap items-center gap-2.5">
          <div class="flex items-center gap-1.5">
            <label for="citation-source-select" class="text-xs font-semibold text-[var(--ink-muted)]">
              Citations:
            </label>
            <select
              id="citation-source-select"
              bind:value={store.citationMode}
              class="min-h-8 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-subtle)] px-2.5 py-1 text-xs font-semibold text-[var(--ink-primary)]"
            >
              <option value="best">Max (OpenAlex + Scholar)</option>
              <option value="openalex">OpenAlex Only</option>
              <option value="scholar">Google Scholar Preferred</option>
            </select>
          </div>

          {#if !embedMode}
            <button
              type="button"
              onclick={() => {
                store.activeTab = 'pipeline';
                store.showIdeaComposer = true;
              }}
              class="inline-flex min-h-8 items-center gap-1.5 rounded-lg bg-[var(--accent-primary)] px-3 py-1.5 text-xs font-semibold text-[var(--accent-primary-ink)] hover:opacity-90"
            >
              <Plus class="h-3.5 w-3.5" aria-hidden="true" />
              <span>New Paper Idea</span>
            </button>
          {/if}

          <ThemeToggle />
        </div>
      </div>

      <!-- Accessible Horizontal Tabs Strip (Forced-Colors-Safe Border Underline) -->
      <div class="mt-5">
        <div role="tablist" aria-label="Portfolio views" class="tabs-strip">
          {#each tabs as tab, idx (tab.id)}
            <button
              bind:this={tabButtons[idx]}
              type="button"
              role="tab"
              id="tab-{tab.id}"
              aria-selected={store.activeTab === tab.id}
              aria-controls={store.activeTab === tab.id ? `panel-${tab.id}` : undefined}
              tabindex={store.activeTab === tab.id ? 0 : -1}
              onclick={() => (store.activeTab = tab.id)}
              onkeydown={(e) => handleTabKeydown(e, idx)}
            >
              {#if tab.id === 'overview'}
                <LayoutDashboard class="h-4 w-4" aria-hidden="true" />
              {:else if tab.id === 'timeseries'}
                <CalendarRange class="h-4 w-4" aria-hidden="true" />
              {:else if tab.id === 'journals'}
                <BarChart3 class="h-4 w-4" aria-hidden="true" />
              {:else if tab.id === 'publications'}
                <FileSpreadsheet class="h-4 w-4" aria-hidden="true" />
              {:else}
                <Rocket class="h-4 w-4" aria-hidden="true" />
              {/if}
              <span>{tab.label}</span>
              {#if tab.id === 'pipeline'}
                <span class="rounded-full bg-[var(--accent-primary)]/15 px-1.5 py-0.2 text-[11px] font-bold text-[var(--accent-primary)]">
                  {store.allPlannedPapers.length}
                </span>
              {/if}
            </button>
          {/each}
        </div>
      </div>
    </div>
  </header>

  <!-- Single Main Landmark (skip-link target, programmatically focusable) -->
  <main id="main-content" tabindex="-1" class="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6 lg:px-8">
    <div
      role="tabpanel"
      id="panel-{store.activeTab}"
      aria-labelledby="tab-{store.activeTab}"
      tabindex="0"
    >
      {#if store.activeTab === 'overview'}
        <OverviewTab {store} />
      {:else if store.activeTab === 'timeseries'}
        <TimeSeriesTab {store} />
      {:else if store.activeTab === 'journals'}
        <JournalsTab {store} />
      {:else if store.activeTab === 'publications'}
        <PublicationsTab {store} />
      {:else if store.activeTab === 'pipeline'}
        <PipelineTab {store} />
      {/if}
    </div>
  </main>

  <!-- Semantic Contentinfo Footer (omitted in compact embed mode) -->
  {#if !embedMode}
    <footer class="border-t border-[var(--border-subtle)] bg-[var(--surface-card)] py-6 text-xs text-[var(--ink-muted)]">
      <div class="mx-auto flex max-w-7xl flex-col items-start justify-between gap-4 px-4 sm:flex-row sm:items-center sm:px-6 lg:px-8">
        <div class="space-y-1">
          <p class="font-semibold text-[var(--ink-secondary)]">
            {activeSnapshot.author.name} · ORCID
            <a
              href="https://orcid.org/{activeSnapshot.author.orcid}"
              target="_blank"
              rel="noopener noreferrer"
              class="underline hover:text-[var(--ink-primary)]"
            >
              {activeSnapshot.author.orcid}
            </a>
          </p>
          <p>
            Snapshot generated {activeSnapshot.generatedAt.slice(0, 10)} · Hybrid metrics from OpenAlex API + Clarivate JCR / SJR curations
          </p>
        </div>
        <div class="flex flex-wrap items-center gap-4">
          <button
            type="button"
            onclick={() => {
              demoMode = !demoMode;
              void loadDemoSnapshotIfNeeded(demoMode);
            }}
            class="underline hover:text-[var(--ink-primary)]"
          >
            {demoMode ? 'Exit synthetic demo' : 'Switch to synthetic OSS demo'}
          </button>
          {#if activeSnapshot.author.website}
            <a
              href={safeHref(activeSnapshot.author.website) ?? undefined}
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex items-center gap-1 font-medium text-[var(--ink-secondary)] hover:text-[var(--ink-primary)]"
            >
              <BookMarked class="h-3.5 w-3.5" aria-hidden="true" />
              <span>Website</span>
              <ExternalLink class="h-3 w-3" aria-hidden="true" />
            </a>
          {/if}
          <a
            href="https://github.com/Robinlovelace/researchhq"
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-1 font-medium text-[var(--ink-secondary)] hover:text-[var(--ink-primary)]"
          >
            <Github class="h-3.5 w-3.5" aria-hidden="true" />
            <span>Powered by ResearchHQ (MIT)</span>
            <ExternalLink class="h-3 w-3" aria-hidden="true" />
          </a>
        </div>
      </div>
    </footer>
  {/if}
</div>

<!-- Native Modal Dialogs -->
<PublicationDetailDialog {store} />
<PlannedPaperDetailDialog {store} />
<IdeaComposerDialog {store} />
