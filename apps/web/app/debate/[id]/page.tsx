import { cookies, headers } from 'next/headers';
import { redirect, notFound } from 'next/navigation';
import QRCode from 'qrcode';

import { SESSION_COOKIE, readSessionToken } from '@/lib/auth';
import { debateRepo } from '@/lib/db';
import { Console } from './console';

export const dynamic = 'force-dynamic';

export default async function DebateConsolePage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;

  const store = await cookies();
  const prof = await readSessionToken(store.get(SESSION_COOKIE)?.value);
  if (prof === null) redirect('/login');

  const snapshot = await debateRepo().snapshot(id);
  if (snapshot === undefined) notFound();

  // Build the absolute join URL from the incoming request so the QR works on
  // whatever hostname the app is actually served from.
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  const joinUrl = `${proto}://${host}/j/${snapshot.session.joinCode}`;
  const qrDataUrl = await QRCode.toDataURL(joinUrl, { width: 480, margin: 1 });

  return (
    <Console
      initial={JSON.parse(JSON.stringify(snapshot)) as never}
      joinUrl={joinUrl}
      qrDataUrl={qrDataUrl}
      professorEmail={prof.email}
    />
  );
}
