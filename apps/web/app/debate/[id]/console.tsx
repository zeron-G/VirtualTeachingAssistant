'use client';

import { useCallback, useEffect, useState } from 'react';
import { useDebateStream } from '@/lib/useDebateStream';
import type { Snapshot } from '@/lib/useDebateStream';

/** Suggested running order for the red/blue format. The professor can free-type too. */
const PHASES = [
  'Lobby',
  'Opening — Red',
  'Opening — Blue',
  'Rebuttal — Red',
  'Rebuttal — Blue',
  'Open clash',
  'Closing — Red',
  'Closing — Blue',
  'Judging',
];

export function Console({
  initial,
  joinUrl,
  qrDataUrl,
  professorEmail,
}: {
  initial: Snapshot;
  joinUrl: string;
  qrDataUrl: string;
  professorEmail: string;
}) {
  const streamed = useDebateStream(initial.session.id, initial);
  /**
   * The POST /state response is authoritative and arrives BEFORE the SSE frame.
   * Track its phaseSeq locally: relying on SSE alone means a second click sends
   * a stale seq, the compare-and-set matches no row, and every later action is
   * wedged into a permanent 409.
   */
  const [localSeq, setLocalSeq] = useState<number | null>(null);
  const snapshot = streamed;
  const { participants, turns, judgement } = snapshot;
  const session = snapshot.session;
  const effectiveSeq = Math.max(session.phaseSeq, localSeq ?? -1);

  const [busy, setBusy] = useState(false);
  const [judging, setJudging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showQr, setShowQr] = useState(true);

  const patch = useCallback(
    async (body: Record<string, unknown>) => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch(`/api/debate/sessions/${session.id}/state`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...body, phaseSeq: effectiveSeq }),
        });
        const d = (await res.json().catch(() => ({}))) as {
          error?: string;
          session?: { phaseSeq: number };
        };
        if (!res.ok) setError(d.error ?? 'That did not work.');
        else if (d.session !== undefined) setLocalSeq(d.session.phaseSeq);
      } catch {
        setError('Network problem — check your connection and try again.');
      } finally {
        setBusy(false);
      }
    },
    [session.id, effectiveSeq],
  );

  async function runJudge() {
    setJudging(true);
    setError(null);
    try {
      const res = await fetch(`/api/debate/sessions/${session.id}/judge`, { method: 'POST' });
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        setError(d.error ?? 'The judge could not run.');
      }
    } catch {
      setError('Network problem running the judge.');
    } finally {
      setJudging(false);
    }
  }

  async function confirmJudge(judgementId: string) {
    await fetch(`/api/debate/sessions/${session.id}/judge`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ judgementId }),
    });
  }

  const red = participants.filter((p) => p.team === 'red');
  const blue = participants.filter((p) => p.team === 'blue');
  const others = participants.filter((p) => p.team !== 'red' && p.team !== 'blue');
  const scores = judgement?.scores as
    | { redTotal?: number; blueTotal?: number; winner?: string }
    | undefined;

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">VTA</div>
          <div className="brand-name">Debate console</div>
        </div>
        <div className="identity">
          <span>{professorEmail}</span>
          <span className="badge">{session.status}</span>
          <a className="link" href="/debate">
            ← All debates
          </a>
        </div>
      </header>

      <main className="container" style={{ maxWidth: 1100 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start' }}>
          <div>
            <h1 style={{ marginBottom: 4 }}>{session.topic}</h1>
            <p className="sub">
              Phase: <strong>{session.phase}</strong> · {participants.length} joined ·{' '}
              {turns.length} turns
            </p>
          </div>
          {session.status !== 'ended' && (
            <button
              type="button"
              className="link"
              disabled={busy}
              onClick={() => {
                if (window.confirm('End this debate? Students will no longer be able to speak.')) {
                  void patch({ endNow: true });
                }
              }}
              style={{ whiteSpace: 'nowrap' }}
            >
              End debate
            </button>
          )}
        </div>
        {error !== null && <p className="error">{error}</p>}

        {/* ---- Join panel ---- */}
        <section className="card" style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0 }}>Join</h3>
            <button className="link" type="button" onClick={() => setShowQr((v) => !v)}>
              {showQr ? 'Hide' : 'Show'} QR
            </button>
          </div>
          {showQr && (
            <div style={{ display: 'flex', gap: 24, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrDataUrl} alt="Join QR code" width={200} height={200} />
              <div>
                <div style={{ fontSize: 13, color: 'var(--muted)' }}>Code</div>
                <div style={{ fontSize: 44, fontWeight: 800, letterSpacing: 6 }}>
                  {session.joinCode}
                </div>
                <div style={{ fontSize: 14, marginTop: 6 }}>{joinUrl}</div>
              </div>
            </div>
          )}
        </section>

        {/* ---- Phase control ---- */}
        <section className="card" style={{ marginTop: 16 }}>
          <h3>Phase</h3>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
            {PHASES.map((p) => (
              <button
                key={p}
                type="button"
                disabled={busy}
                onClick={() =>
                  void patch({
                    phase: p,
                    status: p === 'Lobby' ? 'lobby' : p === 'Judging' ? 'judging' : 'live',
                  })
                }
                className="link"
                style={{
                  padding: '7px 12px',
                  borderRadius: 999,
                  border: '1px solid var(--border)',
                  background: session.phase === p ? 'var(--hopkins)' : 'transparent',
                  color: session.phase === p ? '#fff' : 'var(--text)',
                  fontWeight: 600,
                }}
              >
                {p}
              </button>
            ))}
          </div>
        </section>

        {/* ---- Floor control ---- */}
        <section className="card" style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0 }}>Who has the microphone</h3>
            <button
              type="button"
              className="link"
              disabled={busy || session.floorParticipantId === null}
              onClick={() => void patch({ floorParticipantId: null })}
            >
              Close the floor
            </button>
          </div>
          <p className="sub" style={{ marginTop: 6 }}>
            Only the person holding the floor can record. Everyone else&apos;s mic stays off.
          </p>
          {(
            [
              ['Red (proposition)', red, '#c0392b'],
              ['Blue (opposition)', blue, '#1f6feb'],
              ['Observers', others, 'var(--muted)'],
            ] as const
          ).map(([label, list, color]) => (
            <div key={label} style={{ marginTop: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color }}>{label}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
                {list.length === 0 && <span className="sub">nobody yet</span>}
                {list.map((p) => {
                  const holds = session.floorParticipantId === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      disabled={busy}
                      onClick={() => void patch({ floorParticipantId: holds ? null : p.id })}
                      style={{
                        padding: '7px 12px',
                        borderRadius: 999,
                        border: `1px solid ${holds ? '#1a7f37' : 'var(--border)'}`,
                        background: holds ? '#1a7f37' : 'var(--bg)',
                        color: holds ? '#fff' : 'var(--text)',
                        cursor: 'pointer',
                        fontWeight: 600,
                      }}
                    >
                      {holds ? '🎤 ' : ''}
                      {p.displayName}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </section>

        {/* ---- Transcript ---- */}
        <section className="card" style={{ marginTop: 16 }}>
          <h3>Live transcript</h3>
          {turns.length === 0 && <p className="sub">Nothing spoken yet.</p>}
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {turns.map((t) => (
              <div key={t.id}>
                <span
                  style={{
                    fontWeight: 700,
                    color: t.team === 'red' ? '#c0392b' : t.team === 'blue' ? '#1f6feb' : 'var(--muted)',
                  }}
                >
                  {t.speakerName}
                </span>
                <span className="sub" style={{ fontSize: 12 }}>
                  {' '}
                  · {t.phase}
                </span>
                <div>{t.text}</div>
              </div>
            ))}
          </div>
        </section>

        {/* ---- Judge ---- */}
        <section className="card" style={{ marginTop: 16, marginBottom: 40 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0 }}>AI judge</h3>
            <button className="link" type="button" disabled={judging} onClick={() => void runJudge()}>
              {judging ? 'Working…' : 'Run judge'}
            </button>
          </div>
          <p className="sub" style={{ marginTop: 6 }}>
            Advisory only — names are hidden from the judge, and you confirm the result.
          </p>
          {judgement !== undefined && (
            <div style={{ marginTop: 12 }}>
              <div style={{ fontSize: 18, fontWeight: 700 }}>
                Red {scores?.redTotal ?? '?'} — {scores?.blueTotal ?? '?'} Blue{' '}
                <span className="badge">{scores?.winner ?? '?'}</span>{' '}
                {judgement.isFinal ? (
                  <span className="badge">confirmed</span>
                ) : (
                  <button
                    type="button"
                    className="link"
                    onClick={() => void confirmJudge(judgement.id)}
                  >
                    Confirm
                  </button>
                )}
              </div>
              <p style={{ marginTop: 8 }}>{judgement.rationale}</p>
            </div>
          )}
        </section>
      </main>
    </>
  );
}
