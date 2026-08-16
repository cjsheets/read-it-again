import { useState } from 'react';
import {
  isLibrarySource,
  type ReadingModelView,
  type ReadingTrait,
} from '@read-it-again/storage-schema';
import { useApp } from '../app-state.js';

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

/** ADR 0009 separates a library checkout from a book you simply added. These are
 *  the plain-language names for that distinction (F-13). */
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
  // role="group" rather than fieldset/legend: a <legend> cannot be laid out
  // reliably, and the float hack it forced was the 320px overflow (F-10).
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

export function AssessmentCard({ item }: { readonly item: ReadingModelView['shelf'][number] }) {
  const { applyReadingChange } = useApp();
  const [engagement, setEngagement] = useState<number | null>(item.childEngagement);
  const [tolerance, setTolerance] = useState<number | null>(item.adultTolerance);
  const [asks, setAsks] = useState(item.asksByName);
  const [veto, setVeto] = useState(item.veto);
  const [minutes, setMinutes] = useState(item.estimatedReadMinutes?.toString() ?? '');
  const [traits, setTraits] = useState<readonly ReadingTrait[]>(item.traits);
  const unrated = item.childEngagement === null && item.adultTolerance === null;
  const changed =
    engagement !== item.childEngagement ||
    tolerance !== item.adultTolerance ||
    asks !== item.asksByName ||
    veto !== item.veto ||
    minutes !== (item.estimatedReadMinutes?.toString() ?? '') ||
    traits.length !== item.traits.length ||
    traits.some((trait) => !item.traits.includes(trait));

  return (
    <article className="assessment-card" data-testid="shelf-card">
      <h3>{item.title}</h3>
      <p>
        {item.readerName} · {provenanceLabel(item.sourceKinds)}
      </p>
      <div className="quick-rating">
        <RatingButtons label="Child engagement" value={engagement} onChange={setEngagement} />
        <RatingButtons label="Adult tolerance" value={tolerance} onChange={setTolerance} />
      </div>
      {unrated && (
        <p className="rating-unset" data-testid="rating-unset">
          Not rated yet.
        </p>
      )}
      <div className="trait-chips">
        {TRAITS.map((trait) => (
          <button
            aria-pressed={traits.includes(trait.value)}
            type="button"
            key={trait.value}
            onClick={() =>
              setTraits(
                traits.includes(trait.value)
                  ? traits.filter((value) => value !== trait.value)
                  : [...traits, trait.value],
              )
            }
          >
            {trait.label}
          </button>
        ))}
      </div>
      <div className="assessment-options">
        <label>
          <input
            type="checkbox"
            checked={asks}
            onChange={(event) => setAsks(event.target.checked)}
          />{' '}
          Asked by name
        </label>
        <label>
          <input
            type="checkbox"
            checked={veto}
            onChange={(event) => setVeto(event.target.checked)}
          />{' '}
          Veto
        </label>
        <label>
          Minutes{' '}
          <input
            aria-label="Estimated read minutes"
            type="number"
            min="1"
            max="180"
            value={minutes}
            onChange={(event) => setMinutes(event.target.value)}
          />
        </label>
      </div>
      <div className="decision-actions">
        <button
          type="button"
          disabled={!changed}
          onClick={() =>
            void applyReadingChange({
              type: 'assessWork',
              workId: item.workId,
              personId: item.personId,
              childEngagement: engagement ?? undefined,
              adultTolerance: tolerance ?? undefined,
              asksByName: asks,
              veto,
              estimatedReadMinutes: minutes ? Number(minutes) : undefined,
              traits,
            })
          }
        >
          Save assessment
        </button>
        <button
          type="button"
          onClick={() =>
            void applyReadingChange({
              type: 'recordReadingSession',
              householdId: item.householdId,
              workId: item.workId,
              participantIds: [item.personId],
              durationMinutes: minutes ? Number(minutes) : undefined,
              context: 'bedtime',
            })
          }
        >
          Read tonight
        </button>
      </div>
    </article>
  );
}
