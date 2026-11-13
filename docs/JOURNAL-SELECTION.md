# AI Journal Recommenders, Bibliographic APIs, and Publisher-Neutral Venue Selection

> Choosing a target journal should combine **open bibliographic evidence** (where similar work and your own cited references actually appear) with **human academic judgement** on audience, editorial culture, Open Access equity, and review turnaround.

## Why ResearchHQ Separates Historical Sync from Future Venue Selection

For **published works**, bibliographic metadata, citation counts, Field-Weighted Citation Impact (FWCI), and Open Access status can be populated automatically via `researchhq sync` (OpenAlex + ORCID) alongside local Zotero / Better BibTeX libraries.

For **future and in-progress papers** (`data/planned-papers.yaml`), **human researcher input is indispensable**:
- Only you and your co-authors know the realistic **percent complete (`readinessPercent`)** across data cleaning, modelling, validation, and writing.
- Only human authors can judge whether a manuscript is framed primarily as a **methodological/software contribution** (e.g. *CEUS*, *IJGIS*, *JOSS*, *The R Journal*) or a **domain/policy contribution** (e.g. *Journal of Transport Geography*, *Active Travel Studies*, *Transportation Research Part A*).
- Standalone LLMs routinely hallucinate journal names, outdated Article Processing Charges (APCs), or fabricated Impact Factors, while commercial publisher "journal finders" only search their own catalog.

ResearchHQ therefore provides:
1. A deterministic, publisher-neutral CLI helper (`npx @researchhq/cli suggest-journals`) powered by OpenAlex (`260M+` CC0 works across all publishers), cited-DOI bibliography co-occurrence, and your curated `data/journal-metrics.yaml`.
2. This reference guide comparing open-infrastructure vs. publisher-specific AI journal recommenders and Zotero + agent workflows.

---

## 1. Publisher-Neutral and Open-Infrastructure Systems

Start every venue shortlist with cross-publisher tools so society, Diamond OA, and multi-publisher disciplinary journals compete on a level playing field.

| System | Steward / Host | URL & API | Openness | Inputs Accepted | Core Strengths | Key Caveats |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **B!SON** | TIB Hannover & SLUB Dresden (with DOAJ & OpenCitations) | https://service.tib.eu/bison/ (`POST /bison/api/public/v1/search`) | **100% Open Source** (AGPLv3); public REST JSON API | Title, Abstract, **References (DOIs / BibTeX)** | Combines RoBERTa/BM25 semantic matching with OpenCitations reference matching; filters APC ceilings and languages. | Indexes **DOAJ Open Access journals only**; excludes subscription and hybrid venues unless paired with OpenAlex. |
| **OpenAlex** | OurResearch | https://openalex.org/ (`https://api.openalex.org`) | **CC0 Open Data**; open source; free REST API | Search query, DOI lists, CWTS Leiden `topics.id` | `260M+` works across **all publishers and OA models**; native `group_by=primary_location.source.id` aggregation; exposes `is_oa`, `is_in_doaj`, `apc_usd`, `2yr_mean_citedness`, `h_index`. | `apc_usd` reflects list price and does not automatically deduct university Read-and-Publish waivers. |
| **Semantic Scholar (S2AG)** | Allen Institute for AI (Ai2) | https://www.semanticscholar.org/ (`https://api.semanticscholar.org/recommendations/v1/papers/`) | Free REST API; open SPECTER2 embeddings | Multi-seed paper IDs / DOIs (`positivePaperIds`), or search query | Dense scientific embeddings (SPECTER2) trained on citation graphs; finds nearest-neighbour papers from your bibliography's DOIs. | Venue string normalization and OA/APC summary metrics are less structured than OpenAlex `/sources`. |
| **JANE** (Journal/Author Name Estimator) | Biosemantics Group | https://jane.biosemantics.org/ | Free web tool (Apache Lucene) | Title + Abstract (or keywords) | Shows exact k-nearest-neighbour articles driving each journal's confidence score; flags MEDLINE and DOAJ indexing. | **PubMed/MEDLINE corpus only**; limited coverage for engineering, transport, GIS, and urban planning. |
| **Web of Science "Find a Journal"** | Clarivate | https://mjl.clarivate.com/ | Proprietary (free login required; no public API) | Title + Abstract | Cross-publisher matching across Web of Science Core Collection (SCIE, SSCI, AHCI, ESCI). | Closed algorithm; excludes newer Diamond OA journals prior to ESCI indexing; nudges toward JIF-centric selection. |
| **Dimensions** | Digital Science | https://app.dimensions.ai/ | Freemium web UI (API is institutional/paid) | Abstract similarity search + Fields of Research filters | Cross-publisher abstract search with fast "Source Title" sidebar aggregation. | Programmatic API requires institutional license. |
| **DOAJ + Think.Check.Submit** | IS4OA / Cross-industry coalition | https://doaj.org/ & https://thinkchecksubmit.org/ | **CC0 metadata** + free REST API v4 | ISSN, journal title, subject, APC filter | Community-curated whitelist of `20,000+` peer-reviewed OA journals; verifies CC licenses and Diamond OA (`has_apc: false`). | Quality & predatory-journal verification layer rather than a manuscript-similarity matcher. |
| **Jisc Open Policy Finder** (formerly Sherpa Romeo) | Jisc (UK) | https://openpolicyfinder.jisc.ac.uk/ (`https://api.openpolicyfinder.jisc.ac.uk`) | Free web lookup + free registered REST API | Journal ISSN / title, publisher, or funder | Authoritative database of **Green OA self-archiving** permissions (preprint, Author Accepted Manuscript, embargoes) and funder compliance. | Downstream policy verification step once a shortlist is formed. |

