'use client';

import { useEffect, useState } from 'react';
import type { CSSProperties, FormEvent } from 'react';

import { relativeTime } from '@/lib/format';

interface Course {
  id: string;
  slug: string;
  name: string;
}
interface SessionRow {
  id: string;
  topic: string;
  status: string;
  joinCode: string;
  createdAt: string;
}

/** Mirrors TEAM_PALETTE in @vta/data — that package pulls in the DB driver, so
 *  it cannot be imported into a client bundle. Positional, like the server ids. */
const PALETTE = ['#c0392b', '#1f6feb', '#1a7f37', '#b8860b'] as const;
const MAX_GROUPS = 4;

/** A couple of concrete examples beat an empty box for a first-time user. */
const EXAMPLES = [
  'Should universities require AI-literacy coursework?',
  'Is remote work better for early-career employees?',
  'Who should be liable when an autonomous vehicle crashes?',
];

export function NewDebateForm() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseId, setCourseId] = useState('');
  const [topic, setTopic] = useState('');
  const [teams, setTeams] = useState<string[]>(['For', 'Against']);
  const [recent, setRecent] = useState<SessionRow[]>([]);
  const [loadingCourses, setLoadingCourses] = useState(true);
  const [loadingRecent, setLoadingRecent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await fetch('/api/debate/courses');
      const data = (await res.json().catch(() => ({}))) as { courses?: Course[]; error?: string };
      if (data.courses !== undefined) {
        setCourses(data.courses);
        if (data.courses.length > 0 && data.courses[0] !== undefined) {
          setCourseId(data.courses[0].id);
        }
      } else {
        setError(data.error ?? 'Could not load courses.');
      }
      setLoadingCourses(false);
    })();
  }, []);

  useEffect(() => {
    if (courseId === '') return;
    setLoadingRecent(true);
    void (async () => {
      const res = await fetch(`/api/debate/sessions?courseId=${encodeURIComponent(courseId)}`);
      const data = (await res.json().catch(() => ({}))) as { sessions?: SessionRow[] };
      setRecent(data.sessions ?? []);
      setLoadingRecent(false);
    })();
  }, [courseId]);

  const named = teams.map((t) => t.trim()).filter((t) => t !== '');
  const duplicate = new Set(named.map((t) => t.toLowerCase())).size !== named.length;
  const canSubmit =
    !busy && courseId !== '' && topic.trim() !== '' && named.length >= 2 && !duplicate;

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch('/api/debate/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // Drop rows the professor added but left blank — the API rejects those.
      body: JSON.stringify({ courseId, topic, teams: named }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      session?: { id: string };
      error?: string;
    };
    if (res.ok && data.session !== undefined) {
      window.location.assign(`/debate/${data.session.id}`);
      return;
    }
    setBusy(false);
    setError(data.error ?? 'Could not create the activity.');
  }

  return (
    <div className="stack loose" style={{ marginTop: 30 }}>
      <section className="panel">
        <div className="panel-head">
          <h2>New discussion</h2>
        </div>
        <form onSubmit={create} className="panel-body stack">
          <div className="field">
            <label htmlFor="course">Course</label>
            <select
              id="course"
              value={courseId}
              disabled={loadingCourses}
              onChange={(e) => setCourseId(e.target.value)}
            >
              {courses.length === 0 && (
                <option value="">{loadingCourses ? 'Loading courses…' : 'No courses found'}</option>
              )}
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.slug})
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor="topic">The question</label>
            <input
              id="topic"
              type="text"
              placeholder="What should the room argue about?"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              required
            />
            {topic.trim() === '' && (
              <div className="example-chips">
                {EXAMPLES.map((ex) => (
                  <button key={ex} type="button" className="chip" onClick={() => setTopic(ex)}>
                    {ex}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="field">
            <label>Groups</label>
            <p className="field-hint">
              Two sides, or up to four perspectives. Students pick one when they join; anyone can
              also join as an observer.
            </p>
            <div className="stack tight" style={{ marginTop: 2 }}>
              {teams.map((t, i) => (
                <div className="row" key={i} style={{ gap: 8 }}>
                  <span className="swatch" style={{ '--group': PALETTE[i] } as CSSProperties} />
                  <input
                    type="text"
                    value={t}
                    maxLength={32}
                    placeholder={`Group ${i + 1}`}
                    aria-label={`Group ${i + 1} name`}
                    onChange={(e) =>
                      setTeams((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))
                    }
                  />
                  {teams.length > 2 && (
                    <button
                      type="button"
                      className="btn ghost sm"
                      onClick={() => setTeams((prev) => prev.filter((_, j) => j !== i))}
                      aria-label={`Remove group ${i + 1}`}
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}
            </div>
            {teams.length < MAX_GROUPS && (
              <button
                type="button"
                className="btn sm"
                style={{ alignSelf: 'flex-start', marginTop: 4 }}
                onClick={() => setTeams((prev) => [...prev, ''])}
              >
                + Add a group
              </button>
            )}
            {duplicate && (
              <p className="field-hint" style={{ color: 'var(--danger)' }}>
                Two groups have the same name.
              </p>
            )}
          </div>

          {error !== null && (
            <p className="banner error" role="alert">
              {error}
            </p>
          )}

          <button className="btn primary lg" type="submit" disabled={!canSubmit}>
            {busy ? 'Creating…' : 'Create & open console'}
          </button>
        </form>
      </section>

      <section className="panel">
        <div className="panel-head">
          <h2>Recent</h2>
          <span className="spacer" />
          {recent.length > 0 && <span className="t-small t-subtle">{recent.length}</span>}
        </div>
        <div className="panel-body flush">
          {loadingRecent ? (
            <div className="empty">
              <p>Loading…</p>
            </div>
          ) : recent.length === 0 ? (
            <div className="empty">
              <div className="empty-title">No discussions yet</div>
              <p>The ones you create will show up here so you can reopen the transcript later.</p>
            </div>
          ) : (
            <ul>
              {recent.map((s, i) => (
                <li key={s.id}>
                  {i > 0 && <hr className="divider" />}
                  <a
                    href={`/debate/${s.id}`}
                    className="row"
                    style={{
                      padding: '13px 18px',
                      gap: 12,
                      textDecoration: 'none',
                      color: 'inherit',
                    }}
                  >
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span
                        className="t-heading"
                        style={{
                          display: 'block',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {s.topic}
                      </span>
                      <span className="t-small t-subtle">{relativeTime(s.createdAt)}</span>
                    </span>
                    <span className={`badge ${s.status === 'ended' ? '' : 'ok'}`}>
                      {s.status !== 'ended' && <i className="dot" />}
                      {s.status}
                    </span>
                    <code className="t-small t-subtle">{s.joinCode}</code>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
