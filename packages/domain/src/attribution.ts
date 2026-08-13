export type AttributionState = 'assigned' | 'excluded' | 'review';

export interface AttributionSignal {
  readonly signal: string;
  readonly value: string;
  readonly weight: number;
  readonly explanation: string;
}

export interface AttributionInput {
  readonly callNumber?: string;
  readonly sourceFormat?: string;
  readonly audience?: string;
  readonly juvenileHeading?: boolean;
  readonly genres?: readonly string[];
  readonly pageCount?: number;
  readonly candidateReaderIds: readonly string[];
}

export interface AttributionAssessment {
  readonly state: AttributionState;
  readonly readerIds: readonly string[];
  readonly confidence: number;
  readonly score: number;
  readonly explanation: string;
  readonly evidence: readonly AttributionSignal[];
  readonly algorithmVersion: 'attribution-v1';
}

export function assessAttribution(input: AttributionInput): AttributionAssessment {
  const evidence: AttributionSignal[] = [];
  const callPrefix = input.callNumber?.trim().toUpperCase().split(/\s+/u)[0];
  if (callPrefix === 'E' || callPrefix === 'J') {
    evidence.push({
      signal: 'call_number_audience',
      value: callPrefix,
      weight: 0.8,
      explanation: `KCLS call number begins with ${callPrefix}, a juvenile shelf prefix.`,
    });
  }
  const audience = input.audience?.trim().toLowerCase();
  if (audience && ['a', 'b', 'c', 'd', 'j'].includes(audience)) {
    evidence.push({
      signal: 'marc_audience',
      value: audience,
      weight: 0.8,
      explanation: `MARC audience code “${audience}” identifies juvenile material.`,
    });
  } else if (audience === 'e') {
    evidence.push({
      signal: 'marc_audience',
      value: audience,
      weight: -0.55,
      explanation: 'MARC audience code “e” identifies adult material.',
    });
  }
  if (input.juvenileHeading) {
    evidence.push({
      signal: 'juvenile_heading',
      value: 'true',
      weight: 0.7,
      explanation: 'A MARC subject heading explicitly marks the title as juvenile.',
    });
  }
  const juvenileGenre = input.genres?.find((genre) =>
    /juvenile|picture book|easy reader/iu.test(genre),
  );
  if (juvenileGenre) {
    evidence.push({
      signal: 'juvenile_genre',
      value: juvenileGenre,
      weight: 0.5,
      explanation: `Catalog genre “${juvenileGenre}” is child-oriented.`,
    });
  }
  if (/easy reader|picture book|board book/iu.test(input.sourceFormat ?? '')) {
    evidence.push({
      signal: 'source_format',
      value: input.sourceFormat ?? '',
      weight: 0.55,
      explanation: `Source format “${input.sourceFormat}” is strongly child-oriented.`,
    });
  }
  if (input.pageCount !== undefined && input.pageCount <= 48) {
    evidence.push({
      signal: 'short_length',
      value: String(input.pageCount),
      weight: 0.15,
      explanation: `${input.pageCount} pages is weak supporting evidence for a picture book.`,
    });
  }
  if (
    ['ebook', 'audiobook'].includes(input.sourceFormat?.toLowerCase() ?? '') &&
    evidence.length === 0
  ) {
    evidence.push({
      signal: 'digital_adult_prior',
      value: input.sourceFormat ?? '',
      weight: -0.65,
      explanation: 'This household’s digital history is adult-heavy and has no juvenile evidence.',
    });
  }
  const score = clamp(
    evidence.reduce((sum, item) => sum + item.weight, 0),
    -1,
    1,
  );
  let state: AttributionState = 'review';
  let readerIds: readonly string[] = [];
  if (score <= -0.5) state = 'excluded';
  else if (score >= 0.65 && input.candidateReaderIds.length === 1) {
    state = 'assigned';
    readerIds = input.candidateReaderIds;
  }
  const explanation =
    state === 'assigned'
      ? evidence
          .filter(({ weight }) => weight > 0)
          .map(({ explanation }) => explanation)
          .join(' ')
      : state === 'excluded'
        ? evidence
            .filter(({ weight }) => weight < 0)
            .map(({ explanation }) => explanation)
            .join(' ')
        : input.candidateReaderIds.length > 1 && score >= 0.65
          ? 'The title looks child-oriented, but the evidence cannot choose among multiple readers.'
          : evidence.length === 0
            ? 'No reliable attribution evidence is available.'
            : 'The available evidence is weak or conflicting, so a person should decide.';
  return {
    state,
    readerIds,
    confidence: Number(Math.abs(score).toFixed(4)),
    score: Number(score.toFixed(4)),
    explanation,
    evidence,
    algorithmVersion: 'attribution-v1',
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
