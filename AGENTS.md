# AGENTS.md - ResearchHQ Monorepo

## Overview
`researchhq` is an MIT-licensed, reusable npm workspace monorepo providing:
1. `packages/schema` (`@researchhq/schema`): TypeScript + Zod schemas, computed portfolio analytics, time-series builders, and privacy sanitization (`sanitizePortfolioForPublic`).
2. `packages/cli` (`@researchhq/cli`): Command-line tooling (`init`, `sync`, `add-idea`, `update-idea`, `validate`, `export-public`) for syncing OpenAlex works/venues with local YAML curations (`journal-metrics.yaml`, `planned-papers.yaml`, `overrides.yaml`).
3. `packages/dashboard` (`@researchhq/dashboard`): Svelte 5 (`$state`, `$derived`, `$props`) + `@sveltejs/kit` (`adapter-static`) + Tailwind CSS v4 interactive portfolio and future-publications planner.

## Engineering & Web Standards
- **Zero em-dashes** in documentation, UI copy, or comments: use `-`, `,`, `:`, or parentheses instead.
- **Strict TypeScript**: Avoid `any`; validate external YAML/JSON inputs with `@researchhq/schema` Zod schemas.
- **Privacy Guarantee**: Any field named `privateNotes` or repo links marked `redactUrlInPublic: true` must be stripped by `sanitizePortfolioForPublic()`.
- **Svelte 5 & Modern Web Guidance**:
  - Use Svelte 5 runes (`$state`, `$derived`, `$effect`, `$props`), never legacy `export let` or `$:` reactivity.
  - Subpath compatibility: prefix internal navigation links with `base` from `$app/paths` so deployments at `/research` or `/researchhq` work seamlessly.
  - Accessible sortable tables: `<div tabindex="0" role="region" aria-labelledby="...">` with `container-type: inline-size`, `<button type="button">` inside `<th scope="col">`, `aria-sort` only on active column, `Intl.Collator` sorting, and a single `role="status"` live region (never `aria-live` on `<table>`).
  - Native modals: `<dialog closedby="any" aria-labelledby="...">` opened via `.showModal()`, with JS click-outside coordinate fallback and `overscroll-behavior: contain`.
  - Dark mode: `<meta name="color-scheme" content="light dark">` + `:root { color-scheme: light dark; }` + `:root:has(> head > meta[name="color-scheme"][content="dark"])` override mapping.
  - Complex layouts: `content-visibility: auto; contain-intrinsic-size: auto 300px auto 600px;` on pipeline columns and offscreen heavy sections.
- **Temp files**: Write scratch scripts/files to `/mnt/secondary/tmp/`, not RAM-backed `/tmp`.
