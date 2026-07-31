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
    <>
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">VTA</div>
          <div className="brand-name">Virtual Teaching Assistant</div>
        </div>
        <div className="identity">
          <span>{session.email}</span>
          <span className="badge">professor</span>
          <a className="link" href="/">
            ← Dashboard
          </a>
        </div>
      </header>

      <main className="container">
        <h1>Classroom discussion</h1>
        <p className="sub">
          Set a question, let each group put their view, and have the AI summarise the room. Students join by scanning a QR code — no account needed.
        </p>
        <NewDebateForm />
      </main>
    </>
  );
}
