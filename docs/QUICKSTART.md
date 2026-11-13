# ResearchHQ Quickstart & Deployment Guide

This guide walks through adopting **ResearchHQ** for your own academic portfolio or research group, keeping sensitive planning notes private while publishing an interactive static dashboard on GitHub Pages or alongside a Quarto website.

---

## 1. Recommended Two-Repository Pattern

ResearchHQ is designed around a clean separation between **open-source engine** and **personal portfolio data**:

1. **Engine (`researchhq`):** Open-source monorepo (`@researchhq/schema`, `@researchhq/cli`, `@researchhq/dashboard`). You do not need to fork it unless you want to customise UI components.
2. **Instance repository (e.g. `research`, private or public):** Stores your `researchhq.config.yaml`, `data/planned-papers.yaml`, `data/journal-metrics.yaml`, `data/overrides.yaml`, and generated `public-data/portfolio.public.json`.

Why keep the instance repository private?

- You can record candid working notes (`privateNotes`) on referee feedback, grant dependencies, or internal deadlines.
- You can attach internal repository URLs marked with `visibility: private` and `redactUrlInPublic: true`.
- When you run `researchhq sync`, `sanitizePortfolioForPublic()` strips every `privateNotes` field and replaces redacted URLs with `""` while keeping non-sensitive badges (such as `"Private working repository"`) intact in `public-data/portfolio.public.json`.
- GitHub Pages can deploy static sites directly from a private repository (on GitHub Pro, Team, Enterprise, or Academic accounts) to `https://<your-domain>/research/`.

---

## 2. Scaffolding Your Instance

```bash
mkdir research && cd research
git init

# Run from a local checkout of researchhq (or via npx @researchhq/cli once published)
node /path/to/researchhq/packages/cli/dist/bin.js init \
  --name "Prof Example Researcher" \
  --orcid "0009-0001-2345-678X" \
  --affiliation "Department of Geography, Example University"
```

### `researchhq.config.yaml`

```yaml
author:
  name: "Prof Example Researcher"
  role: "Professor of Spatial Data Science"
  affiliation: "Example University"
  orcid: "0009-0001-2345-678X"
  scholarId: "abcdefgAAAAJ"
  website: "https://example.org"
  github: "https://github.com/example"
  bluesky: "https://bsky.app/profile/example.bsky.social"
  bio: "Short research focus summary."

sync:
  minYear: 2012
  # Optional Google Scholar summary snapshot for dual-provenance comparison
  scholarSummary:
    citedByCount: 4200
    hIndex: 33
    i10Index: 64

paths:
  plannedPapers: "data/planned-papers.yaml"
  journalMetrics: "data/journal-metrics.yaml"
  overrides: "data/overrides.yaml"
  scholarCsv: "data/citations_google_scholar.csv"
  publicExport: "public-data/portfolio.public.json"
```

---

## 3. Syncing with OpenAlex

OpenAlex provides open bibliographic metadata for works, authors, citations by year, Open Access status, and journals.

1. Request a free API key at <https://openalex.org/> (optional, recommended for fast batch harvesting).
2. Export `OPENALEX_API_KEY` in your shell or GitHub Actions repository secrets:

```bash
export OPENALEX_API_KEY="your_api_key_here"
researchhq sync
researchhq validate
```

Optional enrichment flags on `researchhq sync`:

- `--scholar-csv <path>`: Merge Google Scholar per-paper citation counts exported as CSV (`Title`, `Year`, `Cited by` or `year,citations`).
- `--publications-yml <path>`: Enrich works with `codeUrl`, `interactiveToolUrl`, or categories from an existing Quarto `publications.yml` file.
- `--private-out <path>`: Also write the unsanitized `PortfolioSnapshot` (default `private-output/portfolio.private.json`, which should be listed in `.gitignore`).

---

## 4. Curating Hybrid Journal Metrics (`data/journal-metrics.yaml`)

OpenAlex automatically populates `twoYearMeanCitedness`, `journalHIndex`, `journalI10Index`, `isOa`, `isInDoaj`, and `apcUsd` for every journal you have published in or targeted.

Because Clarivate Journal Impact Factor (`jif`) and SCImago Journal Rank quartiles (`sjrQuartile`) are proprietary publisher metrics, you can optionally record them in `data/journal-metrics.yaml` for key journals in your field:

