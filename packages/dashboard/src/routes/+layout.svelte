<script lang="ts">
  import '../app.css';
  import type { Snippet } from 'svelte';

  let { children }: { children: Snippet } = $props();
</script>

<a href="#main-content" class="skip-link">Skip to main content</a>

{@render children()}
