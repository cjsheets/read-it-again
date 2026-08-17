import {
  isLibrarySource,
  type ReadingModelView,
  type ReadingTrait,
} from '@read-it-again/storage-schema';

export const TRAITS: readonly { readonly value: ReadingTrait; readonly label: string }[] = [
  { value: 'rhyme_meter', label: 'Rhyme & meter' },
  { value: 'refrain_repetition', label: 'Refrain' },
  { value: 'interactive', label: 'Interactive' },
  { value: 'quiet_arc', label: 'Quiet arc' },
  { value: 'humor', label: 'Humor' },
  { value: 'vocabulary_stretch', label: 'Vocabulary' },
  { value: 'illustration_led', label: 'Illustration-led' },
];

const RATING_MEANINGS = ['no', 'a little', 'a lot', 'loved it'] as const;

/** Plain-language source names for the observation types in ADR 0009. */
const SOURCE_LABELS: Readonly<Record<string, string>> = {
  manual: 'Added by you',
  csv: 'Imported from a CSV file',
  libby: 'From your library history',
  bibliocommons: 'From your library history',
};

export function provenanceLabel(sourceKinds: readonly string[]): string {
  const labels = [...new Set(sourceKinds.map((kind) => SOURCE_LABELS[kind] ?? 'Imported'))];
  return labels.length === 0 ? 'On your shelf' : labels.join(' · ');
}

export function librarySourced(model: ReadingModelView) {
  const checkouts = model.checkouts.filter((checkout) => isLibrarySource(checkout.sourceKind));
  const workIds = new Set(checkouts.map((checkout) => checkout.workId));
  return { checkouts, episodes: model.episodes.filter((e) => workIds.has(e.workId)) };
}

export function RatingButtons({
  label,
  value,
  onChange,
}: {
  readonly label: string;
  readonly value: number | null;
  readonly onChange: (value: number) => void;
}) {
  // A group avoids the layout problems caused by fieldset and legend here.
  return (
    <div className="rating-row" role="group" aria-label={label}>
      <span className="rating-label">{label}</span>
      <div className="rating-buttons">
        {[0, 1, 2, 3].map((score) => (
          <button
            aria-label={`${label}: ${score} of 3 — ${RATING_MEANINGS[score]}`}
            aria-pressed={score === value}
            type="button"
            key={score}
            onClick={() => onChange(score)}
          >
            {score}
          </button>
        ))}
      </div>
    </div>
  );
}
