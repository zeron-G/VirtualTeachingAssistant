/**
 * Per-participant contribution review — INSTRUCTOR ONLY.
 *
 * WHAT THIS IS. A structured read of how each person took part in one
 * discussion: how much they said (measured), and how they said it (judged).
 * It exists so an instructor marking participation has something better than
 * memory and a vague impression of who was loud.
 *
 * WHAT IT IS NOT, and why the code enforces it:
 *
 *  - NOT a grade, and not a single overall number. Per-dimension bands only.
 *    Averaging four soft judgements of a twenty-minute transcript into one
 *    figure manufactures a precision that does not exist, and a single number
 *    is exactly the thing that gets pasted into a gradebook unexamined.
 *  - NOT a ranking. The model is forbidden from ordering students, and the
 *    console renders them in roster order, never sorted by band.
 *  - NOT visible to students. This never enters `DebateSnapshot`, because that
 *    snapshot goes out over an unauthenticated SSE stream to every phone in
 *    the room. It is fetched only by the professor-only route.
 *
 * MEASUREMENT BIAS, stated rather than hidden. The only evidence is speech
 * that a phone microphone captured and Whisper transcribed. That systematically
 * under-counts quiet speakers, non-native speakers, anyone with a poor
 * microphone, and anyone who contributed by listening and prompting others.
 * The model is told this, is forbidden from scoring delivery, fluency, accent
 * or grammar, and the UI repeats the caveat to the instructor.
 *
 * NAMES ARE STRIPPED before the transcript reaches the model — it sees S1, S2,
 * … and the mapping back to people happens locally. LLM name bias is
 * documented and reproducible; there is no reason to expose it here.
 */

import type { DebateParticipantRow, DebateTurnRow, DiscussionTeam } from '@vta/data';
import { DIMENSIONS } from './contributionTypes';
import type { ContributionReport, DimensionId, ParticipantReview } from './contributionTypes';
import { chat } from './openrouter';

export { BANDS, DIMENSIONS } from './contributionTypes';
export type { ContributionReport, DimensionId, ParticipantReview } from './contributionTypes';

const SYSTEM = [
  'You are helping a university instructor review PARTICIPATION in one classroom discussion.',
  'You are given an anonymized transcript. Speakers appear only as S1, S2, … with a group label.',
  '',
  'For each speaker, assign a band of 1-4 on each of three dimensions:',
  '  substance   — ideas, reasons and evidence, rather than bare assertion or repetition',
  '  engagement  — responds to, builds on, or fairly challenges what other people said',
  '  movement    — asks a good question, synthesises, concedes a point, reframes; unsticks things',
  '',
  'Band meanings (anchor to these; do not drift toward the middle):',
  '  1 Little evidence in this transcript   2 Emerging   3 Solid   4 Notable',
  '',
  'Also give each speaker:',
  '  evidence   — ONE specific thing they actually said or did, quoted or closely paraphrased',
  '  suggestion — ONE concrete thing that would make their next contribution stronger',
  '',
  'HARD RULES:',
  '- Do NOT rank the speakers, order them, or name a best or most valuable contributor.',
  '- Do NOT output any overall or averaged score for a person. Bands per dimension only.',
  '- Do NOT judge delivery, fluency, accent, grammar, vocabulary or confidence. You are reading a',
  '  speech-to-text transcript: those signals are not present and are not what is being assessed.',
  '- Talking MORE is not better. A short, precise contribution can be band 4; a long rambling one',
  '  can be band 2. Judge what was contributed, not how many words it took.',
  '- Band 1 means "little evidence IN THIS TRANSCRIPT", not "this is a weak student". Say so in',
  '  that wording when you use it.',
  '- Never speculate about a person beyond what the transcript shows.',
  '',
  'In roomNotes, comment on the SHAPE of the discussion (was the floor lopsided? did a point go',
  'unanswered? did anyone get talked over?) — about the room, not about individuals.',
  '',
  'Return STRICT JSON only, no prose outside it:',
  '{"speakers":[{"id":"S1","bands":{"substance":3,"engagement":2,"movement":3},',
  '  "evidence":"...","suggestion":"..."}],',
  ' "roomNotes":["..."],"summary":"2-4 sentences for the instructor"}',
].join('\n');

function extractJson(raw: string): unknown {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced?.[1] ?? raw;
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('the assistant returned no JSON object');
  }
  return JSON.parse(body.slice(start, end + 1));
}

