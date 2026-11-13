# `@researchhq/cli`

Command-line interface and programmatic sync library for [ResearchHQ](https://github.com/Robinlovelace/researchhq): the npm package powering ResearchHQ portfolios and future-publications dashboards.

`@researchhq/cli` harvests author works, annual citations, Field-Weighted Citation Impact (`fwci`), and venue indicators from OpenAlex, merges curated journal metrics (Clarivate JIF, CiteScore, SJR quartiles, review speeds) and Open Science Stage 1-5 overrides, manages planned papers (including **percent complete** via `--readiness <0-100>`), and exports validated private and public JSON snapshots.

## Quick Commands

> **Note:** Once `@researchhq/cli` is published to the npm registry, run via `npx @researchhq/cli <subcommand>`. From a local monorepo build prior to registry publication, invoke `node <path-to-researchhq>/packages/cli/dist/bin.js <subcommand>` (or `npm run <script> --` inside an instance repository).

```bash
# 1. Scaffold a new research portfolio instance
npx @researchhq/cli init --name "Dr Jane Doe" --orcid "0009-0001-2345-678X"

# 2. Sync OpenAlex works + venue metrics and validate all YAML + JSON files
npx @researchhq/cli sync
npx @researchhq/cli validate

# 3. Audit FWCI impact and Open Science Stage 0-3 upgrade opportunities
npx @researchhq/cli audit --limit 8

# 4. Suggest publisher-neutral target journals from OpenAlex + bibliography DOIs
npx @researchhq/cli suggest-journals --slug "active-travel-equity" --limit 6
```

## Adding & Updating Future Papers (Including Percent Complete)

### Add a new paper idea

```bash
npx @researchhq/cli add-idea \
  --slug "active-travel-equity" \
  --title "National equity appraisal of active travel network investments" \
  --category "flagship-project" \
  --status "scoping" \
  --readiness 25 \
  --submission-quarter "2027-Q2" \
  --publication-year 2028 \
  --open-science-stage 5 \
  --journal "Journal of Transport Geography" \
  --journal "Transport Policy" \
  --summary "National spatial accessibility and distributional appraisal of cycling investment."
```

### Quickly update percent complete (`--readiness`) or status

As analysis, drafting, and peer review progress, update completion percentage (`0` to `100`), status, or milestones in one command (preserving comments in `data/planned-papers.yaml`):

```bash
npx @researchhq/cli update-idea \
  --slug "active-travel-equity" \
  --readiness 65 \
  --status "drafting" \
  --milestone "Complete sensitivity checks across 80 authorities"

npx @researchhq/cli list-ideas
npx @researchhq/cli sync
```

You can also adjust **Percent Complete** directly inside the `@researchhq/dashboard` web UI (via the `-10%` / `+10%` card steppers or the slider inside each planned paper's detail dialog) and click **Copy CLI update** to paste the exact `update-idea` command into your terminal.

## Populating Data: AI Agents + Zotero vs. Researcher Input

ResearchHQ is designed for a human-in-the-loop workflow combining automated bibliographic tooling with researcher judgement:

1. **What OpenAlex, Zotero, and AI Agents Can Automate:**
   - **OpenAlex (`researchhq sync`):** Automatically populates published works, DOIs, co-authors, annual citation counts, `fwci`, Open Access links, and automated journal metrics (`twoYearMeanCitedness`, `journalHIndex`, DOAJ/OA status, APCs).
   - **Zotero + Better BibTeX + AI Agents:** AI agents (such as Hermes, Claude Code, or Zotero MCP integrations) can read your local Zotero collections, PDF annotations, and `references.bib` library to extract `@citekey` links (`keyCitations`), draft literature-gap summaries (`scientificGapFilled`), and check publisher Open Access policies.
2. **Where Human Researcher Input Is Essential (Future Papers & Target Journals):**
   - **Scoping & Percent Complete (`readinessPercent`):** Only you and your co-authors know whether data licensing, ethics approval, model calibration, or co-author sign-off make a manuscript truly `30%` vs `80%` complete, and what belongs in confidential `privateNotes` vs public milestones.
   - **Selecting Appropriate Target Journals (`targetJournals`):** `npx @researchhq/cli suggest-journals` and external AI journal-finder tools (such as OpenAlex topic matching, B!SON, JANE, or publisher matchers; see [`docs/JOURNAL-SELECTION.md`](../../docs/JOURNAL-SELECTION.md)) can shortlist candidate venues from a working title, abstract, and `.bib` bibliography, but **researcher judgement is required** to weigh disciplinary audience fit, methodological rigour, Diamond/Gold/Hybrid Open Access routes and institutional APC agreements, review turnaround times, and DORA-aligned responsible metrics rather than optimising solely for Journal Impact Factor.

## License

MIT
