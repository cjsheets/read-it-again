import type { AttributionAssessment } from '@read-it-again/domain';

/**
 * Defaults a composition may apply when the conservative domain rules cannot
 * decide. See ADR 0012. The local runtime passes none of these: it has a catalog,
 * so its rules have real evidence and should stay conservative. The browser has
 * no catalog by construction (ADR 0002), so without these defaults every imported
 * book stalls in a review queue forever — audit finding F-01.
 *
 * These are defaults, not bypasses. Every decision they produce is written as an
 * append-only record that a human choice supersedes.
 */
export interface CompositionDefaults {
  /**
   * Create a work from the source record's own title and authors when no catalog
   * candidate is available. Without this, a browser-only record can never resolve,
   * because the browser's catalog port always returns zero candidates.
   */
  readonly acceptSourceDetails?: boolean;
  /**
   * Attribute to the household's only reader when the domain rules could not
   * choose. With one reader there is no other answer to give, so asking is a
   * question with a single possible response.
   */
  readonly assignSingleReader?: boolean;
}

/** Confidence recorded for a resolution the composition made without asking.
 *  A human decision records 1, so the two are distinguishable in the audit
 *  trail without needing a schema change. */
export const AUTOMATIC_RESOLUTION_CONFIDENCE = 0.5;

/** Signals that come from a real catalog record. If any of these are present the
 *  domain had genuine evidence and its judgement stands; the single-reader
 *  default only fills the vacuum left by having no catalog at all. */
const CATALOG_SIGNALS = new Set([
  'call_number_audience',
  'marc_audience',
  'juvenile_heading',
  'juvenile_genre',
]);

/**
 * Applies the single-reader default to an assessment the domain left undecided.
 * Returns the assessment unchanged when the default does not apply, so callers
 * stay idempotent — `recomputeAttributions` compares the result against what is
 * already stored and skips the write when nothing changed.
 */
export function applySingleReaderDefault(
  assessment: AttributionAssessment,
  candidateReaderIds: readonly string[],
): AttributionAssessment {
  const readerId = candidateReaderIds[0];
  if (!readerId || candidateReaderIds.length !== 1) return assessment;
  if (assessment.state === 'assigned') return assessment;
  // A catalog-derived signal means the domain actually knew something. Respect it
  // rather than overriding a considered "this is adult material" with a default.
  if (assessment.evidence.some(({ signal }) => CATALOG_SIGNALS.has(signal))) return assessment;

  return {
    ...assessment,
    state: 'assigned',
    readerIds: [readerId],
    explanation:
      'Attributed automatically because this household has one reader and no catalog ' +
      'evidence was available. Change it any time; your choice will replace this.',
    evidence: [
      ...assessment.evidence,
      {
        signal: 'single_reader_default',
        value: readerId,
        weight: 0,
        explanation:
          'The household has exactly one reader, so this book was attributed automatically.',
      },
    ],
  };
}
