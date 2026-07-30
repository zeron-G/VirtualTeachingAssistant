import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';

import { debateRepo } from '@/lib/db';
import { PARTICIPANT_COOKIE, readParticipantToken } from '@/lib/participant';
import { Room } from './room';

export const dynamic = 'force-dynamic';

/** Public student landing page for a join code — no login required. */
export default async function JoinPage(props: { params: Promise<{ code: string }> }) {
  const { code } = await props.params;
  const repo = debateRepo();
  const session = await repo.getSessionByJoinCode(code);
  if (session === undefined) notFound();

  // Resume an existing seat: a refresh, a backgrounded tab, or a phone waking
  // from sleep must land back in the room, not on the join form (where the
  // student could also silently change team mid-debate).
  let resumeParticipantId: string | null = null;
  const store = await cookies();
  const claims = await readParticipantToken(store.get(PARTICIPANT_COOKIE)?.value);
  if (claims !== null && claims.sessionId === session.id) {
    const existing = await repo.findParticipantByDevice(session.id, claims.deviceId);
    if (existing !== undefined) resumeParticipantId = existing.id;
  }

  return (
    <Room
      code={session.joinCode}
      sessionId={session.id}
      topic={session.topic}
      ended={session.status === 'ended'}
      resumeParticipantId={resumeParticipantId}
    />
  );
}
