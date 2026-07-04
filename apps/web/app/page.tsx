import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { SESSION_COOKIE, readSessionToken } from '@/lib/auth';
import { SignOutButton } from './sign-out-button';

// Session is per-request; never cache this page.
export const dynamic = 'force-dynamic';

export default async function DashboardHome() {
  const store = await cookies();
  const session = await readSessionToken(store.get(SESSION_COOKIE)?.value);

  // Middleware already gates this, but guard so we never render without a session.
  if (session === null) redirect('/login');

  const isProfessor = session.role === 'professor';

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">VTA</div>
          <div className="brand-name">Virtual Teaching Assistant</div>
        </div>
        <div className="identity">
          <span>{session.email}</span>
          <span className="badge">{session.role}</span>
          <SignOutButton />
        </div>
      </header>

      <main className="container">
        <h1>{isProfessor ? 'Instructor dashboard' : 'Student dashboard'}</h1>
        <p className="sub">
          {isProfessor
            ? 'Manage your courses, materials, and the assistant that answers your students.'
            : 'Ask questions about your courses and review your history.'}
        </p>

        {isProfessor ? (
          <div className="grid">
            <section className="card">
              <h3>Connect Canvas</h3>
              <p>Authorize a course so the assistant can read its materials.</p>
              <span className="soon">Coming soon</span>
            </section>
            <section className="card">
              <h3>Course materials</h3>
              <p>Review ingested content and re-sync when Canvas changes.</p>
              <span className="soon">Coming soon</span>
            </section>
            <section className="card">
              <h3>Discord channels &amp; staff</h3>
              <p>Provision the course space and manage TA/instructor roles.</p>
              <span className="soon">Coming soon</span>
            </section>
            <section className="card">
              <h3>Usage &amp; analytics</h3>
              <p>Token usage, question volume, and the governed audit log.</p>
              <span className="soon">Coming soon</span>
            </section>
          </div>
        ) : (
          <div className="grid">
            <section className="card">
              <h3>Your courses</h3>
              <p>The courses you&apos;re enrolled in will appear here.</p>
              <span className="soon">Coming soon</span>
            </section>
            <section className="card">
              <h3>Ask a question</h3>
              <p>Get grounded, cited answers from your course materials.</p>
              <span className="soon">Coming soon</span>
            </section>
            <section className="card">
              <h3>History</h3>
              <p>Revisit your previous questions and the answers you received.</p>
              <span className="soon">Coming soon</span>
            </section>
          </div>
        )}
      </main>
    </>
  );
}
