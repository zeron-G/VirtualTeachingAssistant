import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { SESSION_COOKIE, readSessionToken } from '@/lib/auth';
import { NewDebateForm } from './new-debate-form';

export const dynamic = 'force-dynamic';

export default async function DebateIndexPage() {
  const store = await cookies();
  const session = await readSessionToken(store.get(SESSION_COOKIE)?.value);
  if (session === null) redirect('/login');

  return (
    <div className="shell">
      <header className="appbar">
        <a className="brand" href="/">
          <div className="brand-mark">VTA</div>
          <div className="brand-name">Virtual Teaching Assistant</div>
        </a>
        <div className="appbar-meta">
          <span className="appbar-email">{session.email}</span>
          <a className="btn ghost sm" href="/">
            Dashboard
          </a>
        </div>
      </header>

      <main className="container">
        <h1 className="t-display t-balance">Classroom discussion</h1>
        <p className="t-body t-muted" style={{ marginTop: 8, maxWidth: '58ch' }}>
          Set a question, name the groups, and put the QR on screen. Every spoken turn is
          transcribed and attributed, and the AI summarises the room on demand.
        </p>
        <NewDebateForm />
      </main>
    </div>
  );
}
