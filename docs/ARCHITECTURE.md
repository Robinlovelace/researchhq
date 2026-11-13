# ResearchHQ Architecture & Technical Reference

This document describes the domain model, synchronization pipeline, privacy sanitization boundary, and front-end engineering standards of **ResearchHQ**.

---

## 1. Design Principles

1. **Zero-Backend Static Deployment:** The dashboard compiles via `@sveltejs/kit` + `@sveltejs/adapter-static` into pure static HTML, CSS, and JS bundles reading a single validated JSON snapshot (`static/data/portfolio.json`). It can be hosted on GitHub Pages, Netlify, Cloudflare Pages, institutional web servers, or inside a Quarto `_site/` directory with zero server maintenance.
2. **Schema-First Validation:** Every CLI input (`researchhq.config.yaml`, `planned-papers.yaml`, `journal-metrics.yaml`, `overrides.yaml`) and every output (`portfolio.private.json`, `portfolio.public.json`) is validated by Zod v4 schemas in `@researchhq/schema`.
3. **Explicit Metric Provenance:** Citation counts and venue indicators differ substantially across bibliographic databases. Rather than silently mixing numbers, ResearchHQ stores `citationsOpenAlex` alongside optional `citationsScholar`, and tags every journal record with `metricSource: "hybrid" | "openalex" | "curated"`.
4. **Hardened Public Sanitization Boundary:** Private planning notes never enter the public bundle. `researchhq validate` fails with a non-zero exit code if `sanitized !== true` or if any `privateNotes` or unredacted private URLs survive in `public-data/portfolio.public.json`.

---

## 2. Package Responsibilities

### `@researchhq/schema` (`packages/schema`)

- **`schemas.ts`:** Canonical Zod v4 schemas and inferred TypeScript types:
  - `AuthorProfileSchema` & `AuthorMetricsSchema`
  - `PublicationSchema`, `CitationByYearSchema`, `OpenScienceStageSchema` (`0..5`), `OpenScienceEvidenceSchema`
  - `JournalMetricSchema`
  - `PlannedPaperSchema`, `TargetJournalCandidateSchema`, `RepoLinkSchema`
  - `TimeSeriesPointSchema` & `PortfolioSnapshotSchema`
- **`analytics.ts`:** Pure, deterministic metric calculators:
  - `computeHIndex(citations)` and `computeI10Index(citations)`
  - `computeStageCounts(publications)`
  - `computeFwciSummary(publications)` and `computeOpenScienceGaps(publications, limit)` for Field-Weighted Citation Impact (`fwci`) summaries and actionable Open Science stage upgrade recommendations
  - `buildTimeSeries(publications, plannedPapers, options)` merging historical publication counts, citation counts by year, and Open Science Stage 4+ counts with future `plannedSubmissionsCount` and `plannedPublicationsCount`
  - `aggregateJournalMetrics({ baseJournals, publications, plannedPapers })` and `normalizeJournalId(raw)` computing per-venue `authorPublishedCount`, `authorCitationsTotal`, `authorCitationsMean`, and `targetPaperCount`
- **`bibtex.ts`:** `escapeBibtex`, `bibtexKeyFor`, `publicationToBibtex`, and `publicationsToBibtex` generating LaTeX-safe surname-keyed BibTeX entries.
- **`sanitize.ts`:** `sanitizePortfolioForPublic(snapshot)` deep-clones a `PortfolioSnapshot`, strips `author.symplecticId`, deletes `privateNotes` on all `PlannedPaper` items, clears `url` on any `RepoLink` where `redactUrlInPublic === true` or `visibility === "private"`, deletes `redactUrlInPublic` markers, and sets `sanitized = true`.

### `@researchhq/cli` (`packages/cli`)

