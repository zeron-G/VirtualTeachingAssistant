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
      body: JSON.stringify({ courseId, topic }),
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
        <h3>New debate</h3>
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

          <label htmlFor="topic">Motion</label>
          <input
            id="topic"
            type="text"
            placeholder="This house believes that AI should be regulated by an independent agency."
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            required
          />

          <button className="primary" type="submit" disabled={busy || courseId === '' || topic.trim() === ''}>
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
