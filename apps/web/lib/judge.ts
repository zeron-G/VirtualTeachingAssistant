/**
 * The AI judge.
 *
 * ADVISORY ONLY — the verdict is stored with `isFinal = false` and a professor
 * must confirm it. Nothing here writes a grade.
 *
 * Bias controls (LLM-judge position/verbosity/name bias is documented and
 * reproducible):
 *   - Speaker NAMES ARE STRIPPED before the transcript reaches the model; it
 *     sees only "RED-1 / BLUE-2" role labels.
 *   - The rubric bands are explicitly anchored, with band 3 = "meets
 *     expectations", to resist score compression/inflation.
 *   - Delivery is NOT scored: you cannot judge delivery from a transcript.
 */

import type { DebateTurnRow } from '@vta/data';
import { chat } from './openrouter';

export interface RubricCriterion {
  readonly id: string;
  readonly label: string;
  readonly weight: number;
  readonly description: string;
}

export const RUBRIC: RubricCriterion[] = [
  {
    id: 'ARG',
    label: 'Argumentation & reasoning',
    weight: 30,
    description: 'Claim → warrant → impact chains; logical validity; absence of fallacy.',
  },
  {
    id: 'EVI',
    label: 'Evidence & grounding',
    weight: 25,
    description: 'Specific, attributable support rather than assertion.',
  },
  {
    id: 'REF',
    label: 'Refutation & clash',
    weight: 25,
    description: 'Directly engages the other side’s strongest points.',
  },
  {
    id: 'ORG',
    label: 'Organization & role fulfilment',
    weight: 20,
    description: 'Clear structure; the speech does the job its slot requires.',
  },
];

export interface JudgeScores {
  readonly red: Record<string, number>;
  readonly blue: Record<string, number>;
  readonly redTotal: number;
  readonly blueTotal: number;
  readonly winner: 'red' | 'blue' | 'tie';
}

export interface JudgeVerdict {
  readonly scores: JudgeScores;
  readonly rationale: string;
  readonly model: string;
}

/**
 * Render the transcript with names replaced by role labels (RED-1, BLUE-2, …),
 * so the judge cannot be swayed by who said it.
 */
export function anonymizeTranscript(turns: readonly DebateTurnRow[]): string {
  const slots = new Map<string, string>();
  const counts: Record<string, number> = { red: 0, blue: 0, observer: 0 };
  const lines: string[] = [];
  for (const t of turns) {
    const key = `${t.team}:${t.speakerName}`;
    let slot = slots.get(key);
    if (slot === undefined) {
      const team = t.team === 'red' || t.team === 'blue' ? t.team : 'observer';
      counts[team] = (counts[team] ?? 0) + 1;
      slot = `${team.toUpperCase()}-${counts[team]}`;
      slots.set(key, slot);
    }
    lines.push(`[${t.phase}] ${slot}: ${t.text}`);
  }
  return lines.join('\n');
}

const SYSTEM = [
  'You are an impartial competitive-debate judge for a university classroom debate.',
  'You are given an anonymized transcript: speakers appear only as RED-n / BLUE-n role labels.',
  '',
  'Score EACH TEAM on each rubric criterion using a 0-5 band:',
  '  5 = outstanding · 4 = strong · 3 = MEETS EXPECTATIONS · 2 = developing · 1 = weak · 0 = absent',
  'Band 3 is the normal, competent classroom standard — use the full range and do not cluster.',
  '',
  'Rules you must follow:',
  '- Judge only what is in the transcript. Do not reward length; a longer speech is not a better one.',
  '- Do not score delivery, tone, or speaking style — a transcript cannot show them.',
  '- Ignore which side spoke first; order is an artifact of the format, not a merit.',
  '- If a team never engaged the other side, REF must be low regardless of how polished they were.',
  '',
  'Return STRICT JSON only, no prose outside it, in exactly this shape:',
  '{"red":{"ARG":n,"EVI":n,"REF":n,"ORG":n},"blue":{"ARG":n,"EVI":n,"REF":n,"ORG":n},',
  ' "winner":"red"|"blue"|"tie","rationale":"3-6 sentences citing specific moments, plus one concrete improvement for each side"}',
].join('\n');

/** Weighted 0-100 total from 0-5 band scores. */
function weightedTotal(bands: Record<string, number>): number {
  let total = 0;
  for (const c of RUBRIC) {
    const band = Math.max(0, Math.min(5, Number(bands[c.id] ?? 0)));
    total += (band / 5) * c.weight;
  }
  return Math.round(total * 10) / 10;
}

function extractJson(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced?.[1] ?? raw;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) throw new Error('judge returned no JSON object');
  return JSON.parse(body.slice(start, end + 1));
}

/** Run the judge over a session's transcript. Throws if the transcript is empty. */
export async function judgeDebate(
  topic: string,
  turns: readonly DebateTurnRow[],
): Promise<JudgeVerdict> {
  const spoken = turns.filter((t) => t.text.trim() !== '');
  if (spoken.length === 0) throw new Error('nothing has been said yet — no transcript to judge');

  const rubricText = RUBRIC.map((c) => `- ${c.id} (${c.label}, weight ${c.weight}): ${c.description}`).join('\n');
  const user = [
    `MOTION: ${topic}`,
    '',
    'RUBRIC:',
    rubricText,
    '',
    'TRANSCRIPT:',
    anonymizeTranscript(spoken),
  ].join('\n');

  const raw = await chat(SYSTEM, user, { maxTokens: 1600, role: 'debate.judge' });
  const parsed = extractJson(raw) as {
    red?: Record<string, number>;
    blue?: Record<string, number>;
    winner?: string;
    rationale?: string;
  };

  const red = parsed.red ?? {};
  const blue = parsed.blue ?? {};
  const redTotal = weightedTotal(red);
  const blueTotal = weightedTotal(blue);
  const declared = parsed.winner;
  const winner: 'red' | 'blue' | 'tie' =
    declared === 'red' || declared === 'blue' || declared === 'tie'
      ? declared
      : redTotal === blueTotal
        ? 'tie'
        : redTotal > blueTotal
          ? 'red'
          : 'blue';

  return {
    scores: { red, blue, redTotal, blueTotal, winner },
    rationale: parsed.rationale ?? '(no rationale returned)',
    model: 'anthropic/claude-opus-4.8',
  };
}
