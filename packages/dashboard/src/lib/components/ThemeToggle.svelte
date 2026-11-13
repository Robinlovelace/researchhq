<script lang="ts">
  import { Monitor, Moon, Sun } from '@lucide/svelte';
  import { onMount } from 'svelte';

  type SchemeChoice = 'system' | 'light' | 'dark';

  let choice = $state<SchemeChoice>('system');

  function applyScheme(next: SchemeChoice, persist = true) {
    choice = next;
    if (typeof document !== 'undefined') {
      const meta = document.querySelector('meta[name="color-scheme"]');
      meta?.setAttribute('content', next === 'system' ? 'light dark' : next);
    }
    if (persist && typeof window !== 'undefined') {
      try {
        if (next === 'system') {
          window.localStorage.removeItem('researchhq-color-scheme');
        } else {
          window.localStorage.setItem('researchhq-color-scheme', next);
        }
      } catch {
        // Storage unavailable
      }
    }
  }

  onMount(() => {
    try {
      const saved = window.localStorage.getItem('researchhq-color-scheme');
      if (saved === 'light' || saved === 'dark') {
        choice = saved;
      }
    } catch {
      // Ignore storage access error
    }
  });
</script>

<div
  role="group"
  aria-label="Color scheme"
  class="inline-flex items-center rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-subtle)] p-0.5 text-xs font-medium"
>
  <button
    type="button"
    aria-pressed={choice === 'system'}
    onclick={() => applyScheme('system')}
    class="inline-flex min-h-7 min-w-7 items-center gap-1 rounded-md px-2 py-1 {choice ===
    'system'
      ? 'bg-[var(--surface-card)] text-[var(--ink-primary)] shadow-xs'
      : 'text-[var(--ink-muted)] hover:text-[var(--ink-primary)]'}"
    title="Follow system appearance"
  >
    <Monitor class="h-3.5 w-3.5" aria-hidden="true" />
    <span class="hidden sm:inline">Auto</span>
  </button>
  <button
    type="button"
    aria-pressed={choice === 'light'}
    onclick={() => applyScheme('light')}
    class="inline-flex min-h-7 min-w-7 items-center gap-1 rounded-md px-2 py-1 {choice ===
    'light'
      ? 'bg-[var(--surface-card)] text-[var(--ink-primary)] shadow-xs'
      : 'text-[var(--ink-muted)] hover:text-[var(--ink-primary)]'}"
    title="Light theme"
  >
    <Sun class="h-3.5 w-3.5" aria-hidden="true" />
    <span class="hidden sm:inline">Light</span>
  </button>
  <button
    type="button"
    aria-pressed={choice === 'dark'}
    onclick={() => applyScheme('dark')}
    class="inline-flex min-h-7 min-w-7 items-center gap-1 rounded-md px-2 py-1 {choice ===
    'dark'
      ? 'bg-[var(--surface-card)] text-[var(--ink-primary)] shadow-xs'
      : 'text-[var(--ink-muted)] hover:text-[var(--ink-primary)]'}"
    title="Dark theme"
  >
    <Moon class="h-3.5 w-3.5" aria-hidden="true" />
    <span class="hidden sm:inline">Dark</span>
  </button>
</div>
