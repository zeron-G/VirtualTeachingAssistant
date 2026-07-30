import { notFound } from 'next/navigation';

import { debateRepo } from '@/lib/db';
import { Room } from './room';

export const dynamic = 'force-dynamic';

/** Public student landing page for a join code — no login required. */
export default async function JoinPage(props: { params: Promise<{ code: string }> }) {
  const { code } = await props.params;
  const session = await debateRepo().getSessionByJoinCode(code);
  if (session === undefined) notFound();

  return (
    <Room
      code={session.joinCode}
      sessionId={session.id}
      topic={session.topic}
      ended={session.status === 'ended'}
    />
  );
}
