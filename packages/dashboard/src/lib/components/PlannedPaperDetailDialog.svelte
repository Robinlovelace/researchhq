<script lang="ts">
  import { OPEN_SCIENCE_STAGE_LABELS, type OpenScienceStage, type PlannedPaper } from '@researchhq/schema';
  import { Check, CheckCircle2, Copy, ExternalLink, FileCode2, Globe, Lock, Sparkles, Target, X } from '@lucide/svelte';
  import type { PortfolioStore } from '#lib/stores/portfolio.svelte';
  import { attachDialogLightDismiss } from '#lib/utils/dialog';
  import { safeHref } from '#lib/utils/url';

  let { store }: { store: PortfolioStore } = $props();

  const STATUS_OPTIONS: PlannedPaper['status'][] = [
    'idea',
    'scoping',
    'active-analysis',
    'drafting',
    'under-review',
    'revision',
    'accepted'
  ];

  const STATUS_LABELS: Record<PlannedPaper['status'], string> = {
    idea: 'Idea',
    scoping: 'Scoping',
    'active-analysis': 'Active Analysis',
    drafting: 'Drafting',
    'under-review': 'Under Review',
    revision: 'Revision',
    accepted: 'Accepted'
  };

  let dialogEl = $state<HTMLDialogElement | null>(null);
  let cliCopied = $state(false);
  // Local slider state: smooth visual dragging via oninput, with the store
  // (and its aria-live announcement) updated only on commit via onchange.
  let sliderReadiness = $state<number | null>(null);

  const paper = $derived(store.selectedPlannedPaper);

  const isLocalDraft = $derived(
    paper ? store.localDraftPapers.some((d) => d.slug === paper.slug) : false
  );

  const cliCommand = $derived.by(() => {
    if (!paper) return '';
    const escapedTitle = paper.title.replace(/'/g, "\\'");
    if (isLocalDraft) {
      // Local drafts do not exist in the repository yet: add-idea creates them.
      return `npx @researchhq/cli add-idea --slug '${paper.slug}' --title '${escapedTitle}' --readiness ${paper.readinessPercent} --status '${paper.status}'`;
    }
    return `npx @researchhq/cli update-idea --slug '${paper.slug}' --readiness ${paper.readinessPercent} --status '${paper.status}'`;
  });

  const cliCommandLabel = $derived(
    isLocalDraft ? 'Ready to run add-idea CLI command' : 'Ready to run update-idea CLI command'
  );

  async function copyCliUpdate(): Promise<void> {
    try {
      await navigator.clipboard.writeText(cliCommand);
      cliCopied = true;
      store.announce('CLI update command copied to clipboard');
      window.setTimeout(() => {
        cliCopied = false;
      }, 2000);
    } catch {
      store.announce('Clipboard unavailable: copy the command manually');
    }
  }

  function findJournal(journalId: string) {
    return store.snapshot?.journals.find((j) => j.id === journalId) ?? null;
  }

  $effect(() => {
    if (!dialogEl) return;
    const cleanup = attachDialogLightDismiss(dialogEl);
    return () => cleanup.destroy();
  });

  $effect(() => {
    if (!dialogEl) return;
    if (store.selectedPlannedPaper && !dialogEl.open) {
      dialogEl.showModal();
    } else if (!store.selectedPlannedPaper && dialogEl.open) {
      dialogEl.close();
    }
  });
</script>

<dialog
  bind:this={dialogEl}
  closedby="any"
  aria-labelledby="planned-detail-title"
  onclose={() => (store.selectedPlannedPaper = null)}
  class="hq-dialog"
>
  {#if paper}
    <div class="flex max-h-[calc(100dvh-2rem)] flex-col">
      <!-- Header -->
      <div class="flex items-start justify-between gap-4 border-b border-[var(--border-subtle)] p-6">
        <div>
          <div class="flex flex-wrap items-center gap-2 text-xs font-semibold">
            <span class="rounded-md bg-[var(--accent-violet)]/15 px-2 py-0.5 text-[var(--accent-violet)] capitalize">
              {paper.category.replace(/-/g, ' ')}
            </span>
            <span class="rounded-md bg-[var(--surface-subtle)] px-2 py-0.5 text-[var(--ink-secondary)] capitalize">
              Status: {paper.status.replace(/-/g, ' ')}
            </span>
            <span class="text-[var(--ink-muted)]">
              Submit {paper.targetSubmissionQuarter} · Target Pub {paper.targetPublicationYear}
            </span>
          </div>
          <h1 id="planned-detail-title" class="mt-2 text-lg font-bold leading-snug sm:text-xl">
            {paper.title}
          </h1>
        </div>
        <button
          type="button"
          onclick={() => dialogEl?.close()}
          aria-label="Close planned paper details"
          class="inline-flex min-h-9 min-w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-subtle)] text-[var(--ink-secondary)] hover:text-[var(--ink-primary)]"
        >
          <X class="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <!-- Body -->
      <div class="space-y-6 overflow-y-auto p-6 text-sm">
        <!-- Percent Complete & Open Science Progression -->
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div class="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-subtle)]/60 p-4">
            <div class="flex items-center justify-between text-xs font-semibold text-[var(--ink-muted)] uppercase">
              <span>Percent Complete</span>
              <span class="text-sm font-bold text-[var(--accent-primary)]">{paper.readinessPercent}%</span>
            </div>
            <div
              class="mt-2 h-2 w-full overflow-hidden rounded-full bg-[var(--border-subtle)]/50"
              role="progressbar"
              aria-valuenow={sliderReadiness ?? paper.readinessPercent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Percent complete"
            >
              <div
                class="h-full rounded-full bg-[var(--accent-primary)]"
                style="width: {sliderReadiness ?? paper.readinessPercent}%"
              ></div>
            </div>

            <!-- Quick updater: slider + status select (persisted locally) -->
            <div class="mt-3">
              <label for="detail-progress-range" class="sr-only">
                Update percent complete for {paper.shortTitle}
              </label>
              <input
                id="detail-progress-range"
                type="range"
                min="0"
                max="100"
                step="5"
                value={sliderReadiness ?? paper.readinessPercent}
                oninput={(e) =>
                  (sliderReadiness = Number((e.currentTarget as HTMLInputElement).value))}
                onchange={(e) => {
                  store.setPaperProgress(
                    paper.slug,
                    { readinessPercent: Number((e.currentTarget as HTMLInputElement).value) }
                  );
                  sliderReadiness = null;
                }}
                class="mt-2 w-full"
              />
              <label for="detail-status-select" class="sr-only">
                Update status for {paper.shortTitle}
              </label>
              <select
                id="detail-status-select"
                aria-label="Update status for {paper.shortTitle}"
                value={paper.status}
                onchange={(e) =>
                  store.setPaperProgress(
                    paper.slug,
                    { status: (e.currentTarget as HTMLSelectElement).value as PlannedPaper['status'] }
                  )}
                class="mt-2 w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)] px-2.5 py-1.5 text-xs font-semibold text-[var(--ink-primary)]"
              >
                {#each STATUS_OPTIONS as statusOption (statusOption)}
                  <option value={statusOption}>{STATUS_LABELS[statusOption]}</option>
                {/each}
              </select>
            </div>

            <!-- Ready-to-copy CLI persistence command -->
            <div class="mt-3 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)] p-2.5">
              <div class="flex items-center justify-between gap-2">
                <span class="text-[0.7rem] font-semibold text-[var(--ink-secondary)]">CLI update</span>
                <div class="flex items-center gap-1.5">
                  {#if store.hasProgressOverride(paper.slug)}
                    <button
                      type="button"
                      onclick={() => store.resetPaperProgress(paper.slug)}
                      class="inline-flex min-h-7 items-center gap-1 rounded-md border border-[var(--border-subtle)] px-2 py-0.5 text-[0.7rem] font-semibold text-[var(--ink-secondary)] hover:border-[var(--border-strong)] hover:text-[var(--ink-primary)]"
                    >
                      Reset
                    </button>
                  {/if}
                  <button
                    type="button"
                    onclick={() => copyCliUpdate()}
                    class="inline-flex min-h-7 items-center gap-1 rounded-md border border-[var(--border-subtle)] px-2 py-0.5 text-[0.7rem] font-semibold text-[var(--ink-primary)] hover:border-[var(--border-strong)]"
                  >
                    {#if cliCopied}
                      <Check class="h-3 w-3" aria-hidden="true" />
                      <span>Copied</span>
                    {:else}
                      <Copy class="h-3 w-3" aria-hidden="true" />
                      <span>Copy CLI update</span>
                    {/if}
                  </button>
                </div>
              </div>
              <pre
                aria-label={cliCommandLabel}
                class="mt-2 overflow-x-auto text-[0.7rem] leading-relaxed text-[var(--ink-secondary)]"
              >{cliCommand}</pre>
            </div>

            <p class="mt-2 text-xs text-[var(--ink-muted)]">
              Slug: <code>{paper.slug}</code>
              {#if store.hasProgressOverride(paper.slug)}
                <span class="ml-1 rounded-md bg-[var(--surface-card)] px-1.5 py-0.5 text-[0.65rem] font-semibold text-[var(--accent-amber)]">
                  Modified locally
                </span>
              {/if}
            </p>
          </div>

          <div class="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-subtle)]/60 p-4">
            <div class="text-xs font-semibold text-[var(--accent-primary)] uppercase">
              Open Science Trajectory
            </div>
            <div class="mt-1 text-sm font-bold">
              Stage {paper.currentOpenScienceStage} -> Stage {paper.targetOpenScienceStage} ({OPEN_SCIENCE_STAGE_LABELS[paper.targetOpenScienceStage as OpenScienceStage]})
            </div>
            <p class="mt-1 text-xs text-[var(--ink-secondary)]">
              Currently at {OPEN_SCIENCE_STAGE_LABELS[paper.currentOpenScienceStage as OpenScienceStage]}
            </p>
          </div>
        </div>

        <!-- Summary & Scientific Gap -->
        <div>
          <h2 class="text-xs font-bold tracking-wide text-[var(--ink-muted)] uppercase">Summary</h2>
          <p class="mt-1.5 leading-relaxed text-[var(--ink-secondary)]">{paper.summary}</p>
        </div>

        {#if paper.scientificGapFilled}
          <div class="rounded-xl border border-[var(--accent-primary)]/30 bg-[var(--accent-primary)]/5 p-4">
            <div class="flex items-center gap-1.5 text-xs font-bold tracking-wide text-[var(--accent-primary)] uppercase">
              <Sparkles class="h-3.5 w-3.5" aria-hidden="true" />
              <span>Scientific Literature Gap Addressed</span>
            </div>
            <p class="mt-1.5 text-xs leading-relaxed text-[var(--ink-secondary)]">
              {paper.scientificGapFilled}
            </p>
          </div>
        {/if}

        <!-- Candidate Target Journals Comparison -->
        <div>
          <div class="flex items-center gap-1.5 text-xs font-bold tracking-wide text-[var(--ink-muted)] uppercase">
            <Target class="h-3.5 w-3.5 text-[var(--accent-primary)]" aria-hidden="true" />
            <span>Ranked Candidate Target Journals</span>
          </div>
          <div class="mt-2.5 space-y-2.5">
            {#each paper.targetJournals as cand, candIndex (`${candIndex}-${cand.journalId}`)}
              {@const jMetric = findJournal(cand.journalId)}
              <div class="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-subtle)]/40 p-3.5">
                <div class="flex flex-wrap items-center justify-between gap-2">
                  <div class="flex items-center gap-2">
                    <span class="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[var(--accent-primary)] text-xs font-bold text-[var(--accent-primary-ink)]">
                      #{cand.rank}
                    </span>
                    <span class="font-bold text-[var(--ink-primary)]">{cand.journalName}</span>
                    {#if jMetric?.sjrQuartile}
                      <span class="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-card)] px-1.5 py-0.5 text-[11px] font-bold">
                        {jMetric.sjrQuartile}
                      </span>
                    {/if}
                  </div>
                  <div class="flex flex-wrap items-center gap-2 text-xs">
                    {#if jMetric?.jif != null}
                      <span class="rounded-md bg-[var(--surface-card)] px-2 py-0.5 font-semibold">
                        JIF {jMetric.jif.toFixed(1)}
                      </span>
                    {/if}
                    {#if jMetric?.twoYearMeanCitedness != null}
                      <span class="rounded-md bg-[var(--surface-card)] px-2 py-0.5 text-[var(--ink-secondary)]">
                        OA 2yr {jMetric.twoYearMeanCitedness.toFixed(1)}
                      </span>
                    {/if}
                    {#if jMetric?.oaModel && jMetric.oaModel !== 'unknown'}
                      <span class="rounded-md bg-[var(--surface-card)] px-2 py-0.5 capitalize text-[var(--ink-secondary)]">
                        {jMetric.oaModel}
                        {#if jMetric.apcUsd}
                          (${jMetric.apcUsd.toLocaleString()})
                        {/if}
                      </span>
                    {/if}
                    <span class="font-bold text-[var(--accent-primary)]">Fit {cand.fitScore}%</span>
                  </div>
                </div>
                <p class="mt-1.5 text-xs text-[var(--ink-secondary)]">{cand.fitRationale}</p>
                {#if (cand.pros && cand.pros.length > 0) || (cand.cons && cand.cons.length > 0)}
                  <div class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-[var(--ink-muted)]">
                    {#if cand.pros && cand.pros.length > 0}
                      <span><strong>Pros:</strong> {cand.pros.join('; ')}</span>
                    {/if}
                    {#if cand.cons && cand.cons.length > 0}
                      <span><strong>Trade-offs:</strong> {cand.cons.join('; ')}</span>
                    {/if}
                  </div>
                {/if}
              </div>
            {/each}
          </div>
        </div>

        <!-- Methodology & Milestones -->
        <div class="grid grid-cols-1 gap-5 sm:grid-cols-2">
          {#if paper.methodologyHighlights.length > 0}
            <div>
              <h2 class="text-xs font-bold tracking-wide text-[var(--ink-muted)] uppercase">
                Methodology Highlights
              </h2>
              <ul class="mt-2 space-y-1.5 text-xs text-[var(--ink-secondary)]">
                {#each paper.methodologyHighlights as item, itemIndex (itemIndex)}
                  <li class="flex items-start gap-1.5">
                    <CheckCircle2 class="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--accent-primary)]" aria-hidden="true" />
                    <span>{item}</span>
                  </li>
                {/each}
              </ul>
            </div>
          {/if}

          {#if paper.nextMilestones.length > 0}
            <div>
              <h2 class="text-xs font-bold tracking-wide text-[var(--ink-muted)] uppercase">
                Next Milestones
              </h2>
              <ol class="mt-2 list-inside list-decimal space-y-1.5 text-xs text-[var(--ink-secondary)]">
                {#each paper.nextMilestones as step, stepIndex (stepIndex)}
                  <li>{step}</li>
                {/each}
              </ol>
            </div>
          {/if}
        </div>

        <!-- Collaborators, Key Citations, and Repositories -->
        <div class="flex flex-wrap items-center gap-2 border-t border-[var(--border-subtle)] pt-4">
          {#if paper.interactiveToolUrl}
            <a
              href={safeHref(paper.interactiveToolUrl) ?? undefined}
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex min-h-8 items-center gap-1.5 rounded-lg bg-[var(--accent-primary)] px-3 py-1 text-xs font-semibold text-[var(--accent-primary-ink)] no-underline hover:opacity-90"
            >
              <Globe class="h-3.5 w-3.5" aria-hidden="true" />
              <span>Interactive Companion Tool</span>
              <ExternalLink class="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          {/if}
          {#each paper.repoUrls as repo, repoIndex (repoIndex)}
            {@const repoHref = safeHref(repo.url)}
            {#if repoHref}
              <a
                href={repoHref}
                target="_blank"
                rel="noopener noreferrer"
                class="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-subtle)] px-3 py-1 text-xs font-semibold text-[var(--ink-primary)] no-underline hover:border-[var(--accent-primary)]"
              >
                <FileCode2 class="h-3.5 w-3.5" aria-hidden="true" />
                <span>{repo.label}</span>
                <ExternalLink class="h-3.5 w-3.5" aria-hidden="true" />
              </a>
            {:else}
              <span
                class="inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-subtle)]/50 px-3 py-1 text-xs text-[var(--ink-muted)]"
              >
                <Lock class="h-3.5 w-3.5" aria-hidden="true" />
                <span>
                  {repo.label}{#if repo.visibility === 'private'} (Private repository){/if}
                </span>
              </span>
            {/if}
          {/each}
        </div>

        {#if paper.collaborators.length > 0 || paper.keyCitations.length > 0}
          <div class="grid grid-cols-1 gap-3 text-xs text-[var(--ink-muted)] sm:grid-cols-2">
            {#if paper.collaborators.length > 0}
              <div>
                <strong class="text-[var(--ink-secondary)]">Collaborators:</strong>
                {paper.collaborators.join(' · ')}
              </div>
            {/if}
            {#if paper.keyCitations.length > 0}
              <div>
                <strong class="text-[var(--ink-secondary)]">Anchor Literature:</strong>
                {paper.keyCitations.join(', ')}
              </div>
            {/if}
          </div>
        {/if}
      </div>
    </div>
  {/if}
</dialog>
