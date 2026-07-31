'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (res.ok) {
      window.location.assign('/');
      return;
    }
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    setError(data.error ?? 'Something went wrong. Please try again.');
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="brand">
          <div className="brand-mark">VTA</div>
          <div className="brand-name">Virtual Teaching Assistant</div>
        </div>

        <h1 className="t-title">Instructor sign-in</h1>
        <p className="t-small t-muted" style={{ marginTop: 4 }}>
          For course staff. Students never need an account.
        </p>

        <form onSubmit={submit} className="stack" style={{ marginTop: 22 }}>
          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="name@jhu.edu"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
          </div>

          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          {error !== null && (
            <p className="banner error" role="alert">
              {error}
            </p>
          )}

          <button
            className="btn primary lg block"
            type="submit"
            disabled={busy || email === '' || password === ''}
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <hr className="divider" style={{ margin: '22px 0 16px' }} />

        <a className="t-small" href="/">
          ← Continue as a student
        </a>
      </div>
    </div>
  );
}