```yaml
- id: journal-of-transport-geography
  name: "Journal of Transport Geography"
  shortName: "JTG"
  publisher: "Elsevier"
  issn: ["0966-6923"]
  jif: 6.3
  jifYear: 2025
  sjrQuartile: "Q1"
  oaModel: "hybrid"
  apcUsd: 3520
  reviewSpeedWeeks: 14
  scopeTags:
    - transport-geography
    - spatial-analysis
    - active-travel
  homepageUrl: "https://www.sciencedirect.com/journal/journal-of-transport-geography"
```

When both OpenAlex and curated metrics are present for a journal, ResearchHQ merges them and labels `metricSource: "hybrid"`.

---

## 5. Managing Your Future Publications Pipeline (`data/planned-papers.yaml`)

Each planned paper supports:

- `category`: `flagship-project`, `conceptual-methodology`, or `literature-gap`
- `status`: `idea`, `scoping`, `active-analysis`, `drafting`, `under-review`, `revision`, or `accepted`
- `readinessPercent`: `0` to `100`
- `targetSubmissionQuarter` (e.g. `"2026-Q3"`) and `targetPublicationYear` (e.g. `2027`)
- `currentOpenScienceStage` (`0..5`) and `targetOpenScienceStage` (`1..5`)
- `scientificGapFilled`, `methodologyHighlights`, `collaborators`, `nextMilestones`
- `targetJournals`: up to 5 ranked candidate journals (`rank`, `fitScore`, `fitRationale`, `pros`, `cons`)
- `privateNotes`: stripped automatically from public exports

Fast terminal updates when a paper progresses:

```bash
researchhq update-idea \
  --slug my-paper-slug \
  --status under-review \
  --readiness 90 \
  --milestone "Submitted to first-choice journal"

researchhq sync && researchhq validate
```

---

## 6. Deploying Under a Custom Domain Subpath (Quarto + GitHub Pages)

If your main academic website lives at `https://yourdomain.org/` (for example, built with Quarto in a `yourdomain.org` repository using a `CNAME` file), GitHub Pages automatically mounts any sibling repository named `research` at `https://yourdomain.org/research/`!

Create `.github/workflows/deploy-pages.yml` in your `research` repository:

```yaml
name: Build and Deploy Portfolio Dashboard

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout portfolio repository
        uses: actions/checkout@v4
        with:
          path: instance

      - name: Checkout ResearchHQ engine
        uses: actions/checkout@v4
        with:
          repository: Robinlovelace/researchhq
          path: engine

      - name: Setup Node.js 22
        uses: actions/setup-node@v4
        with:
          node-version: '22'

      - name: Install, validate, and build static site
        run: |
          cd engine
          npm ci
          npm run build -w @researchhq/schema
          npm run build -w @researchhq/cli
          node packages/cli/dist/bin.js validate --dir ../instance
          cp ../instance/public-data/portfolio.public.json packages/dashboard/static/data/portfolio.json
          RESEARCHHQ_BASE_PATH=/research npm run build -w @researchhq/dashboard

      - name: Upload Pages artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: engine/packages/dashboard/build

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

Enable **Settings -> Pages -> Source: GitHub Actions** on the repository, push to `main`, and your interactive dashboard will publish at `https://yourdomain.org/research/`.

---

## 7. Deep-Linking, Quarto Embedding & Portfolio Audits

### Shareable URL Deep Links

Every tab, filter, and detail modal synchronises cleanly with URL query parameters via `history.replaceState`:

- `?tab=pipeline` (tabs: `overview`, `timeseries`, `journals`, `publications`, `pipeline`)
- `?tab=publications&stage=5` (filter to Stage 5 Deployed Interactive Tools)
- `?tab=publications&venue=Journal+of+Transport+Geography&q=cycling`
- `?tab=pipeline&paper=bicischools` (deep-link directly to a planned paper's detail modal)

### Compact Quarto / Lab Website Embedding (`?embed=1`)

Append `embed=1` to render a compact, chrome-light layout designed for embedding inside Quarto `.qmd` pages or institutional profiles:

```html
<iframe
  src="https://yourdomain.org/research/?tab=pipeline&embed=1"
  title="Planned Research Pipeline"
  width="100%"
  height="680"
  style="border: 1px solid #cbd5e1; border-radius: 12px;"
  loading="lazy"
></iframe>
```

### Actionable Open Science & FWCI Audits (`researchhq audit`)

Run `researchhq audit` at any time to inspect Field-Weighted Citation Impact (`FWCI`, where `1.00` equals the world subfield/year average) and identify your highest-impact Stage 0-3 works that can be lifted up the 5-Stage Open Science ladder by linking a green OA manuscript, open dataset, code repository, or reproducible Quarto workflow in `data/overrides.yaml`:

```bash
researchhq audit --limit 10
researchhq audit --json > audit-report.json
```

