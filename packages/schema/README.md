# `@researchhq/schema`

Canonical Zod v4 schemas, inferred TypeScript types, bibliometric and Open Science analytics, BibTeX exporters, and the public-export sanitizer powering [ResearchHQ](https://robinlovelace.net/researchhq/).

- **Interactive Demo & Framework Site:** <https://robinlovelace.net/researchhq/>
- **Live Reference Portfolio:** <https://robinlovelace.net/research/>
- **Source Repository & Documentation:** <https://github.com/Robinlovelace/researchhq>

## Installation

```bash
# From npm (once published)
npm install @researchhq/schema

# Or directly from the v0.1.0 GitHub Release tarball today
npm install https://github.com/Robinlovelace/researchhq/releases/download/v0.1.0/researchhq-schema-0.1.0.tgz
```

Requires **Node.js >= 20** (ESM package with full TypeScript declarations).

## Quick Example

```ts
import {
  PortfolioSnapshotSchema,
  PlannedPaperSchema,
  OPEN_SCIENCE_STAGE_LABELS,
  sanitizePortfolioForPublic,
  computeHIndex,
  computeI10Index,
  computeFwciSummary,
  computeOpenScienceGaps,
  computeStageCounts,
  buildTimeSeries,
  publicationsToBibtex,
} from '@researchhq/schema';

// 1. Validate a full portfolio snapshot (private or public)
const snapshot = PortfolioSnapshotSchema.parse(rawPortfolioJson);

// 2. Strip private working notes, tentative collaborators, and private repo URLs
const publicSnapshot = sanitizePortfolioForPublic(snapshot);

// 3. Compute bibliometric & Open Science Stage 0-5 indicators
const citations = publicSnapshot.publications.map((p) => p.citations);
const hIndex = computeHIndex(citations);
const i10Index = computeI10Index(citations);
const fwci = computeFwciSummary(publicSnapshot.publications);
const stageCounts = computeStageCounts(publicSnapshot.publications);
const upgrades = computeOpenScienceGaps(publicSnapshot.publications, 5);

// 4. Export disambiguated BibTeX entries for LaTeX / Quarto / Zotero
const bibtex = publicationsToBibtex(publicSnapshot.publications, {
  includeCitationNote: true,
});
```

## Exported Modules

### 1. Domain Schemas & Types

- `PortfolioSnapshotSchema` (`PortfolioSnapshot`): Top-level schema bundling `author`, `publications`, `journals`, `plannedPapers`, `timeSeries`, `generatedAt`, and `sanitized`.
- `AuthorProfileSchema` & `AuthorMetricsSchema`: Researcher ORCID, OpenAlex/Scholar identifiers, dual-provenance `hIndex` / `i10Index`, `twoYearMeanCitedness`, `oaPercentage`, and `stageCounts`.
- `PublicationSchema` & `OpenScienceEvidenceSchema`: Published articles, books, preprints, reports, and software with annual `citationsByYear`, Field-Weighted Citation Impact (`fwci`), and Open Science evidence (`oaUrl`, `dataUrl`, `codeUrl`, `reproducibleRepoUrl`, `interactiveToolUrl`).
- `OpenScienceStageSchema`, `OPEN_SCIENCE_STAGE_LABELS`, `OPEN_SCIENCE_STAGE_DESCRIPTIONS`: The 0-5 Open Science ladder (Stage 0 Unassessed, Stage 1 Open Access Paper, Stage 2 Open or Synthetic Data, Stage 3 Open Source Code, Stage 4 Reproducible Documented Paper, Stage 5 Deployed Interactive Tool).
- `JournalMetricSchema`: Hybrid venue metrics combining OpenAlex indicators (`twoYearMeanCitedness`, `journalHIndex`, `isOa`, `isInDoaj`, `apcUsd`) with optional curated indicators (`jif`, `citescore`, `sjrScore`, `sjrQuartile`, `reviewSpeedWeeks`).
- `PlannedPaperSchema` & `TargetJournalCandidateSchema`: Future publications pipeline with `status` (`idea` through `accepted`), `readinessPercent` (`0..100` integer), `targetSubmissionQuarter` (`YYYY-QN`), `targetPublicationYear`, Open Science stage trajectory, ranked `targetJournals` (`1..5`), `keyCitations`, and `privateNotes`.

### 2. Portfolio Analytics

- `computeHIndex(citations)` and `computeI10Index(citations)`: Standard citation index calculators.
- `computeFwciSummary(publications)`: Median, mean, max, and above-world-average (`fwci > 1.0`) share across evaluated works.
- `computeOpenScienceGaps(publications, limit)`: Ranks high-impact works below Stage 4 by `citations + 5 * fwci` and suggests concrete upgrade actions (`data/overrides.yaml` slug + next stage).
- `computeStageCounts(publications)`: Counts outputs in Open Science Stages `'0'` through `'5'`.
- `buildTimeSeries(publications, plannedPapers, options)`: Connects historical annual output and citations into projected future publication years.
- `aggregateJournalMetrics(...)` and `normalizeJournalId(name)`: Merges OpenAlex venue stats with curated YAML overrides under canonical slugs.

### 3. Public Privacy Sanitizer

- `sanitizePortfolioForPublic(snapshot, options)`: Deep-clones and re-validates a `PortfolioSnapshot`, guaranteeing `sanitized: true`, deleting `privateNotes` and `author.symplecticId`, redacting non-public or flagged `repoUrls`, and clearing `collaborators` by default (unless `includeCollaborators: true`, which still filters tentative/TBC entries).

### 4. BibTeX Formatting

- `publicationToBibtex(pub, options)`, `publicationsToBibtex(pubs, options)`, `bibtexKeyFor(pub)`, `escapeBibtex(text)`: Generates LaTeX-safe `@article`, `@book`, `@incollection`, `@techreport`, and `@misc` entries with collision-free citekeys (`lovelace2016propensity`, `a`, `b`, ...).

## Zotero + AI Agent Workflow

`PlannedPaperSchema` is designed for human-in-the-loop academic planning alongside [`@researchhq/cli`](https://www.npmjs.com/package/@researchhq/cli):

- **Zotero & AI Agents:** Tools reading a local Zotero Better BibTeX library (`references.bib`), PDF annotations, and OpenAlex APIs can populate `keyCitations`, draft `scientificGapFilled` summaries, and shortlist candidate venues.
- **Researcher Judgement:** Setting realistic `readinessPercent` (`0..100`), recording confidential collaborator or licensing context in `privateNotes`, and choosing final `targetJournals` across scope fit, institutional Open Access/APC routes, review speed, and DORA-aligned responsible metrics remain under researcher control.

## License

MIT License. See [`LICENSE`](./LICENSE) and <https://github.com/Robinlovelace/researchhq>.
