<script lang="ts">
  import {
    OPEN_SCIENCE_STAGE_DESCRIPTIONS,
    OPEN_SCIENCE_STAGE_LABELS,
    type OpenScienceStage
  } from '@researchhq/schema';
  import { Check, Copy, ExternalLink, FileCode2, Globe, X } from '@lucide/svelte';
  import type { PortfolioStore } from '#lib/stores/portfolio.svelte';
  import { attachDialogLightDismiss } from '#lib/utils/dialog';
  import { buildBibtexEntry } from '#lib/utils/bibtex';
  import { doiHref, safeHref } from '#lib/utils/url';

  let { store }: { store: PortfolioStore } = $props();

  let dialogEl = $state<HTMLDialogElement | null>(null);
  let copiedBib = $state<boolean>(false);

  const pub = $derived(store.selectedPublication);

  const bibtexSnippet = $derived.by(() => {
    if (!pub) return '';
    return buildBibtexEntry(pub, new Set<string>());
  });

  $effect(() => {
    if (!dialogEl) return;
    const cleanup = attachDialogLightDismiss(dialogEl);
    return () => cleanup.destroy();
  });

  $effect(() => {
    if (!dialogEl) return;
    if (store.selectedPublication && !dialogEl.open) {
      copiedBib = false;
      dialogEl.showModal();
    } else if (!store.selectedPublication && dialogEl.open) {
      dialogEl.close();
    }
  });

  async function copyBibtex() {
    if (!bibtexSnippet || typeof navigator === 'undefined') return;
    try {
      await navigator.clipboard.writeText(bibtexSnippet);
      copiedBib = true;
      store.announce('Copied BibTeX entry to clipboard');
      setTimeout(() => {
        copiedBib = false;
      }, 2200);
    } catch {
      // Clipboard blocked
    }
  }
</script>

<dialog
  bind:this={dialogEl}
  closedby="any"
  aria-labelledby="pub-detail-title"
  onclose={() => (store.selectedPublication = null)}
  class="hq-dialog"
