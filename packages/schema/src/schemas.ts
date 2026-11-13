/**
 * @researchhq/schema: Zod schemas and inferred TypeScript types for the
 * ResearchHQ portfolio domain (author profiles, publications, journal
 * metrics, planned papers, time series, and public snapshots).
 */
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Open Science stages (0 = unassessed or paywalled, 5 = deployed tool)
// ---------------------------------------------------------------------------

export type OpenScienceStage = 0 | 1 | 2 | 3 | 4 | 5;

export const OpenScienceStageSchema = z
  .number()
  .int()
  .min(0)
  .max(5)
  .describe(
    'Integer 0..5: 0 unassessed or paywalled, 1 open access paper, 2 open or synthetic data, 3 open source code, 4 reproducible literate paper, 5 deployed interactive tool',
  );

export const OPEN_SCIENCE_STAGE_LABELS: Record<OpenScienceStage, string> = {
  0: 'Unassessed',
  1: 'Open Access Paper',
  2: 'Open or Synthetic Data',
  3: 'Open Source Code',
  4: 'Reproducible Documented Paper',
  5: 'Deployed Interactive Tool',
};

export const OPEN_SCIENCE_STAGE_DESCRIPTIONS: Record<OpenScienceStage, string> = {
  0: 'Open science status not yet assessed, or the published paper is paywalled.',
  1: 'The published paper or preprint is openly readable without a paywall (gold, diamond, hybrid, or green open access).',
  2: 'An underlying open input dataset, benchmark dataset, or privacy-preserving synthetic or sample dataset is published and linked.',
  3: 'Scripts, packages, or repositories used to produce the results are openly licensed on GitHub, GitLab, or Zenodo.',
  4: 'An end-to-end literate, reproducible manuscript (Quarto or RMarkdown with a container or CI workflow) enables independent regeneration of figures and tables.',
  5: 'Research methods are operationalised in a publicly accessible web application or decision-support tool used by practitioners, policymakers, or citizens.',
};

// ---------------------------------------------------------------------------
// Open science evidence attached to a publication
// ---------------------------------------------------------------------------

export const OpenScienceEvidenceSchema = z.object({
  oaStatus: z
    .enum(['gold', 'diamond', 'green', 'hybrid', 'bronze', 'closed', 'unknown'])
    .nullish()
    .describe('Open access status of the published version of record'),
  oaUrl: z.string().nullish(),
  dataUrl: z.string().nullish(),
  codeUrl: z.string().nullish(),
  reproducibleRepoUrl: z.string().nullish(),
  interactiveToolUrl: z.string().nullish(),
  interactiveToolName: z.string().nullish(),
  rationale: z.string().nullish(),
});

export type OpenScienceEvidence = z.infer<typeof OpenScienceEvidenceSchema>;

// ---------------------------------------------------------------------------
// Author metrics and profile
// ---------------------------------------------------------------------------

export type StageCountKey = '0' | '1' | '2' | '3' | '4' | '5';

export const StageCountsSchema = z.record(
  z.enum(['0', '1', '2', '3', '4', '5']),
  z.number(),
);

export type StageCounts = z.infer<typeof StageCountsSchema>;

export const AuthorMetricsSchema = z.object({
  worksCount: z.number(),
  peerReviewedCount: z.number(),
  citedByCount: z.number(),
  citedByScholar: z.number().nullish(),
  hIndex: z.number(),
  hIndexScholar: z.number().nullish(),
  i10Index: z.number(),
  twoYearMeanCitedness: z.number().nullish(),
  oaPercentage: z.number(),
  stageCounts: StageCountsSchema,
  updatedAt: z.string(),
});

export type AuthorMetrics = z.infer<typeof AuthorMetricsSchema>;

export const AuthorProfileSchema = z.object({
  name: z.string(),
  role: z.string(),
  affiliation: z.string(),
  orcid: z.string(),
  openalexId: z.string().nullish(),
  scholarId: z.string().nullish(),
  symplecticId: z.string().nullish(),
  website: z.string().nullish(),
  github: z.string().nullish(),
  bluesky: z.string().nullish(),
  bio: z.string().nullish(),
  metrics: AuthorMetricsSchema,
});

export type AuthorProfile = z.infer<typeof AuthorProfileSchema>;

// ---------------------------------------------------------------------------
// Journal metrics (hybrid model: OpenAlex automated + curated publisher data)
// ---------------------------------------------------------------------------

export const JournalMetricSchema = z.object({
  id: z.string(),
  name: z.string(),
  shortName: z.string().nullish(),
  venueType: z.enum(['journal', 'book-series', 'repository', 'conference', 'other']).nullish(),
  issn: z.array(z.string()).nullish(),
  publisher: z.string().nullish(),
  openalexSourceId: z.string().nullish(),
  twoYearMeanCitedness: z.number().nullish(),
  journalHIndex: z.number().nullish(),
  journalI10Index: z.number().nullish(),
  jif: z.number().nullish(),
  jifYear: z.number().nullish(),
  citescore: z.number().nullish(),
  sjrScore: z.number().nullish(),
  sjrQuartile: z.enum(['Q1', 'Q2', 'Q3', 'Q4']).nullish(),
  isOa: z.boolean().nullish(),
  isInDoaj: z.boolean().nullish(),
  oaModel: z
    .enum(['diamond', 'gold', 'hybrid', 'subscription', 'preprint', 'book', 'unknown'])
    .nullish(),
  apcUsd: z.number().nullish(),
  reviewSpeedWeeks: z.number().nullish(),
  scopeTags: z.array(z.string()),
  homepageUrl: z.string().nullish(),
  authorPublishedCount: z.number(),
  authorCitationsTotal: z.number(),
  authorCitationsMean: z.number(),
  targetPaperCount: z.number(),
  metricSource: z.enum(['hybrid', 'openalex', 'curated']),
});