> [!CAUTION]
> **Confidentiality warning on commercial AI editing wrappers:** Freemium web tools such as Trinka Journal Finder, Paperpal Preflight, or generic chat wrappers often pair journal matching with commercial editing upsells. Avoid uploading unpublished full-text manuscripts or sensitive partner abstracts to third-party commercial SaaS forms without verified zero-retention terms.

---

## 2. Publisher-Specific Recommenders (Operational Tie-Breakers Only)

Major publishers run free abstract matchers over their own catalogs. They are useful **after** you have a cross-publisher shortlist because several report operational review metrics (**median days to first decision** and **acceptance rate**) that open bibliographic databases lack:

| Tool | URL | Catalog Scope | Operational Metrics Shown | Structural Caveats |
| :--- | :--- | :--- | :--- | :--- |
| **Elsevier JournalFinder** | https://journalfinder.elsevier.com/ | Elsevier (~2,900 journals) | CiteScore, JIF, **Time to 1st Decision**, **Acceptance Rate**, APC | 100% Elsevier lock-in; routinely promotes Gold OA cascade journals (*Heliyon*, *TRIP*) alongside specialist titles. |
| **Springer Nature Journal Suggester** | https://journalsuggester.springernature.com/ | Springer, Nature, BMC, Palgrave (~3,000+ journals) | JIF, **Median days to 1st decision**, Acceptance Rate, OA/APC | Springer Nature lock-in; frequently surfaces high-APC *Discover* / *Scientific Reports* / BMC cascade titles. |
| **Wiley Journal Finder** | https://journalfinder.wiley.com/ | Wiley (~1,600+ journals) | JIF, **Submission to 1st decision**, Acceptance Rate, Read & Publish link | Wiley catalog only; ignores manuscript bibliography. |
| **Taylor & Francis Journal Suggester** | https://authorservices.taylorandfrancis.com/publishing-your-research/choosing-a-journal/journal-suggester/ | Taylor & Francis, Routledge, Cogent, F1000 | JIF, CiteScore, **Avg days to 1st decision**, Acceptance Rate | T&F lock-in; promotes broad *Cogent OA* mega-journals on interdisciplinary abstracts. |
| **IEEE Publication Recommender** | https://publication-recommender.ieee.org/ | IEEE Transactions, Journals & **Conferences** | Impact metrics + **upcoming IEEE conference CFP deadlines** | IEEE Xplore only; strongly promotes *IEEE Access* Gold OA. |
| **SAGE Journal Recommender** | https://journal-recommender.sagepub.com/ | SAGE (~1,100+ journals, incl. *EPB*) | JIF, 5-year JIF, indexing, OA options, **SAGE Path** transfer | SAGE lock-in; SAGE Path keeps rejected drafts inside internal publisher routing. |

---

## 3. Recommended Zotero + CLI + Human Workflow

1. **Curate your paper's reading list in Zotero** (synced to a `.bib` file with Better BibTeX or queried via the Zotero MCP server). Where your manuscript's 20 to 40 core references were published is one of the strongest empirical signals of community fit.
2. **Run `researchhq suggest-journals`** to combine OpenAlex topical similarity, cited-DOI venue co-occurrence, mega-journal size dampening, and your local `data/journal-metrics.yaml`:
   ```bash
   # Suggest venues for an existing planned paper slug in data/planned-papers.yaml
   npx @researchhq/cli suggest-journals --slug bicischools --limit 8

   # Suggest venues from a draft title, abstract, and BibTeX file
   npx @researchhq/cli suggest-journals \
     --title "Fast Path-Sized Traffic Assignment for Cycle Networks" \
     --abstract "We benchmark route network assignment methods across urban active travel networks..." \
     --bib references.bib \
     --oa-only

   # Write top candidates into data/planned-papers.yaml (and hydrate data/journal-metrics.yaml)
   npx @researchhq/cli suggest-journals --slug gap-ratruns-fast-assign --write-targets
   ```
3. **Apply DORA-aligned human judgement** before committing to `targetJournals`:
   - **Framing & Audience**: Read 2 to 3 recent papers in each candidate venue. Does the journal welcome reproducible code/software (Open Science Stage 3 to 5), policy evaluation, or pure mathematical theory?
   - **Editorial Board Recognition**: Do you recognize and trust the Associate Editors handling your sub-field?
   - **Equitable Open Access**: Prefer **Diamond OA** (`$0` APC for authors, `$0` to read globally) or journals covered `100%` by your institution's **Read-and-Publish** agreement (verify via [Jisc Open Policy Finder](https://openpolicyfinder.jisc.ac.uk/)) over unfunded high-APC Gold mega-journals.
   - **Co-Author Timelines**: Weigh review speed (`reviewSpeedWeeks`) carefully when PhD students or postdocs on fixed-term contracts lead the paper.
   - **Predatory Screening**: If an unfamiliar Gold OA venue is not indexed in DOAJ (`isInDoaj: false`), walk through [Think. Check. Submit.](https://thinkchecksubmit.org/) before considering submission.
