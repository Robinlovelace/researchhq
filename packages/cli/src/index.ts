/**
 * @researchhq/cli public API: instance scaffolding, planned paper management,
 * OpenAlex-backed portfolio sync, and validation helpers.
 */
export {
  OfflineOpenAlexClient,
  parseCsv,
  parseCitationCell,
  dedupePreprints,
  dedupeEditions,
  dedupeKey,
  stripEditionMarkers,
  bookEditionTitleKey,
  firstAuthorSurname,
  authorSurnames,
  authorsOverlap,
  normalizeTitleKey,
  loadConfig,
  loadPlannedPapers,
  loadCuratedJournals,
  loadOverrides,
  loadLocalPublications,
  loadScholarCsv,
  resolveInstancePaths,
  syncPortfolio,
  validateInstance,
  checkPublicUrls,
  writeFileEnsuringDir,
  cleanUrlToken,
} from './sync.js';
export type {
  InstancePaths,
  OfflineBundle,
  OpenAlexPort,
  ScholarCitations,
  SyncOptions,
  SyncResult,
  ValidateResult,
  CheckPublicUrlsResult,
  PublicUrlFailure,
  CuratedJournal,
  OverrideEntry,
  LocalPublicationEntry,
} from './sync.js';
export {
  addPlannedPaper,
  updatePlannedPaper,
  listPlannedPapers,
  ensureTargetJournalsRegistered,
  setPlannedPaperTargetJournals,
  ensureJournalMetricStubEntries,
} from './ideas.js';
export type { PlannedPaperInput, PlannedPaperPatch } from './ideas.js';
export { initInstance } from './init.js';
export type { InitOptions, InitResult } from './init.js';
export {
  OpenAlexClient,
  resolveOpenAlexApiKey,
  reconstructAbstract,
  normalizeDoi,
  slugifyVenue,
  parseOrcid,
  matchesCanonicalJournal,
} from './openalex.js';
export type {
  OpenAlexClientOptions,
  RawOpenAlexAuthor,
  RawOpenAlexSource,
  RawOpenAlexLocation,
  RawOpenAlexWork,
} from './openalex.js';
export { runCli, HELP, AUDIT_HELP, SUGGEST_HELP, setSuggestClientFactory } from './cli.js';
export type { SuggestClientFactory } from './cli.js';
export {
  suggestJournals,
  formatSuggestJournalsReport,
  extractSearchTerms,
  extractCitedDois,
  extractCitedDoisForSuggest,
  parseBibEntries,
} from './suggest.js';
export type {
  SuggestJournalsOptions,
  SuggestResult,
  SuggestJournalCandidate,
  SuggestOpenAlexPort,
} from './suggest.js';
export {
  auditInstance,
  loadSnapshot,
  renderAuditReport,
  resolveSnapshotPath,
} from './audit.js';
export type { AuditOptions, AuditResult } from './audit.js';
