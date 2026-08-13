export type RecurrenceKind = 'initial' | 'near_repeat' | 'strong_repeat';

export interface EpisodeThresholds {
  readonly mergeDays: number;
  readonly strongRepeatDays: number;
}

export interface AttributedCheckout {
  readonly importRecordId: string;
  readonly occurredAt: string;
}

export interface AcquisitionEpisodeDraft {
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly checkoutIds: readonly string[];
  readonly recurrenceKind: RecurrenceKind;
  readonly preferenceWeight: number;
}

export const DEFAULT_EPISODE_THRESHOLDS: EpisodeThresholds = {
  mergeDays: 7,
  strongRepeatDays: 90,
};

export function clusterAcquisitionEpisodes(
  checkouts: readonly AttributedCheckout[],
  thresholds: EpisodeThresholds = DEFAULT_EPISODE_THRESHOLDS,
): readonly AcquisitionEpisodeDraft[] {
  if (thresholds.mergeDays < 0 || thresholds.strongRepeatDays <= thresholds.mergeDays + 1) {
    throw new Error('Episode thresholds are invalid');
  }
  const sorted = [...checkouts].sort(
    (left, right) =>
      Date.parse(left.occurredAt) - Date.parse(right.occurredAt) ||
      left.importRecordId.localeCompare(right.importRecordId),
  );
  const episodes: { start: Date; end: Date; checkoutIds: string[] }[] = [];
  for (const checkout of sorted) {
    const occurred = validDate(checkout.occurredAt);
    const current = episodes.at(-1);
    if (current && daysBetween(current.end, occurred) <= thresholds.mergeDays) {
      current.end = occurred;
      current.checkoutIds.push(checkout.importRecordId);
    } else {
      episodes.push({ start: occurred, end: occurred, checkoutIds: [checkout.importRecordId] });
    }
  }
  return episodes.map((episode, index) => {
    const previous = episodes[index - 1];
    const gap = previous ? daysBetween(previous.end, episode.start) : undefined;
    const recurrenceKind: RecurrenceKind =
      gap === undefined
        ? 'initial'
        : gap >= thresholds.strongRepeatDays
          ? 'strong_repeat'
          : 'near_repeat';
    return {
      windowStart: episode.start.toISOString(),
      windowEnd: episode.end.toISOString(),
      checkoutIds: episode.checkoutIds,
      recurrenceKind,
      preferenceWeight: recurrenceKind === 'near_repeat' ? 0.6 : 1,
    };
  });
}

export function preferenceScore(
  episodes: readonly Pick<AcquisitionEpisodeDraft, 'preferenceWeight'>[],
  assessment?: {
    readonly childEngagement?: number;
    readonly asksByName?: boolean;
    readonly veto?: boolean;
  },
): number {
  if (assessment?.veto) return 0;
  const recurrence = episodes.reduce((sum, episode) => sum + episode.preferenceWeight, 0);
  const engagement =
    assessment?.childEngagement === undefined ? 1 : 0.5 + assessment.childEngagement / 6;
  return Number((recurrence * engagement + (assessment?.asksByName ? 1 : 0)).toFixed(4));
}

function daysBetween(left: Date, right: Date): number {
  return Math.floor((right.getTime() - left.getTime()) / 86_400_000);
}

function validDate(value: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid checkout date: ${value}`);
  return date;
}