function countWords(text: string): number {
  return text.trim() === '' ? 0 : text.trim().split(/\s+/).length;
}

/** Clamp a model-supplied band into 1-4, or drop it if it isn't a number. */
function band(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return undefined;
  return Math.min(4, Math.max(1, Math.round(n)));
}

/**
 * Review how each participant took part. Throws if nobody has spoken.
 *
 * Turns are matched to people by `participantId`. A turn whose participant row
 * was removed keeps its denormalized `speakerName` in the transcript but is not
 * attributed to anyone — better than silently crediting the wrong person.
 */
export async function assessContributions(
  topic: string,
  turns: readonly DebateTurnRow[],
  participants: readonly DebateParticipantRow[],
  teams: readonly DiscussionTeam[],
): Promise<ContributionReport> {
  const spoken = turns.filter((t) => t.text.trim() !== '');
  if (spoken.length === 0) {
    throw new Error('nobody has spoken yet — there is nothing to review');
  }

  const labelFor = (id: string): string =>
    teams.find((t) => t.id === id)?.label ?? (id === 'observer' ? 'Observer' : id);

  // Assign an anonymous code per participant, in order of first speaking.
  const codeOf = new Map<string, string>();
  for (const t of spoken) {
    if (t.participantId !== null && !codeOf.has(t.participantId)) {
      codeOf.set(t.participantId, `S${codeOf.size + 1}`);
    }
  }

  const lines = spoken.map((t) => {
    const code = t.participantId !== null ? (codeOf.get(t.participantId) ?? 'S?') : 'S?';
    return `${code} (${labelFor(t.team)}): ${t.text}`;
  });

  const roster = [...codeOf.entries()]
    .map(([pid, code]) => {
      const p = participants.find((x) => x.id === pid);
      return `- ${code}: ${labelFor(p?.team ?? 'observer')}`;
    })
    .join('\n');

  const user = [
    `QUESTION UNDER DISCUSSION: ${topic}`,
    '',
    'SPEAKERS:',
    roster,
    '',
    'TRANSCRIPT:',
    lines.join('\n'),
  ].join('\n');

  const raw = await chat(SYSTEM, user, { maxTokens: 3000, role: 'debate.contributions' });
  const parsed = extractJson(raw) as {
    speakers?: { id?: unknown; bands?: Record<string, unknown>; evidence?: unknown; suggestion?: unknown }[];
    roomNotes?: unknown;
    summary?: unknown;
  };
  const byCode = new Map(
    (parsed.speakers ?? []).map((s) => [String(s.id ?? '').trim().toUpperCase(), s]),
  );

  // Objective stats are computed here, never asked of the model.
  const totalWords = spoken.reduce((n, t) => n + countWords(t.text), 0);

  const reviews: ParticipantReview[] = [];
  const silent: ContributionReport['silent'] = [];

  for (const p of participants) {
    const mine = spoken.filter((t) => t.participantId === p.id);
    if (mine.length === 0) {
      silent.push({ participantId: p.id, displayName: p.displayName, team: p.team });
      continue;
    }
    const words = mine.reduce((n, t) => n + countWords(t.text), 0);
    const got = byCode.get(codeOf.get(p.id) ?? '');
    const bands: Partial<Record<DimensionId, number>> = {};
    for (const d of DIMENSIONS) {
      const b = band(got?.bands?.[d.id]);
      if (b !== undefined) bands[d.id] = b;
    }
    reviews.push({
      participantId: p.id,
      displayName: p.displayName,
      team: p.team,
      stats: {
        turns: mine.length,
        words,
        seconds: mine.reduce((n, t) => n + (t.durationSec ?? 0), 0),
        shareOfTalk: totalWords === 0 ? 0 : words / totalWords,
      },
      bands,
      evidence: String(got?.evidence ?? '').trim(),
      suggestion: String(got?.suggestion ?? '').trim(),
    });
  }

  const roomNotes = Array.isArray(parsed.roomNotes)
    ? parsed.roomNotes.map((x) => String(x ?? '').trim()).filter((x) => x !== '').slice(0, 5)
    : [];

  return {
    reviews,
    silent,
    roomNotes,
    summary: String(parsed.summary ?? '').trim() || '(no summary returned)',
    model: 'anthropic/claude-opus-4.8',
  };
}
