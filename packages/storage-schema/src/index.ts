export { inTransaction } from './database.js';
export type { Database, SqlParameters, SqlRow, SqlValue } from './database.js';
export { runRepositoryConformance } from './conformance.js';
export type { ConformanceResult } from './conformance.js';
export { createHousehold, listHouseholds } from './households.js';
export type { Household } from './households.js';
export {
  ensureDefaultImportContext,
  ensureImportContext,
  importNormalizedRecords,
  listImportRecords,
  listImportRuns,
} from './imports.js';
export type {
  DefaultImportContext,
  ImportBatch,
  ImportBatchResult,
  ImportRecord,
  ImportRun,
  NormalizedImportRecord,
} from './imports.js';
export { migrate, migrations } from './migrations.js';
export type { Migration } from './migrations.js';
export {
  applyExclusiveCardAttribution,
  ensureExclusiveCardContext,
  listReaderShelf,
  overrideAttribution,
  recordAcquisitionFailure,
} from './attributions.js';
export type { ExclusiveCardContext, ReaderShelfItem } from './attributions.js';
export { getEffectiveMetadata, storeMetadataFacts } from './metadata.js';
export {
  getOverride,
  listAttributionTriage,
  saveAttributionOverride,
  writeAttributionResult,
} from './attribution-triage.js';
export type { AttributionTriageItem } from './attribution-triage.js';
export {
  getReadingModel,
  isLibrarySource,
  LIBRARY_SOURCE_KINDS,
  READING_TRAITS,
  saveReadingSession,
  saveWorkAssessment,
} from './reading.js';
export type { ReadingModelView, ReadingTrait, SourceKind } from './reading.js';
export {
  getFreshHoldings,
  getRecommendations,
  saveHoldings,
  saveRecommendationRun,
} from './recommendations.js';
export type {
  HoldingsView,
  RecommendationItemView,
  RecommendationView,
} from './recommendations.js';
export {
  acceptCandidate,
  acceptCachedResolution,
  createManualResolution,
  deferResolution,
  ensureResolutionCase,
  listResolutionQueue,
  mergeWorks,
  rejectResolution,
  replaceResolutionCandidates,
  repointResolution,
  splitEditionToWork,
} from './resolutions.js';
export type { CandidateDraft, ResolutionCase, ResolutionQueueItem } from './resolutions.js';