export type JournalMetric = z.infer<typeof JournalMetricSchema>;

// ---------------------------------------------------------------------------
// Publications
// ---------------------------------------------------------------------------

export const CitationByYearSchema = z.object({
  year: z.number(),
  citedByCount: z.number(),
});

export type CitationByYear = z.infer<typeof CitationByYearSchema>;

export const PublicationSchema = z.object({
  id: z.string(),
  doi: z.string().nullish(),
  openalexId: z.string().nullish(),
  title: z.string(),
  year: z.number(),
  publicationDate: z.string().nullish(),
  type: z.enum(['article', 'book', 'book-chapter', 'preprint', 'report', 'software', 'other']),
  venue: z.string().nullish(),
  journalId: z.string().nullish(),
  authors: z.array(z.string()),
  authorPosition: z.enum(['first', 'last', 'middle', 'solo']).nullish(),
  citations: z.number(),
  citationsOpenAlex: z.number().nullish(),
  citationsScholar: z.number().nullish(),
  citationsByYear: z.array(CitationByYearSchema).nullish(),
  fwci: z.number().nullish(),
  abstract: z.string().nullish(),
  topics: z.array(z.string()),
  openScienceStage: OpenScienceStageSchema,
  openScience: OpenScienceEvidenceSchema,
  bibtexKey: z.string().nullish(),
  url: z.string().nullish(),
  featured: z.boolean().optional(),
});

export type Publication = z.infer<typeof PublicationSchema>;

// ---------------------------------------------------------------------------
// Planned papers and target journals
// ---------------------------------------------------------------------------

export const TargetJournalCandidateSchema = z.object({
  journalId: z.string(),
  journalName: z.string(),
  rank: z.number().int().min(1).max(5),
  fitScore: z.number().min(0).max(100),
  fitRationale: z.string(),
  pros: z.array(z.string()).optional(),
  cons: z.array(z.string()).optional(),
});

export type TargetJournalCandidate = z.infer<typeof TargetJournalCandidateSchema>;

export const RepoLinkSchema = z.object({
  label: z.string(),
  url: z.string(),
  visibility: z.enum(['public', 'private']).optional(),
  redactUrlInPublic: z.boolean().optional(),
});

export type RepoLink = z.infer<typeof RepoLinkSchema>;

export const PlannedPaperSchema = z.object({
  slug: z.string(),
  title: z.string(),
  shortTitle: z.string(),
  category: z.enum(['flagship-project', 'conceptual-methodology', 'literature-gap']),
  status: z.enum([
    'idea',
    'scoping',
    'active-analysis',
    'drafting',
    'under-review',
    'revision',
    'accepted',
  ]),
  readinessPercent: z.number().min(0).max(100),
  targetSubmissionQuarter: z.string(),
  targetPublicationYear: z.number(),
  targetOpenScienceStage: z.number().int().min(1).max(5),
  currentOpenScienceStage: OpenScienceStageSchema,
  summary: z.string(),
  scientificGapFilled: z.string().nullish(),
  methodologyHighlights: z.array(z.string()),
  keyCitations: z.array(z.string()),
  collaborators: z.array(z.string()),
  repoUrls: z.array(RepoLinkSchema),
  interactiveToolUrl: z.string().nullish(),
  nextMilestones: z.array(z.string()),
  targetJournals: z.array(TargetJournalCandidateSchema),
  privateNotes: z.string().nullish(),
});

export type PlannedPaper = z.infer<typeof PlannedPaperSchema>;

// ---------------------------------------------------------------------------
// Time series points (historical publications plus planned future years)
// ---------------------------------------------------------------------------

export const TimeSeriesPointSchema = z.object({
  year: z.number(),
  publishedCount: z.number(),
  articlesCount: z.number(),
  booksAndChaptersCount: z.number(),
  preprintsAndOtherCount: z.number(),
  oaCount: z.number(),
  stage4PlusCount: z.number(),
  citationsEarnedInYear: z.number(),
  citationsOfCohort: z.number(),
  plannedSubmissionsCount: z.number(),
  plannedPublicationsCount: z.number(),
  plannedPaperSlugs: z.array(z.string()),
  isFuture: z.boolean(),
});

export type TimeSeriesPoint = z.infer<typeof TimeSeriesPointSchema>;

// ---------------------------------------------------------------------------
// Configuration and portfolio snapshot
// ---------------------------------------------------------------------------

export const ResearchHqConfigSchema = z.object({
  author: AuthorProfileSchema.omit({ metrics: true }),
  sync: z
    .object({
      openalexAuthorId: z.string().optional(),
      orcid: z.string().optional(),
      minYear: z.number().optional(),
      excludeTypes: z.array(z.string()).optional(),
    })
    .optional(),
  paths: z
    .object({
      plannedPapers: z.string().optional(),
      journalMetrics: z.string().optional(),
      overrides: z.string().optional(),
      publicExport: z.string().optional(),
    })
    .optional(),
});

export type ResearchHqConfig = z.infer<typeof ResearchHqConfigSchema>;

export const PortfolioSnapshotSchema = z.object({
  schemaVersion: z.literal('1.0.0'),
  generatedAt: z.string(),
  sanitized: z.boolean(),
  author: AuthorProfileSchema,
  publications: z.array(PublicationSchema),
  journals: z.array(JournalMetricSchema),
  plannedPapers: z.array(PlannedPaperSchema),
  timeSeries: z.array(TimeSeriesPointSchema),
});

export type PortfolioSnapshot = z.infer<typeof PortfolioSnapshotSchema>;
