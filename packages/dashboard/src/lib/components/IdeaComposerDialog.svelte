<script lang="ts">
  import { Check, ClipboardList, Copy, X } from '@lucide/svelte';
  import { PlannedPaperSchema, type PlannedPaper, type TargetJournalCandidate } from '@researchhq/schema';
  import type { PortfolioStore } from '#lib/stores/portfolio.svelte';
  import { attachDialogLightDismiss } from '#lib/utils/dialog';

  let { store }: { store: PortfolioStore } = $props();

  // ---------------------------------------------------------------------------
  // Dialog element + open/close sync with store.showIdeaComposer
  // ---------------------------------------------------------------------------

  let dialogEl = $state<HTMLDialogElement>();

  $effect(() => {
    const el = dialogEl;
    if (!el) return;
    if (store.showIdeaComposer && !el.open) {
      el.showModal();
      el.querySelector<HTMLInputElement>('#idea-title')?.focus();
    } else if (!store.showIdeaComposer && el.open) {
      el.close();
    }
  });

  // ---------------------------------------------------------------------------
  // Form state (sensible defaults: a complete idea takes about 20 seconds)
  // ---------------------------------------------------------------------------

  let title = $state('');
  let shortTitle = $state('');
  let slugTouched = $state(false);
  let slugInput = $state('');
  let category = $state<PlannedPaper['category']>('literature-gap');
  let status = $state<PlannedPaper['status']>('idea');
  let readinessPercent = $state(5);
  let targetSubmissionQuarter = $state(defaultSubmissionQuarter());
  // Dynamic year bounds: derive current/future ranges from the real clock
  const currentYear = new Date().getFullYear();
  const minYear = currentYear;
  const maxYear = currentYear + 6;
  let targetPublicationYear = $state(currentYear + 2);
  let targetOpenScienceStage = $state(5);
  let summary = $state('');
  let scientificGapFilled = $state('');
  let milestonesText = $state('');

  // Inline save feedback (polite, non-blocking)
  let savedNotice = $state('');
  let saveError = $state('');

  interface JournalSlot {
    name: string;
    fitScore: number;
    fitRationale: string;
  }

  let journalSlots = $state<JournalSlot[]>([newJournalSlot(), newJournalSlot(), newJournalSlot()]);

  function newJournalSlot(): JournalSlot {
    return { name: '', fitScore: 50, fitRationale: '' };
  }

  function defaultSubmissionQuarter(): string {
    const now = new Date();
    const currentQuarter = Math.floor(now.getUTCMonth() / 3) + 1;
    const nextQuarter = currentQuarter === 4 ? 1 : currentQuarter + 1;
    const year = currentQuarter === 4 ? now.getUTCFullYear() + 1 : now.getUTCFullYear();
    return `${year}-Q${nextQuarter}`;
  }

  function slugify(text: string): string {
    return text
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  function clampPercent(value: number): number {
    if (!Number.isFinite(value)) return 0;
    return Math.min(100, Math.max(0, Math.round(value)));
  }

  function clampYear(value: number): number {
    if (!Number.isFinite(value)) return currentYear + 2;
    return Math.min(maxYear, Math.max(minYear, Math.round(value)));
  }

  const slug = $derived.by(() =>
    slugTouched ? slugify(slugInput) : slugify(shortTitle.trim() || title.trim())
  );

  const effectiveTitle = $derived(title.trim() || 'Untitled paper idea');
  const effectiveShortTitle = $derived(shortTitle.trim() || effectiveTitle);

  const milestones = $derived.by(() =>
    milestonesText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
  );

  const builtTargetJournals = $derived.by<TargetJournalCandidate[]>(() => {
    const journals = store.snapshot?.journals ?? [];
    const built: TargetJournalCandidate[] = [];
    for (const slot of journalSlots) {
      const name = slot.name.trim();
      if (!name) continue;
      const known = journals.find(
        (journal) =>
          journal.name.toLowerCase() === name.toLowerCase() ||
          (journal.shortName ?? '').toLowerCase() === name.toLowerCase()
      );
      built.push({
        journalId: known?.id ?? slugify(name),
        journalName: name,
        rank: built.length + 1,
        fitScore: clampPercent(slot.fitScore),
        fitRationale: slot.fitRationale.trim() || 'Named when the idea was added; refine during scoping'
      });
    }
    return built;
  });

  const builtPaper = $derived.by<PlannedPaper>(() => ({
    slug: slug || 'untitled-idea',
    title: effectiveTitle,
    shortTitle: effectiveShortTitle,
    category,
    status,
    readinessPercent: clampPercent(readinessPercent),
    targetSubmissionQuarter: targetSubmissionQuarter.trim() || defaultSubmissionQuarter(),
    targetPublicationYear: clampYear(targetPublicationYear),
    targetOpenScienceStage: targetOpenScienceStage,
    currentOpenScienceStage: 0,
    summary:
      summary.trim() ||
      `${effectiveShortTitle}: idea captured in the ResearchHQ dashboard and awaiting scoping.`,
    scientificGapFilled: scientificGapFilled.trim() || null,
    methodologyHighlights: [],
    keyCitations: [],
    collaborators: [],
    repoUrls: [],
    interactiveToolUrl: null,
    nextMilestones: milestones,
    targetJournals: builtTargetJournals,
    privateNotes: null
  }));

  // ---------------------------------------------------------------------------
  // Persistence helpers: POSIX-safe CLI quoting and double-quoted YAML scalars
  // ---------------------------------------------------------------------------

  /** POSIX-safe single-quote shell escaping (never breaks out of the quote). */
  function shellQuote(value: string): string {
    return `'${value.replaceAll("'", "'\\''")}'`;
  }

  /** Double-quoted YAML flow scalar (keeps the value a single string). */
  function yamlQuote(value: string): string {
    return JSON.stringify(value);
  }

  const cliCommand = $derived.by(() => {
    const paper = builtPaper;
    const parts: string[] = [
      'npx @researchhq/cli add-idea',
      '--slug',
      shellQuote(paper.slug),
      '--title',
      shellQuote(paper.title),
      '--short-title',
      shellQuote(paper.shortTitle),
      '--category',
      paper.category,
      '--status',
      paper.status,
      '--readiness',
      String(paper.readinessPercent),
      '--submission-quarter',
      shellQuote(paper.targetSubmissionQuarter),
      '--publication-year',
      String(paper.targetPublicationYear),
      '--open-science-stage',
      String(paper.targetOpenScienceStage)
    ];
    if (paper.summary) {
      parts.push('--summary', shellQuote(paper.summary));
    }
    for (const milestone of paper.nextMilestones) {
      parts.push('--milestone', shellQuote(milestone));
    }
    for (const journal of paper.targetJournals) {
      parts.push('--journal', shellQuote(journal.journalName));
    }
    return parts.join(' ');
  });

  const yamlEntry = $derived.by(() => {
    const paper = builtPaper;
    const lines: string[] = [
      '- slug: ' + yamlQuote(paper.slug),
      '  title: ' + yamlQuote(paper.title),
      '  shortTitle: ' + yamlQuote(paper.shortTitle),
      '  category: ' + paper.category,
      '  status: ' + paper.status,
      '  readinessPercent: ' + paper.readinessPercent,
      '  targetSubmissionQuarter: ' + yamlQuote(paper.targetSubmissionQuarter),
      '  targetPublicationYear: ' + paper.targetPublicationYear,
      '  targetOpenScienceStage: ' + paper.targetOpenScienceStage,
      '  currentOpenScienceStage: ' + paper.currentOpenScienceStage,
      '  summary: ' + yamlQuote(paper.summary)
    ];
    if (paper.scientificGapFilled) {
      lines.push('  scientificGapFilled: ' + yamlQuote(paper.scientificGapFilled));
    }
    lines.push(
      '  methodologyHighlights: []',
      '  keyCitations: []',
      '  collaborators: []',
      '  repoUrls: []'
    );
    if (paper.interactiveToolUrl) {
      lines.push('  interactiveToolUrl: ' + yamlQuote(paper.interactiveToolUrl));
    }
    lines.push(
      paper.nextMilestones.length === 0 ? '  nextMilestones: []' : '  nextMilestones:'
    );
    for (const milestone of paper.nextMilestones) {
      lines.push('    - ' + yamlQuote(milestone));
    }
    if (paper.targetJournals.length === 0) {
      lines.push('  targetJournals: []');
    } else {
      lines.push('  targetJournals:');
      for (const journal of paper.targetJournals) {
        lines.push(
          '    - journalId: ' + yamlQuote(journal.journalId),
          '      journalName: ' + yamlQuote(journal.journalName),
          '      rank: ' + journal.rank,
          '      fitScore: ' + journal.fitScore,
          '      fitRationale: ' + yamlQuote(journal.fitRationale)
        );
      }
    }
    lines.push('  privateNotes: null');
    return lines.join('\n');
  });

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  // Non-blocking warning when the slug collides with a repository paper
  const slugMatchesRepositoryPaper = $derived.by(() => {
    const candidate = slug;
    if (!candidate) return false;
    return (store.snapshot?.plannedPapers ?? []).some((p) => p.slug === candidate);
  });

  function saveToDashboardPreview(event: SubmitEvent): void {
    event.preventDefault();
    savedNotice = '';
    saveError = '';
    if (!title.trim()) {
      saveError = 'Add a title before saving the idea.';
      store.announce(saveError);
      return;
    }
    // Validate the constructed PlannedPaper before persisting anything
    const parsed = PlannedPaperSchema.safeParse(builtPaper);
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0];
      const fieldPath = firstIssue ? firstIssue.path.join('.') : '';
      saveError = fieldPath
        ? `Could not save the idea: check the ${fieldPath} field (${firstIssue?.message}).`
        : 'Could not save the idea: the draft data is invalid.';
      store.announce(saveError);
      return;
    }
    store.addOrUpdateLocalIdea(parsed.data);
    savedNotice = `Saved. The idea "${parsed.data.shortTitle}" is now a Local Draft on the Pipeline board and in the future time series (stored in this browser).`;
  }

  let copied = $state<'cli' | 'yaml' | null>(null);

  async function copySnippet(text: string, kind: 'cli' | 'yaml'): Promise<void> {
    try {
      await navigator.clipboard.writeText(text);
      copied = kind;
      store.announce(
        kind === 'cli' ? 'CLI command copied to clipboard' : 'YAML entry copied to clipboard'
      );
      window.setTimeout(() => {
        if (copied === kind) copied = null;
      }, 2000);
    } catch {
      store.announce('Clipboard unavailable: copy the text manually');
    }
  }

  // Shared field styling
  const labelClass = 'mb-1 block text-xs font-semibold text-[var(--ink-secondary)]';
  const inputClass =
    'w-full rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)] px-3 py-2 text-sm text-[var(--ink-primary)] placeholder:text-[var(--ink-muted)]';
  const hintClass = 'mt-1 text-[0.7rem] text-[var(--ink-muted)]';
  const copyButtonClass =
    'inline-flex min-h-8 items-center gap-1 rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-card)] px-2.5 py-1 text-xs font-semibold text-[var(--ink-primary)] hover:border-[var(--border-strong)]';
