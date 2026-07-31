import { cookies } from 'next/headers';

import { SESSION_COOKIE, readSessionToken } from '@/lib/auth';
import { SignOutButton } from './sign-out-button';

// Session is per-request; never cache this page.
export const dynamic = 'force-dynamic';

/**
 * Everything still on the roadmap. Kept in one list so the dashboard reads as
 * "here is what's coming" rather than four broken-looking tiles — an unbuilt
 * feature should look planned, not failed.
 */
const ROADMAP = [
  { title: 'Connect Canvas', body: 'Authorize a course so the assistant can read its materials.' },
  { title: 'Course materials', body: 'Review ingested content and re-sync when Canvas changes.' },
  { title: 'Discord channels & staff', body: 'Provision the course space and manage TA roles.' },
  { title: 'Usage & analytics', body: 'Token spend, question volume, and the governed audit log.' },
];

export default async function DashboardHome() {
  const store = await cookies();
  const session = await readSessionToken(store.get(SESSION_COOKIE)?.value);
  const isProfessor = session !== null;

  return (
    <div className="shell">
      <header className="appbar">
        <a className="brand" href="/">
          <div className="brand-mark">VTA</div>
          <div className="brand-name">Virtual Teaching Assistant</div>
        </a>
        <div className="appbar-meta">
          {isProfessor ? (
            <>
              <span className="appbar-email">{session.email}</span>
              <span className="badge accent">Instructor</span>
              <SignOutButton />
            </>
          ) : (
            <>
              <span className="badge">Guest</span>
              <a className="btn sm" href="/login">
                Instructor sign-in
              </a>
            </>
          )}
        </div>
      </header>

      <main className="container">
        {isProfessor ? (
          <>
            <h1 className="t-display t-balance">Instructor dashboard</h1>
            <p className="t-body t-muted" style={{ marginTop: 8, maxWidth: '58ch' }}>
              Run a live classroom discussion, or manage the assistant that answers your students
              in Discord.
            </p>

            {/* The one thing that is actually built gets the weight. */}
            <section className="panel hero" style={{ marginTop: 28 }}>
              <div>
                <span className="badge ok">
                  <i className="dot" />
                  Ready
                </span>
                <h2 className="t-title" style={{ marginTop: 12 }}>
                  Classroom discussion
                </h2>
                <p className="t-small t-muted" style={{ marginTop: 8 }}>
                  Put a question to the room, split it into two to four groups, and let the AI read
                  back where they agree, where they differ, and what nobody raised.
                </p>
                <a className="btn primary lg" href="/debate" style={{ marginTop: 18 }}>
                  Start a discussion
                </a>
              </div>
              <ol className="steps">
                {[
                  'Name the question and the groups.',
                  'Put the rotating QR on the projector — students join with no account.',
                  'Everyone speaks; every turn is transcribed and attributed.',
                  'Ask the AI to read the room, as often as you like.',
                ].map((text, i) => (
                  <li className="step" key={text}>
                    <b>{i + 1}</b>
                    <span>{text}</span>
                  </li>
                ))}
              </ol>
            </section>

            <h2 className="t-eyebrow" style={{ marginTop: 40 }}>
              On the way
            </h2>
            <div className="grid two" style={{ marginTop: 12 }}>
              {ROADMAP.map((item) => (
                <div className="card muted" key={item.title}>
                  <h3>{item.title}</h3>
                  <p>{item.body}</p>
                  <span className="soon">Coming soon</span>
                </div>
              ))}
            </div>
          </>
        ) : (
          <>
            <h1 className="t-display t-balance">Ask your course assistant</h1>
            <p className="t-body t-muted" style={{ marginTop: 8, maxWidth: '56ch' }}>
              Grounded, cited answers drawn from your own course materials. No sign-in required.
            </p>

            <section className="panel" style={{ marginTop: 28 }}>
              <div className="panel-body" style={{ padding: 24 }}>
                <h2 className="t-title">Joining a class activity?</h2>
                <p className="t-small t-muted" style={{ marginTop: 6, maxWidth: '52ch' }}>
                  Scan the QR code your instructor is showing on screen. It changes every 30
                  seconds, so you need to be in the room — there is nothing to install and no
                  account to make.
                </p>
              </div>
            </section>

            <h2 className="t-eyebrow" style={{ marginTop: 40 }}>
              On the way
            </h2>
            <div className="grid" style={{ marginTop: 12 }}>
              {[
                { title: 'Ask a question', body: 'Grounded, cited answers from the course content.' },
                { title: 'Browse courses', body: 'See which courses have an assistant available.' },
                { title: 'History', body: 'Revisit the questions you asked in this session.' },
              ].map((item) => (
                <div className="card muted" key={item.title}>
                  <h3>{item.title}</h3>
                  <p>{item.body}</p>
                  <span className="soon">Coming soon</span>
                </div>
              ))}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
