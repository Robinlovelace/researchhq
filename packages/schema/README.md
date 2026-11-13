# `@researchhq/schema`

Canonical Zod v4 schemas, TypeScript types, bibliometric calculators (`computeHIndex`, `computeI10Index`, `computeStageCounts`, `computeFwciSummary`, `computeOpenScienceGaps`, `buildTimeSeries`, `aggregateJournalMetrics`, `normalizeJournalId`), BibTeX formatters (`publicationToBibtex`, `publicationsToBibtex`), and the public-export sanitizer (`sanitizePortfolioForPublic`) for [ResearchHQ](https://github.com/Robinlovelace/researchhq).

## Usage

```ts
import {
  PortfolioSnapshotSchema,
  PlannedPaperSchema,
  sanitizePortfolioForPublic,
  computeHIndex,
  computeFwciSummary,
  computeOpenScienceGaps
} from '@researchhq/schema';

const parsed = PortfolioSnapshotSchema.parse(rawJson);
const publicSnapshot = sanitizePortfolioForPublic(parsed);
const fwci = computeFwciSummary(publicSnapshot.publications);
const upgrades = computeOpenScienceGaps(publicSnapshot.publications, 5);
```

## Planned Papers & Percent Complete (`readinessPercent`)

Every future paper in `PlannedPaperSchema` tracks `readinessPercent` (`0..100` integer), `status` (`idea` through `accepted`), `targetSubmissionQuarter` (`YYYY-QN`), `targetPublicationYear`, Open Science stage trajectory (`currentOpenScienceStage` -> `targetOpenScienceStage`), and ranked `targetJournals` (`1..5`).

AI coding/research agents and Zotero libraries (`references.bib`, Better BibTeX citekeys, annotations) can help populate background citations and OpenAlex metadata, whereas `readinessPercent`, milestone scoping, and final target journal selection require researcher judgement.

## License

MIT