</script>

<dialog
  closedby="any"
  class="hq-dialog"
  aria-labelledby="idea-composer-title"
  bind:this={dialogEl}
  onclose={() => (store.showIdeaComposer = false)}
  use:attachDialogLightDismiss
>
  <div class="flex items-start justify-between gap-4 border-b border-[var(--border-subtle)] p-5">
    <div>
      <div
        class="inline-flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--accent-primary)]"
      >
        <ClipboardList class="h-3.5 w-3.5" aria-hidden="true" />
        <span>20 second capture</span>
      </div>
      <h2 id="idea-composer-title" class="mt-1 text-lg font-bold">Compose a New Paper Idea</h2>
      <p class="text-xs text-[var(--ink-secondary)]">
        Fill the essentials, save to the dashboard preview, then persist via CLI or YAML when ready.
      </p>
    </div>
    <button
      type="button"
      class="inline-flex min-h-9 min-w-9 items-center justify-center rounded-lg border border-[var(--border-subtle)] text-[var(--ink-secondary)] hover:text-[var(--ink-primary)]"
      aria-label="Close idea composer"
      onclick={() => (store.showIdeaComposer = false)}
    >
      <X class="h-4 w-4" aria-hidden="true" />
    </button>
  </div>

  <form class="grid gap-4 p-5 md:grid-cols-2" onsubmit={saveToDashboardPreview}>
    <!-- Core identity -->
    <div class="md:col-span-2">
      <label for="idea-title" class={labelClass}>Title (required)</label>
      <input
        id="idea-title"
        type="text"
        required
        bind:value={title}
        class={inputClass}
        placeholder="e.g. Benchmarking street cycle network metrics against observed flows"
      />
    </div>

    <div>
      <label for="idea-short-title" class={labelClass}>Short Title</label>
      <input
        id="idea-short-title"
        type="text"
        bind:value={shortTitle}
        class={inputClass}
        placeholder="Falls back to the full title"
      />
    </div>

    <div>
      <label for="idea-slug" class={labelClass}>Slug</label>
      <input
        id="idea-slug"
        type="text"
        class={inputClass}
        value={slug}
        oninput={(event) => {
          slugInput = event.currentTarget.value;
          slugTouched = event.currentTarget.value.length > 0;
        }}
      />
      <p class={hintClass}>Auto-generated from the short title (or title) until you edit it manually.</p>
      {#if slugMatchesRepositoryPaper}
        <p class={hintClass} aria-live="polite">
          Note: this slug already matches a repository planned paper. Saving updates that draft in
          your browser preview without touching the repository files.
        </p>
      {/if}
    </div>

    <!-- Classification -->
    <div>
      <label for="idea-category" class={labelClass}>Category</label>
      <select id="idea-category" bind:value={category} class={inputClass}>
        <option value="flagship-project">Flagship project</option>
        <option value="conceptual-methodology">Conceptual methodology</option>
        <option value="literature-gap">Literature gap</option>
      </select>
    </div>

    <div>
      <label for="idea-status" class={labelClass}>Status</label>
      <select id="idea-status" bind:value={status} class={inputClass}>
        <option value="idea">Idea</option>
        <option value="scoping">Scoping</option>
        <option value="active-analysis">Active analysis</option>
        <option value="drafting">Drafting</option>
        <option value="under-review">Under review</option>
      </select>
    </div>

    <!-- Timing -->
    <div>
      <label for="idea-readiness" class={labelClass}>Readiness (%)</label>
      <input
        id="idea-readiness"
        type="number"
        min="0"
        max="100"
        step="1"
        bind:value={readinessPercent}
        class={inputClass}
      />
    </div>

    <div>
      <label for="idea-quarter" class={labelClass}>Target Submission Quarter</label>
      <input
        id="idea-quarter"
        type="text"
        bind:value={targetSubmissionQuarter}
        class={inputClass}
        placeholder="e.g. 2027-Q1"
      />
    </div>

    <div>
      <label for="idea-year" class={labelClass}>
        Target Publication Year ({minYear}-{maxYear})
      </label>
      <input
        id="idea-year"
        type="number"
        min={minYear}
        max={maxYear}
        step="1"
        bind:value={targetPublicationYear}
        class={inputClass}
      />
    </div>

    <div>
      <label for="idea-stage" class={labelClass}>Target Open Science Stage (1-5)</label>
      <select id="idea-stage" bind:value={targetOpenScienceStage} class={inputClass}>
        <option value={1}>1: Open access paper</option>
        <option value={2}>2: Open or synthetic data</option>
        <option value={3}>3: Open source code</option>
        <option value={4}>4: Reproducible documented paper</option>
        <option value={5}>5: Deployed interactive tool</option>
      </select>
    </div>

    <!-- Narrative -->
    <div class="md:col-span-2">
      <label for="idea-summary" class={labelClass}>Summary</label>
      <textarea
        id="idea-summary"
        rows="3"
        bind:value={summary}
        class={inputClass}
        placeholder="One or two sentences on the paper's contribution (optional, a placeholder summary is generated otherwise)"></textarea>
    </div>

    <div class="md:col-span-2">
      <label for="idea-gap" class={labelClass}>Scientific Gap Filled</label>
      <textarea
        id="idea-gap"
        rows="2"
        bind:value={scientificGapFilled}
        class={inputClass}
        placeholder="Which gap in the literature does this paper close? (optional)"></textarea>
    </div>

    <div class="md:col-span-2">
      <label for="idea-milestones" class={labelClass}>Next Milestones (one per line)</label>
      <textarea
        id="idea-milestones"
        rows="2"
        bind:value={milestonesText}
        class={inputClass}
        placeholder="e.g. Assemble STATS19 junction sample&#10;Run first ZINB model"></textarea>
    </div>

    <!-- Target journals (up to 3, ranked) -->
    <div class="md:col-span-2">
      <fieldset class="rounded-xl border border-[var(--border-subtle)] p-4">
        <legend class="px-1 text-xs font-semibold text-[var(--ink-secondary)]">
          Target journals (up to 3, in ranked order)
        </legend>
        <p class="mb-3 text-xs text-[var(--ink-muted)]">
          Human judgement required: run <code>npx @researchhq/cli suggest-journals</code> for publisher-neutral OpenAlex + bibliography matches, then verify scope, editorial board fit, and Read-and-Publish OA coverage (<a
            href="https://github.com/Robinlovelace/researchhq/blob/main/docs/JOURNAL-SELECTION.md"
            target="_blank"
            rel="noopener noreferrer"
            class="underline hover:text-[var(--ink-primary)]">AI journal selection guide</a
          >).
        </p>
        <datalist id="idea-journal-options">
          {#each store.snapshot?.journals ?? [] as journalOption (journalOption.id)}
            <option value={journalOption.name}></option>
          {/each}
        </datalist>
        {#each journalSlots as slot, slotIndex (slotIndex)}
          <div class="mt-3 grid gap-3 first:mt-0 sm:grid-cols-[2fr_1fr]">
            <div>
              <label for="idea-journal-{slotIndex + 1}" class={labelClass}>
                Target journal {slotIndex + 1}
              </label>
              <input
                id="idea-journal-{slotIndex + 1}"
                type="text"
                list="idea-journal-options"
                bind:value={slot.name}
                class={inputClass}
                placeholder="Pick from the list or type a name"
              />
            </div>
            <div>
              <label for="idea-journal-fit-{slotIndex + 1}" class={labelClass}>Fit score (%)</label>
              <input
                id="idea-journal-fit-{slotIndex + 1}"
                type="number"
                min="0"
                max="100"
                bind:value={slot.fitScore}
                class={inputClass}
              />
            </div>
            <div class="sm:col-span-2">
              <label for="idea-journal-why-{slotIndex + 1}" class={labelClass}>Fit rationale</label>
              <input
                id="idea-journal-why-{slotIndex + 1}"
                type="text"
                bind:value={slot.fitRationale}
                class={inputClass}
                placeholder="Why this venue fits (optional)"
              />
            </div>
          </div>
        {/each}
      </fieldset>
    </div>

    <!-- Persistence preview (live, collapsible) -->
    <div class="md:col-span-2">
      <details class="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-subtle)] p-4">
        <summary class="cursor-pointer text-sm font-semibold text-[var(--ink-primary)]">
          Persist to Repository (YAML &amp; CLI)
        </summary>
        <p class="mt-2 text-xs text-[var(--ink-secondary)]">
          Live preview: run the CLI command from the private research repository root, or paste the
          YAML entry into data/planned-papers.yaml (append it under the plannedPapers list). Both
          update as you type.
        </p>
        <div class="mt-3 space-y-4">
          <div>
            <div class="flex items-center justify-between gap-2">
              <span class="text-xs font-semibold text-[var(--ink-secondary)]">CLI command</span>
              <button type="button" class={copyButtonClass} onclick={() => copySnippet(cliCommand, 'cli')}>
                {#if copied === 'cli'}
                  <Check class="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Copied</span>
                {:else}
                  <Copy class="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Copy CLI command</span>
                {/if}
              </button>
            </div>
            <!-- svelte-ignore a11y_no_noninteractive_tabindex: scrollable code region needs keyboard access -->
            <pre role="region" tabindex="0" aria-label="Ready to run add-idea CLI command">{cliCommand}</pre>
          </div>
          <div>
            <div class="flex items-center justify-between gap-2">
              <span class="text-xs font-semibold text-[var(--ink-secondary)]">YAML entry</span>
              <button type="button" class={copyButtonClass} onclick={() => copySnippet(yamlEntry, 'yaml')}>
                {#if copied === 'yaml'}
                  <Check class="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Copied</span>
                {:else}
                  <Copy class="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Copy YAML</span>
                {/if}
              </button>
            </div>
            <!-- svelte-ignore a11y_no_noninteractive_tabindex: scrollable code region needs keyboard access -->
            <pre role="region" tabindex="0" aria-label="Ready to paste planned papers YAML entry">{yamlEntry}</pre>
          </div>
        </div>
      </details>
    </div>

    <!-- Actions -->
    <div
      class="flex flex-wrap items-center gap-3 border-t border-[var(--border-subtle)] pt-4 md:col-span-2"
    >
      <button
        type="submit"
        class="inline-flex min-h-10 items-center gap-1.5 rounded-lg bg-[var(--accent-primary)] px-4 py-2 text-sm font-semibold text-[var(--accent-primary-ink)] shadow-xs transition hover:opacity-90"
      >
        <Check class="h-4 w-4" aria-hidden="true" />
        <span>Save to Dashboard Preview</span>
      </button>
      <p class="text-xs text-[var(--ink-muted)]">
        The idea joins the Kanban board and the future time series immediately (stored in this browser).
      </p>
    </div>

    <!-- Inline save confirmation / validation feedback (polite, non-blocking) -->
    <p aria-live="polite" class="md:col-span-2 text-xs {saveError ? 'font-semibold text-[var(--accent-amber)]' : 'text-[var(--accent-primary)]'}">
      {#if saveError}
        {saveError}
      {:else if savedNotice}
        {savedNotice}
      {/if}
    </p>
  </form>
</dialog>
