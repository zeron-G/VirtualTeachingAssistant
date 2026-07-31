'use client';

import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';

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

export function NewDebateForm() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [courseId, setCourseId] = useState('');
  const [topic, setTopic] = useState('');
  const [teams, setTeams] = useState<string[]>(['For', 'Against']);
  const [recent, setRecent] = useState<SessionRow[]>([]);
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
    })();
  }, []);

  useEffect(() => {
    if (courseId === '') return;
    void (async () => {
      const res = await fetch(`/api/debate/sessions?courseId=${encodeURIComponent(courseId)}`);
      const data = (await res.json().catch(() => ({}))) as { sessions?: SessionRow[] };
      setRecent(data.sessions ?? []);
    })();
  }, [courseId]);

  async function create(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch('/api/debate/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ courseId, topic, teams }),
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
    <>
      <section className="card" style={{ marginTop: 20 }}>
        <h3>New discussion</h3>
        <form onSubmit={create} style={{ marginTop: 12 }}>
          <label htmlFor="course">Course</label>
          <select
            id="course"
            value={courseId}
            onChange={(e) => setCourseId(e.target.value)}
            style={{
              width: '100%',
              padding: '11px 13px',
              borderRadius: 10,
              border: '1px solid var(--border)',
              background: 'var(--bg)',
              color: 'var(--text)',
              fontSize: 15,
            }}
          >
            {courses.length === 0 && <option value="">(no courses found)</option>}
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.slug})
              </option>
            ))}
          </select>

          <div style={{ height: 14 }} />

          <label htmlFor="topic">Question / topic</label>
          <input
            id="topic"
            type="text"
            placeholder="Should AI be regulated by an independent agency?"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            required
          />

          <div style={{ height: 14 }} />
          <label>Groups ({teams.length})</label>
          <p className="sub" style={{ margin: '0 0 8px', fontSize: 13 }}>
            Two sides, or up to four perspectives. Students pick one when they join.
          </p>
          {teams.map((t, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
              <span
                style={{
                  width: 10,
                  borderRadius: 4,
                  background: ['#c0392b', '#1f6feb', '#1a7f37', '#b8860b'][i],
                  flexShrink: 0,
                }}
              />
              <input
                type="text"
                value={t}
                maxLength={32}
                placeholder={`Group ${i + 1}`}
                onChange={(e) =>
                  setTeams((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))
                }
              />
              {teams.length > 2 && (
                <button
                  type="button"
                  className="link"
                  onClick={() => setTeams((prev) => prev.filter((_, j) => j !== i))}
                >
                  Remove
                </button>
              )}
            </div>
          ))}
          {teams.length < 4 && (
            <button
              type="button"
              className="link"
              onClick={() => setTeams((prev) => [...prev, ''])}
            >
              + Add a group
            </button>
          )}

          <button
            className="primary"
            type="submit"
            disabled={
              busy ||
              courseId === '' ||
              topic.trim() === '' ||
              teams.filter((t) => t.trim() !== '').length < 2
            }
          >
            {busy ? 'Creating…' : 'Create & open console'}
          </button>
          {error !== null && <p className="error">{error}</p>}
        </form>
      </section>

      {recent.length > 0 && (
        <section className="card" style={{ marginTop: 16 }}>
          <h3>Recent</h3>
          <div style={{ marginTop: 10 }}>
            {recent.map((s) => (
              <div
                key={s.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 12,
                  padding: '8px 0',
                  borderBottom: '1px solid var(--border)',
                }}
              >
                <a href={`/debate/${s.id}`} style={{ flex: 1 }}>
                  {s.topic}
                </a>
                <span className="badge">{s.status}</span>
                <code>{s.joinCode}</code>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
