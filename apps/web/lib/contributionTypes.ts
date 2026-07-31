/**
 * Shapes and constants for the contribution review, shared by the server-side
 * assessor and the console UI.
 *
 * Kept apart from `contributions.ts` on purpose: that module imports the
 * OpenRouter client, and a client component importing it would drag the server
 * transport (and its API key handling) into the browser bundle.
 */

/** The three things worth judging in a discussion, none of them "talked a lot". */
export const DIMENSIONS = [
  {
    id: 'substance',
    label: 'Substance',
    blurb: 'Ideas, reasons and evidence, not just assertions.',
  },
  {
    id: 'engagement',
    label: 'Engagement with others',
    blurb: 'Responds to, builds on, or fairly challenges what others said.',
  },
  {
    id: 'movement',
    label: 'Moves it forward',
    blurb: 'Asks, synthesises, concedes, reframes — unsticks the conversation.',
  },
] as const;

export type DimensionId = (typeof DIMENSIONS)[number]['id'];

/** 1-4. No neutral midpoint, so "3" cannot be used to dodge a judgement. */
export const BANDS: Record<number, string> = {
  1: 'Little evidence',
  2: 'Emerging',
  3: 'Solid',
  4: 'Notable',
};

export interface ParticipantReview {
  readonly participantId: string;
  readonly displayName: string;
  readonly team: string;
  /** Counted from the transcript, not judged by the model. */
  readonly stats: {
    readonly turns: number;
    readonly words: number;
    readonly seconds: number;
    /** Share of all words spoken, 0-1. Context for the bands, not a score. */
    readonly shareOfTalk: number;
  };
  /** Band 1-4 per dimension. Absent when the model gave none. */
  readonly bands: Partial<Record<DimensionId, number>>;
  /** One thing they actually did, quoted or closely paraphrased. */
  readonly evidence: string;
  /** One concrete thing that would make their next contribution stronger. */
  readonly suggestion: string;
}

export interface ContributionReport {
  readonly reviews: ParticipantReview[];
  /** Joined but never spoke — the most actionable thing for an instructor. */
  readonly silent: { participantId: string; displayName: string; team: string }[];
  /** Whole-room observations: balance of the floor, points left unanswered. */
  readonly roomNotes: string[];
  readonly summary: string;
  readonly model: string;
}
