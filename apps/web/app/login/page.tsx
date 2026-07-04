'use client';

import { useState } from 'react';
import type { FormEvent } from 'react';

type Step = 'email' | 'code';

async function postJson(url: string, body: unknown): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string };
  return { ok: res.ok, error: data.error };
}

export default function LoginPage() {
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function requestCode(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { ok, error: err } = await postJson('/api/auth/request', { email });
    setBusy(false);
    if (ok) {
      setStep('code');
      setCode('');
    } else {
      setError(err ?? 'Something went wrong. Please try again.');
    }
  }

  async function verifyCode(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { ok, error: err } = await postJson('/api/auth/verify', { code });
    if (ok) {
      // Full navigation so the new session cookie is picked up by middleware.
      window.location.assign('/');
      return;
    }
    setBusy(false);
    setError(err ?? 'Something went wrong. Please try again.');
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="brand">
          <div className="brand-mark">VTA</div>
          <div className="brand-name">Virtual Teaching Assistant</div>
        </div>

        {step === 'email' ? (
          <form onSubmit={requestCode}>
            <h1>Sign in</h1>
            <p className="sub">Use your Johns Hopkins email to continue.</p>
            <label htmlFor="email">JHU email</label>
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
            <button className="primary" type="submit" disabled={busy || email.trim() === ''}>
              {busy ? 'Sending…' : 'Send verification code'}
            </button>
            {error !== null && <p className="error">{error}</p>}
            <p className="hint">Only @jhu.edu and @jh.edu addresses can access the dashboard.</p>
          </form>
        ) : (
          <form onSubmit={verifyCode}>
            <h1>Enter your code</h1>
            <p className="sub">
              We emailed a 6-digit code to <strong>{email}</strong>. It expires in 10 minutes.
            </p>
            <label htmlFor="code">Verification code</label>
            <input
              id="code"
              className="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]*"
              maxLength={6}
              placeholder="000000"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              required
              autoFocus
            />
            <button className="primary" type="submit" disabled={busy || code.length !== 6}>
              {busy ? 'Verifying…' : 'Verify & continue'}
            </button>
            {error !== null && <p className="error">{error}</p>}
            <button
              type="button"
              className="link"
              onClick={() => {
                setStep('email');
                setError(null);
              }}
            >
              ← Use a different email
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