>
  {#if pub}
    {@const stage = pub.openScienceStage as OpenScienceStage}
    <div class="flex max-h-[calc(100dvh-2rem)] flex-col">
      <!-- Header -->
      <div class="flex items-start justify-between gap-4 border-b border-[var(--border-subtle)] p-6">
        <div>
          <div class="flex flex-wrap items-center gap-2 text-xs font-semibold">
            <span class="rounded-md bg-[var(--surface-subtle)] px-2 py-0.5 text-[var(--ink-secondary)] uppercase">
              {pub.type}
            </span>
            <span class="text-[var(--ink-muted)]">{pub.year}</span>
            {#if pub.venue}
              <span class="text-[var(--ink-muted)]">·</span>
              <span class="text-[var(--accent-primary)]">{pub.venue}</span>
            {/if}
          </div>
          <h1 id="pub-detail-title" class="mt-2 text-lg font-bold leading-snug sm:text-xl">
            {pub.title}
          </h1>
          <p class="mt-1.5 text-xs text-[var(--ink-secondary)]">
            {pub.authors.join(', ')}
          </p>
        </div>
        <button
          type="button"
          onclick={() => dialogEl?.close()}
          aria-label="Close publication details"
          class="inline-flex min-h-9 min-w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-subtle)] text-[var(--ink-secondary)] hover:text-[var(--ink-primary)]"
        >
          <X class="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <!-- Scrollable Body -->
      <div class="space-y-5 overflow-y-auto p-6 text-sm">
        <!-- Citation & Open Science Strip -->
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div class="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-subtle)]/60 p-3.5">
            <div class="text-xs font-semibold text-[var(--ink-muted)] uppercase">Citations</div>
            <div class="mt-1 text-2xl font-bold tabular-nums">
              {store.getCitations(pub).toLocaleString()}
            </div>
            <div class="mt-0.5 text-xs text-[var(--ink-muted)]">
              OpenAlex: {(pub.citationsOpenAlex ?? pub.citations).toLocaleString()}
              {#if pub.citationsScholar != null}
                · Scholar: {pub.citationsScholar.toLocaleString()}
              {/if}
            </div>
          </div>

          <div class="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-subtle)]/60 p-3.5 sm:col-span-2">
            <div class="flex items-center justify-between gap-2">
              <span class="text-xs font-semibold text-[var(--accent-primary)] uppercase">
                Open Science Stage {stage}: {OPEN_SCIENCE_STAGE_LABELS[stage]}
              </span>
              {#if pub.openScience.oaStatus}
                <span class="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-card)] px-2 py-0.5 text-[11px] font-semibold capitalize">
                  OA: {pub.openScience.oaStatus}
                </span>
              {/if}
            </div>
            <p class="mt-1 text-xs text-[var(--ink-secondary)]">
              {pub.openScience.rationale || OPEN_SCIENCE_STAGE_DESCRIPTIONS[stage]}
            </p>
          </div>
        </div>

        <!-- Action Links -->
        <div class="flex flex-wrap items-center gap-2">
          {#if pub.doi && doiHref(pub.doi)}
            <a
              href={doiHref(pub.doi)}
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-subtle)] px-3 py-1.5 text-xs font-semibold text-[var(--ink-primary)] no-underline hover:border-[var(--accent-primary)]"
            >
              <span>DOI: {pub.doi}</span>
              <ExternalLink class="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          {/if}
          {#if pub.openScience.oaUrl && safeHref(pub.openScience.oaUrl)}
            <a
              href={safeHref(pub.openScience.oaUrl)}
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-subtle)] px-3 py-1.5 text-xs font-semibold text-[var(--ink-primary)] no-underline hover:border-[var(--accent-primary)]"
            >
              <span>Open Access Full Text</span>
              <ExternalLink class="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          {/if}
          {#if pub.openScience.codeUrl && safeHref(pub.openScience.codeUrl)}
            <a
              href={safeHref(pub.openScience.codeUrl)}
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-subtle)] px-3 py-1.5 text-xs font-semibold text-[var(--ink-primary)] no-underline hover:border-[var(--accent-primary)]"
            >
              <FileCode2 class="h-3.5 w-3.5" aria-hidden="true" />
              <span>Source Code / Package</span>
              <ExternalLink class="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          {/if}
          {#if pub.openScience.interactiveToolUrl && safeHref(pub.openScience.interactiveToolUrl)}
            <a
              href={safeHref(pub.openScience.interactiveToolUrl)}
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-[var(--accent-primary)] px-3 py-1.5 text-xs font-semibold text-[var(--accent-primary-ink)] no-underline hover:opacity-90"
            >
              <Globe class="h-3.5 w-3.5" aria-hidden="true" />
              <span>{pub.openScience.interactiveToolName || 'Launch Interactive Tool'}</span>
              <ExternalLink class="h-3.5 w-3.5" aria-hidden="true" />
            </a>
          {/if}
        </div>

        {#if pub.abstract}
          <div>
            <h2 class="text-xs font-bold tracking-wide text-[var(--ink-muted)] uppercase">Abstract</h2>
            <p class="mt-1.5 leading-relaxed text-[var(--ink-secondary)]">
              {pub.abstract}
            </p>
          </div>
        {/if}

        {#if pub.topics.length > 0}
          <div>
            <h2 class="text-xs font-bold tracking-wide text-[var(--ink-muted)] uppercase">Topics</h2>
            <div class="mt-1.5 flex flex-wrap gap-1.5">
              {#each pub.topics as topic, topicIndex (topicIndex)}
                <span class="rounded-md border border-[var(--border-subtle)] bg-[var(--surface-subtle)] px-2 py-0.5 text-xs text-[var(--ink-secondary)]">
                  {topic}
                </span>
              {/each}
            </div>
          </div>
        {/if}

        <!-- BibTeX Citation Block -->
        <figure>
          <figcaption class="flex items-center justify-between gap-2">
            <span id="pub-bibtex-caption" class="text-xs font-bold tracking-wide text-[var(--ink-muted)] uppercase">
              BibTeX Citation
            </span>
            <button
              type="button"
              onclick={copyBibtex}
              class="inline-flex min-h-8 items-center gap-1.5 rounded-md border border-[var(--border-subtle)] bg-[var(--surface-subtle)] px-2.5 py-1 text-xs font-semibold text-[var(--ink-primary)] hover:border-[var(--accent-primary)]"
            >
              {#if copiedBib}
                <Check class="h-3.5 w-3.5 text-[var(--accent-primary)]" aria-hidden="true" />
                <span>Copied</span>
              {:else}
                <Copy class="h-3.5 w-3.5" aria-hidden="true" />
                <span>Copy BibTeX</span>
              {/if}
            </button>
          </figcaption>
          <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
          <pre
            role="region"
            aria-labelledby="pub-bibtex-caption"
            tabindex="0"
            class="mt-1.5"><code>{bibtexSnippet}</code></pre>
        </figure>
      </div>
    </div>
  {/if}
</dialog>
