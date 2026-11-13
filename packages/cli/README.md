# `@researchhq/cli`

Zero-bloat command-line interface and programmatic sync library for [ResearchHQ](https://robinlovelace.net/researchhq/): open-source interactive research portfolios, Open Science Stage 1-5 tracking, and future-publications planning.

- **Interactive Demo & Framework Site:** <https://robinlovelace.net/researchhq/>
- **Live Reference Portfolio:** <https://robinlovelace.net/research/>
- **Source Repository & Guides:** <https://github.com/Robinlovelace/researchhq>

## Installation & Immediate `npx` Usage

Requires **Node.js >= 20**.

```bash
# Run directly from the v0.1.0 GitHub Release tarball today (zero install):
npx https://github.com/Robinlovelace/researchhq/releases/download/v0.1.0/researchhq-cli-0.1.0.tgz --help

# Or via the npm registry once published:
npx @researchhq/cli --help
```

To install into a research portfolio repository as a workspace script dependency:

```bash
npm install --save-dev @researchhq/cli
# or prior to registry publication:
npm install --save-dev https://github.com/Robinlovelace/researchhq/releases/download/v0.1.0/researchhq-cli-0.1.0.tgz
```

## Core Workflow & Subcommands

### 1. Scaffold a Portfolio Workspace (`init`)

```bash
npx @researchhq/cli init \
  --dir ./my-research \
  --name "Dr Jane Doe" \
  --orcid "0000-0002-1057-3721" \
  --affiliation "University Example"
```

Creates `researchhq.config.yaml`, `data/planned-papers.yaml`, `data/journal-metrics.yaml`, and `data/overrides.yaml`. Pass `--force` to re-initialise existing template files.

### 2. Sync OpenAlex Works & Hybrid Journal Metrics (`sync`)

Set `OPENALEX_API_KEY` if you have a free OpenAlex key for higher rate limits:

```bash
export OPENALEX_API_KEY="your-openalex-key"

npx @researchhq/cli sync \
  --dir ./my-research \
  --private-out ./my-research/private-output/portfolio.private.json
```

Harvests works, DOIs, annual citation counts, Field-Weighted Citation Impact (`fwci`), Open Access status, and automated venue indicators from OpenAlex, merges local `data/*.yaml` files (plus optional `--scholar-csv <path>`, `--publications-yml <path>`, or `--offline-bundle <path>`), writes the private snapshot if requested, and writes a sanitized `public-data/portfolio.public.json`.

### 3. Validate Schemas & Public Evidence Links (`validate`)

```bash
npx @researchhq/cli validate --dir ./my-research
npx @researchhq/cli validate --dir ./my-research --check-links
```

Validates all YAML inputs and the generated public JSON snapshot against [`@researchhq/schema`](https://www.npmjs.com/package/@researchhq/schema), and optionally verifies HTTP reachability of public Open Science URLs (`--check-links`).

### 4. Audit Citation Impact & Open Science Upgrades (`audit`)

```bash
npx @researchhq/cli audit --dir ./my-research --limit 8
npx @researchhq/cli audit --snapshot ./public-data/portfolio.public.json --json
```

Summarises Field-Weighted Citation Impact (`medianFwci`, `meanFwci`, share above world average `1.00`), Open Science Stage 0-5 counts, and the highest-leverage published works below Stage 4 with concrete upgrade actions (`dataUrl`, `codeUrl`, or `reproducibleRepoUrl` entries for `data/overrides.yaml`).

### 5. Publisher-Neutral Journal Recommendations (`suggest-journals`)

```bash
# Recommend venues from an existing planned-paper slug + Zotero BibTeX file
npx @researchhq/cli suggest-journals \
  --slug "active-travel-equity" \
  --bib ~/kb/references.bib \
  --oa-only \
  --limit 6

# Filter for Diamond OA or capped APCs and write top candidates to planned-papers.yaml
npx @researchhq/cli suggest-journals \
  --slug "active-travel-equity" \
  --diamond-only \
  --write-targets

# Or query directly from a working title and abstract
npx @researchhq/cli suggest-journals \
  --title "National equity appraisal of active travel network investments" \
  --abstract "Spatial accessibility and distributional appraisal across 80 authorities." \
  --max-apc 2500 \
  --json
```

Combines topical OpenAlex search over recent literature with cited-DOI venue frequencies from `--bib <refs.bib>`, annotated with OA/DOAJ status, APCs, 2-year mean citedness, journal h-index, and your historical publication count in each venue.

### 6. Manage Future Papers & Readiness (`add-idea`, `update-idea`, `list-ideas`)

```bash
# Add a planned manuscript
npx @researchhq/cli add-idea \
  --slug "active-travel-equity" \
  --title "National equity appraisal of active travel network investments" \
  --short-title "ActiveTravelEquity" \
  --category "flagship-project" \
  --status "scoping" \
  --readiness 25 \
  --quarter "2027-Q1" \
  --year 2027 \
  --stage 5 \
  --journals "Journal of Transport Geography,Transport Policy" \
  --summary "National spatial accessibility and distributional appraisal of cycling investment."

# Update percent complete (--readiness 0..100), status, schedule, tool URL, or milestones
npx @researchhq/cli update-idea \
  --slug "active-travel-equity" \
  --readiness 65 \
  --status "drafting" \
  --quarter "2026-Q4" \
  --tool-url "https://example.org/equity-explorer" \
  --milestone "Complete sensitivity checks across 80 authorities"

# List all planned papers with status, readiness %, and target submission quarter
npx @researchhq/cli list-ideas
```

`update-idea` mutates `data/planned-papers.yaml` in place while preserving existing YAML comments. You can also adjust readiness in the interactive web dashboard (<https://robinlovelace.net/researchhq/>) and click **Copy CLI update** to paste the exact `update-idea` command.

### 7. Sanitize Private Snapshots for Public Hosting (`export-public`)

```bash
npx @researchhq/cli export-public \
  --in ./private-output/portfolio.private.json \
  --out ./public-data/portfolio.public.json
```

Validates a private `PortfolioSnapshot` JSON file and strips `privateNotes`, `symplecticId`, unconfirmed collaborators, and non-public repository URLs for safe static deployment on GitHub Pages, Netlify, or Quarto websites.

## Zotero + AI Agent Workflow

ResearchHQ pairs automated open-bibliographic harvesting with deliberate researcher judgement:

1. **Automated via OpenAlex, Zotero & AI Agents:**
   - `researchhq sync` harvests ORCID works, annual citations, `fwci`, Open Access links, and automated journal metrics from OpenAlex.
   - AI coding and research agents (such as Hermes, Claude Code, or Zotero MCP integrations) connected to your local **Zotero** library (`references.bib` via Better BibTeX, PDF annotations, and collections) can populate `@citekey` links in `keyCitations`, draft literature-gap summaries (`scientificGapFilled`), run `researchhq suggest-journals --bib references.bib`, and audit Stage 1-5 evidence links.
2. **Researcher Judgement Where It Matters:**
   - **Readiness & Scoping (`readinessPercent`, `privateNotes`):** Co-authors decide whether data licensing, ethics sign-off, validation runs, and manuscript drafting place a paper at `30%` vs `80%` readiness, and what stays private in `privateNotes`.
   - **Responsible Venue Selection (`targetJournals`):** Shortlists from `suggest-journals` or external matchers (B!SON, JANE, OpenAlex; see [Journal Selection Guide](https://github.com/Robinlovelace/researchhq/blob/main/docs/JOURNAL-SELECTION.md)) should be weighed by researchers across disciplinary readership, Diamond/Gold/Hybrid OA and institutional Read & Publish coverage, review turnaround speed, and DORA-aligned responsible metrics.

## Documentation

- [Framework Demo (`robinlovelace.net/researchhq`)](https://robinlovelace.net/researchhq/)
- [Quickstart & Deployment Guide](https://github.com/Robinlovelace/researchhq/blob/main/docs/QUICKSTART.md)
- [Publisher-Neutral Journal Selection Guide](https://github.com/Robinlovelace/researchhq/blob/main/docs/JOURNAL-SELECTION.md)
- [Architecture & Data Model](https://github.com/Robinlovelace/researchhq/blob/main/docs/ARCHITECTURE.md)

## License

MIT License. See [`LICENSE`](./LICENSE) and <https://github.com/Robinlovelace/researchhq>.
