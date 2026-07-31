'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useDebateStream } from '@/lib/useDebateStream';
import type { Snapshot } from '@/lib/useDebateStream';

const OBSERVER = { id: 'observer', label: 'Unaligned', color: '#5b6672' };

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

  // The QR is a ROTATING check-in ticket: it re-mints every 30s so a photo taken
  // earlier stops working. Students must scan it live to join.
  const [qr, setQr] = useState(qrDataUrl);
  const [rotatesIn, setRotatesIn] = useState(30);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let stopped = false;
    const refresh = async (): Promise<void> => {
      if (stopped) return;
      try {
        const res = await fetch(`/api/debate/sessions/${session.id}/ticket`);
        if (res.ok) {
          const d = (await res.json()) as { qrDataUrl?: string; rotateInSeconds?: number };
          if (!stopped && d.qrDataUrl !== undefined) {
            setQr(d.qrDataUrl);
            setRotatesIn(d.rotateInSeconds ?? 30);
          }
        }
      } catch {
        /* keep showing the previous QR; try again on the next tick */
      }
      if (!stopped) timerRef.current = setTimeout(() => void refresh(), 15_000);
    };
    void refresh();
    return () => {
      stopped = true;
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, [session.id]);

  // Visible countdown so the room can see the code is live.
  useEffect(() => {
    const t = setInterval(() => setRotatesIn((s) => (s <= 1 ? 30 : s - 1)), 1000);
    return () => clearInterval(t);
  }, []);

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

  const teams = session.teams ?? [];
  const teamIds = new Set(teams.map((t) => t.id));
  /** Every configured group, plus an Unaligned bucket when anyone is in it. */
  const groups = [
    ...teams.map((t) => ({ ...t, members: participants.filter((p) => p.team === t.id) })),
    {
      ...OBSERVER,
      members: participants.filter((p) => !teamIds.has(p.team)),
    },
  ].filter((g) => g.id !== 'observer' || g.members.length > 0);
  const colorOf = (id: string): string =>
    teams.find((t) => t.id === id)?.color ?? OBSERVER.color;
  const insight = judgement?.scores as
    | {
        teams?: { teamId: string; label: string; points: string[]; suggestion: string }[];
        agreements?: string[];
        disagreements?: string[];
        gaps?: string[];
        nextQuestion?: string;
      }
    | undefined;

  return (
    <>
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">VTA</div>
          <div className="brand-name">Discussion console</div>
        </div>
        <div className="identity">
          <span>{professorEmail}</span>
          <span className="badge">{session.status}</span>
          <a className="link" href="/debate">
            ← All discussions
          </a>
        </div>
      </header>

      <main className="container" style={{ maxWidth: 1100 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start' }}>
          <div>
            <h1 style={{ marginBottom: 4 }}>{session.topic}</h1>
            <p className="sub">
              {participants.length} joined · {turns.length} contributions
            </p>
          </div>
          {session.status !== 'ended' && (
            <button
              type="button"
              className="link"
              disabled={busy}
              onClick={() => {
                if (window.confirm('End this discussion? Students will no longer be able to speak.')) {
                  void patch({ endNow: true });
                }
              }}
              style={{ whiteSpace: 'nowrap' }}
            >
              End discussion
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
              <img src={qr} alt="Join QR code" width={220} height={220} />
              <div>
                {session.requireTicket !== false ? (
                  <>
                    <div style={{ fontSize: 13, color: 'var(--muted)' }}>
                      Live check-in — refreshes in {rotatesIn}s
                    </div>
                    <div style={{ fontSize: 15, marginTop: 6, maxWidth: 320 }}>
                      Students must <strong>scan this code</strong> to join. A screenshot or the
                      typed code alone won&apos;t work.
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ fontSize: 13, color: 'var(--muted)' }}>Code</div>
                    <div style={{ fontSize: 44, fontWeight: 800, letterSpacing: 6 }}>
                      {session.joinCode}
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 4 }}>
                      Open joining — anyone with the code can join.
                    </div>
                  </>
                )}
                <label
                  style={{
                    display: 'flex',
                    gap: 8,
                    alignItems: 'center',
                    marginTop: 14,
                    fontSize: 13,
                    fontWeight: 400,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={session.requireTicket !== false}
                    disabled={busy}
                    onChange={(e) => void patch({ requireTicket: e.target.checked })}
                  />
                  Require live QR scan (check-in)
                </label>
              </div>
            </div>
          )}
        </section>

        {/* ---- Floor control ---- */}
        <section className="card" style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0 }}>Who has the microphone</h3>
            <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
              <label style={{ display: 'flex', gap: 6, alignItems: 'center', fontSize: 13, fontWeight: 400 }}>
                <input
                  type="checkbox"
                  checked={session.openFloor !== false}
                  disabled={busy}
                  onChange={(e) => void patch({ openFloor: e.target.checked })}
                />
                Open floor (everyone)
              </label>
              <button
                type="button"
                className="link"
                disabled={busy || session.floorParticipantId === null}
                onClick={() => void patch({ floorParticipantId: null })}
              >
                Close the floor
              </button>
            </div>
          </div>
          <p className="sub" style={{ marginTop: 6 }}>
            {session.openFloor !== false
              ? 'OPEN FLOOR (default): anyone can switch their own mic on and off. Untick it to take turns instead.'
              : 'Turn-taking: only the person you give the floor to can record. ✋ marks a student asking to speak.'}
          </p>
          {groups.map((g) => (
            <div key={g.id} style={{ marginTop: 12 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: g.color }}>
                {g.label} · {g.members.length}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
                {g.members.length === 0 && <span className="sub">nobody yet</span>}
                {g.members.map((p) => {
                  const holds = session.floorParticipantId === p.id;
                  const raised = p.handRaisedAt != null;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      disabled={busy}
                      onClick={() => void patch({ floorParticipantId: holds ? null : p.id })}
                      style={{
                        padding: '7px 12px',
                        borderRadius: 999,
                        border: `1px solid ${holds ? '#1a7f37' : raised ? '#b8860b' : 'var(--border)'}`,
                        background: holds ? '#1a7f37' : raised ? '#fff7e0' : 'var(--bg)',
                        color: holds ? '#fff' : 'var(--text)',
                        cursor: 'pointer',
                        fontWeight: 600,
                      }}
                    >
                      {holds ? '🎤 ' : raised ? '✋ ' : ''}
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
                <span style={{ fontWeight: 700, color: colorOf(t.team) }}>{t.speakerName}</span>
                <div>{t.text}</div>
              </div>
            ))}
          </div>
        </section>

        {/* ---- AI assistant ---- */}
        <section className="card" style={{ marginTop: 16, marginBottom: 40 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0 }}>AI assistant</h3>
            <button className="link" type="button" disabled={judging} onClick={() => void runJudge()}>
              {judging ? 'Reading the discussion…' : 'Summarise the discussion'}
            </button>
          </div>
          <p className="sub" style={{ marginTop: 6 }}>
            Summarises each group, finds agreement and disagreement, and points at what nobody
            said. It does not score anyone or pick a winner. Names are hidden from it.
          </p>

          {judgement !== undefined && (
            <div style={{ marginTop: 14 }}>
              <p style={{ fontSize: 15 }}>{judgement.rationale}</p>

              {(insight?.teams ?? []).map((t) => (
                <div key={t.teamId} style={{ marginTop: 14 }}>
                  <div style={{ fontWeight: 700, color: colorOf(t.teamId) }}>{t.label}</div>
                  <ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>
                    {t.points.map((pt, i) => (
                      <li key={i}>{pt}</li>
                    ))}
                  </ul>
                  {t.suggestion !== '' && (
                    <p className="sub" style={{ marginTop: 4 }}>
                      → {t.suggestion}
                    </p>
                  )}
                </div>
              ))}

              {(
                [
                  ['Common ground', insight?.agreements ?? []],
                  ['Where they disagree', insight?.disagreements ?? []],
                  ['Nobody mentioned', insight?.gaps ?? []],
                ] as const
              ).map(([label, items]) =>
                items.length === 0 ? null : (
                  <div key={label} style={{ marginTop: 14 }}>
                    <div style={{ fontWeight: 700 }}>{label}</div>
                    <ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>
                      {items.map((x, i) => (
                        <li key={i}>{x}</li>
                      ))}
                    </ul>
                  </div>
                ),
              )}

              {insight?.nextQuestion !== undefined && insight.nextQuestion !== '' && (
                <div style={{ marginTop: 14 }}>
                  <div style={{ fontWeight: 700 }}>Ask the room next</div>
                  <p style={{ marginTop: 4 }}>{insight.nextQuestion}</p>
                </div>
              )}
            </div>
          )}
        </section>
      </main>
    </>
  );
}
