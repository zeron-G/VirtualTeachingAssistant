/**
 * The AI discussion assistant.
 *
 * This activity is a CLASSROOM DISCUSSION, not a competitive debate: two to four
 * groups put forward their views on a question. The AI's job is therefore to
 * help the conversation — summarise where each group stands, surface real
 * agreement and disagreement, and point at what nobody has said yet — NOT to
 * declare a winner or score students.
 *
 * Bias control retained from the earlier design: speaker NAMES ARE STRIPPED
 * before the transcript reaches the model; it sees only group labels, so its
 * read of an argument can't be coloured by who made it.
 */

import type { DebateTurnRow, DiscussionTeam } from '@vta/data';
import { chat } from './openrouter';

export interface TeamInsight {
  readonly teamId: string;
  readonly label: string;
  /** The group's main claims, in the AI's words. */
  readonly points: string[];
  /** One concrete, constructive suggestion for that group. */
  readonly suggestion: string;
}

export interface DiscussionInsight {
  readonly teams: TeamInsight[];
  readonly agreements: string[];
  readonly disagreements: string[];
  /** Angles nobody raised — the most useful thing an AI adds to a discussion. */
  readonly gaps: string[];
  /** A question the professor could put to the room next. */
  readonly nextQuestion: string;
}

export interface AssistantResult {
  readonly insight: DiscussionInsight;
  readonly summary: string;
  readonly model: string;
}

/** Group turns by team, with names replaced by group labels. */
export function anonymizeTranscript(
  turns: readonly DebateTurnRow[],
  teams: readonly DiscussionTeam[],
): string {
  const labelFor = (id: string): string =>
    teams.find((t) => t.id === id)?.label ?? (id === 'observer' ? 'Unaligned' : id);
  const seats = new Map<string, string>();
  const counts: Record<string, number> = {};
  const lines: string[] = [];
  for (const t of turns) {
    const key = `${t.team}:${t.speakerName}`;
    let seat = seats.get(key);
    if (seat === undefined) {
      counts[t.team] = (counts[t.team] ?? 0) + 1;
      seat = `${labelFor(t.team)} #${counts[t.team]}`;
      seats.set(key, seat);
    }
    lines.push(`${seat}: ${t.text}`);
  }
  return lines.join('\n');
}

const SYSTEM = [
  'You are helping a university instructor run a CLASSROOM DISCUSSION.',
  'Several groups have been putting forward their views on a question. You are given an',
  'anonymized transcript: speakers appear only as their group label and a number.',
  '',
  'Your job is to help the conversation, NOT to judge it. Specifically:',
  '- Summarise what each group actually argued, in plain language, faithful to what they said.',
  '- Identify genuine points of AGREEMENT across groups (often more than participants realise).',
  '- Identify the real DISAGREEMENTS — the crux, not superficial wording differences.',
  '- Name important angles, evidence, or consequences that NOBODY raised. This is the most',
  '  valuable thing you can add; be specific and substantive, not generic.',
  '- Offer each group ONE constructive, actionable suggestion to strengthen their thinking.',
  '- Propose ONE good question the instructor could put to the room next.',
  '',
  'Rules:',
  '- Do NOT declare a winner, rank the groups, or assign any score. This is not a competition.',
  '- Be encouraging and specific. Quote or paraphrase real moments from the transcript.',
  '- If a group barely spoke, say so plainly rather than inventing a position for them.',
  '',
  'Return STRICT JSON only, no prose outside it:',
  '{"teams":[{"teamId":"<id>","points":["..."],"suggestion":"..."}],',
  ' "agreements":["..."],"disagreements":["..."],"gaps":["..."],',
  ' "nextQuestion":"...","summary":"2-4 sentences an instructor could read aloud"}',
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

function strings(v: unknown, max = 6): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x ?? '').trim()).filter((x) => x !== '').slice(0, max);
}

/** Analyse the discussion so far. Throws if nothing has been said. */
export async function analyzeDiscussion(
  topic: string,
  turns: readonly DebateTurnRow[],
  teams: readonly DiscussionTeam[],
): Promise<AssistantResult> {
  const spoken = turns.filter((t) => t.text.trim() !== '');
  if (spoken.length === 0) {
    throw new Error('nothing has been said yet — there is no discussion to summarise');
  }

  const roster = teams.map((t) => `- ${t.id}: ${t.label}`).join('\n');
  const user = [
    `QUESTION UNDER DISCUSSION: ${topic}`,
    '',
    'GROUPS:',
    roster,
    '',
    'TRANSCRIPT:',
    anonymizeTranscript(spoken, teams),
  ].join('\n');

  const raw = await chat(SYSTEM, user, { maxTokens: 2000, role: 'debate.assistant' });
  const parsed = extractJson(raw) as {
    teams?: { teamId?: string; points?: unknown; suggestion?: unknown }[];
    agreements?: unknown;
    disagreements?: unknown;
    gaps?: unknown;
    nextQuestion?: unknown;
    summary?: unknown;
  };

  const byId = new Map((parsed.teams ?? []).map((t) => [String(t.teamId ?? ''), t]));
  const teamInsights: TeamInsight[] = teams.map((t) => {
    const got = byId.get(t.id);
    return {
      teamId: t.id,
      label: t.label,
      points: strings(got?.points),
      suggestion: String(got?.suggestion ?? '').trim(),
    };
  });

  return {
    insight: {
      teams: teamInsights,
      agreements: strings(parsed.agreements),
      disagreements: strings(parsed.disagreements),
      gaps: strings(parsed.gaps),
      nextQuestion: String(parsed.nextQuestion ?? '').trim(),
    },
    summary: String(parsed.summary ?? '').trim() || '(no summary returned)',
    model: 'anthropic/claude-opus-4.8',
  };
}
