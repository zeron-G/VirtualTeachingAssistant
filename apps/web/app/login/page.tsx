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

        <form onSubmit={submit}>
          <h1>Instructor sign-in</h1>
          <p className="sub">For course staff. Students don&apos;t need to sign in.</p>

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

          <div style={{ height: 14 }} />

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

          <button className="primary" type="submit" disabled={busy || email === '' || password === ''}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
          {error !== null && <p className="error">{error}</p>}
        </form>

        <a className="hint" href="/" style={{ display: 'inline-block' }}>
          ← Continue as a student
        </a>
      </div>
    </div>
  );
}
