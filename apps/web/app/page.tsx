import { cookies } from 'next/headers';

import { SESSION_COOKIE, readSessionToken } from '@/lib/auth';
import { SignOutButton } from './sign-out-button';

// Session is per-request; never cache this page.
export const dynamic = 'force-dynamic';

export default async function DashboardHome() {
  const store = await cookies();
  const session = await readSessionToken(store.get(SESSION_COOKIE)?.value);
  const isProfessor = session !== null;

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">VTA</div>
          <div className="brand-name">Virtual Teaching Assistant</div>
        </div>
        <div className="identity">
          {isProfessor ? (
            <>
              <span>{session.email}</span>
              <span className="badge">professor</span>
              <SignOutButton />
            </>
          ) : (
            <>
              <span className="badge">guest</span>
              <a className="link" href="/login">
                Instructor sign-in →
              </a>
            </>
          )}
        </div>
      </header>

      <main className="container">
        {isProfessor ? (
          <>
            <h1>Instructor dashboard</h1>
            <p className="sub">
              Manage your courses, materials, and the assistant that answers your students.
            </p>
            <div className="grid">
              <section className="card">
                <h3>Classroom debate</h3>
                <p>Run a red vs blue debate. Students join by QR — no account needed.</p>
                <a className="link" href="/debate" style={{ display: 'inline-block', marginTop: 12 }}>
                  Open →
                </a>
              </section>
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
          </>
        ) : (
          <>
            <h1>Ask your course assistant</h1>
            <p className="sub">
              Get grounded, cited answers from your course materials. No sign-in required.
            </p>
            <div className="grid">
              <section className="card">
                <h3>Ask a question</h3>
                <p>Grounded, cited answers drawn from the course content.</p>
                <span className="soon">Coming soon</span>
              </section>
              <section className="card">
                <h3>Browse courses</h3>
                <p>See which courses have an assistant available.</p>
                <span className="soon">Coming soon</span>
              </section>
              <section className="card">
                <h3>History</h3>
                <p>Revisit questions you&apos;ve asked in this session.</p>
                <span className="soon">Coming soon</span>
              </section>
            </div>
          </>
        )}
      </main>
    </>
  );
}
