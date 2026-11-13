# Example Researcher Instance (`examples/demo-researcher`)

This folder demonstrates the minimal YAML files needed for any researcher or research group to maintain a **ResearchHQ** portfolio:

- `researchhq.config.yaml`: ORCID, affiliation, links, and optional Google Scholar summary snapshot.
- `data/planned-papers.yaml`: Future publications roadmap with ranked target journals and private working notes (`privateNotes`, stripped automatically from `public-data/portfolio.public.json`).
- `data/journal-metrics.yaml`: Optional curated Clarivate JIF and SJR quartile metrics merged with OpenAlex venue statistics.
- `data/overrides.yaml`: Optional Open Science Stage 1-5 overrides and featured output flags.

## Try It Locally

From the repository root after `npm run build`:

```bash
node packages/cli/dist/bin.js sync --dir examples/demo-researcher
node packages/cli/dist/bin.js validate --dir examples/demo-researcher
```