- **`cli.ts` & `bin.ts`:** Symlink-safe CLI dispatcher (`runCli(argv)` in `cli.ts`, invoked unconditionally by the 3-line launcher `bin.ts` so `node_modules/.bin/researchhq` symlinks and `npx @researchhq/cli` work reliably).
- **`openalex.ts`:** Rate-limit-aware, retrying OpenAlex REST v2 client (`OpenAlexClient`). Resolves ORCID (`0000-` and `0009-`, including `X` checksums) -> Author ID, paginates all author works (`per-page=200`), reconstructs abstracts from `abstract_inverted_index`, batches source lookups (`ids.openalex`), and verifies normalized title or ISSN match sorted by `works_count` so stub ISSN records never shadow canonical journals. Never leaks `apiKey` in thrown error URLs.
- **`sync.ts`:** Orchestrates YAML loading, DOI normalisation, CRAN/MRAN software mirror reclassification and version deduplication, strict `venueType === "journal"` `peerReviewedCount` calculation, optional Scholar CSV (`paths.scholarCsv`) and Quarto `publications.yml` (`paths.publicationsYml`) enrichment, heuristic + override-driven Open Science stage classification, analytics computation, and dual private/public JSON output.
- **`audit.ts`:** Implements `researchhq audit [--json]`, reporting dual-provenance impact indices, FWCI distribution, 5-Stage Open Science distribution, and prioritized `overrides.yaml` upgrade opportunities.
- **`ideas.ts` & `init.ts`:** Comment-preserving YAML mutations (`addPlannedPaper`, `updatePlannedPaper`, `listPlannedPapers`) and idempotent workspace scaffolding (`initInstance`).

### `@researchhq/dashboard` (`packages/dashboard`)

Built with **Svelte 5 runes** (`$state`, `$derived`, `$effect`, `$props`), **SvelteKit 3** (`@sveltejs/kit@^3.2.0`), and **Tailwind CSS v4** (`@tailwindcss/vite`).

Key UI and accessibility architecture:

- **Theme Cascade (`ThemeToggle.svelte` + `app.css`):** Uses `:root { color-scheme: light dark }` paired with `:root:has(meta[name="color-scheme"][content="dark"])` rules and `light-dark()` tokens so OS preferences work with zero flash and manual overrides cascade cleanly across native form controls (`accent-color`).
- **WAI-ARIA Navigation Tabs (`+page.svelte`):** Semantic `role="tablist"` / `role="tab"` / `role="tabpanel"` with pseudo-element active underlines (`border-bottom` preserved in Windows High Contrast / `forced-colors` mode).
- **Container-Queried Sortable Tables (`JournalsTab.svelte`, `PublicationsTab.svelte`):** Wrapped in `@container` regions so secondary columns adapt to container width rather than viewport width. Sortable headers place `<button type="button">` inside `<th scope="col" aria-sort="...">` without `aria-live` spam on row reordering.
- **Native Modal Dialogs (`PublicationDetailDialog.svelte`, `PlannedPaperDetailDialog.svelte`, `IdeaComposerDialog.svelte`):** Built on native `<dialog>.showModal()` with backdrop click light-dismiss, native `Escape` handling, and automatic focus restoration.
- **Shareable URL State & Compact Embed Mode (`+page.svelte`):** Synchronises `tab`, `stage`, `venue`, `q`, `pub`, and `paper` with `window.location.search` via `history.replaceState` and `popstate`, and supports `?embed=1` compact chrome-light rendering for Quarto and lab website iframes.
- **Schema.org Structured Data (`jsonld.ts`):** Emits XSS-escaped `application/ld+json` `@graph` metadata (`Person` with ORCID/OpenAlex/Scholar `sameAs` links + top-cited `ScholarlyArticle`/`Book`/`SoftwareSourceCode` entities) in `<svelte:head>`.
- **Layout Containment:** Apply CSS `contain: content` on independent metric cards and chart panels so interactive filtering avoids full-document layout recalculations.

---

## 3. Testing Strategy

1. **Schema & Sanitizer Unit Tests (`packages/schema/test/`):** Verify Zod validation, h-index / i10-index edge cases, past-to-future time series aggregation, and guaranteed removal of `privateNotes` and redacted private repository URLs.
2. **CLI Integration Tests (`packages/cli/test/`):** Test `init`, offline `sync`, `validate`, `add-idea`, `update-idea`, and `export-public` in temporary workspaces without network dependencies.
3. **Playwright E2E + Axe Accessibility Suite (`packages/dashboard/tests/`):** Runs against the static production build across desktop (`1280x800`) and mobile (`375x812`) viewports, testing every tab, filter, sort button, native modal `<dialog>`, `IdeaComposerDialog` validation, dark-mode toggle, and `@axe-core/playwright` WCAG 2.1 AA compliance.
