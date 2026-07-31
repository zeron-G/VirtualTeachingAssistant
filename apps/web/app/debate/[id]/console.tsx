'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

import { Transcript } from '@/app/_components/Transcript';
import { ContributionSheet } from './contribution-sheet';
import { useDebateStream } from '@/lib/useDebateStream';
import type { Snapshot } from '@/lib/useDebateStream';

const OBSERVER = { id: 'observer', label: 'Observers', color: '#5b6672' };
const ROTATE_SECONDS = 30;

interface Insight {
  teams?: { teamId: string; label: string; points: string[]; suggestion: string }[];
  agreements?: string[];
  disagreements?: string[];
  gaps?: string[];
  nextQuestion?: string;
}

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
  const [projector, setProjector] = useState(false);
  const [contributions, setContributions] = useState(false);

  // The QR is a ROTATING check-in ticket: it re-mints every 30s so a photo taken
  // earlier stops working. Students must scan it live to join.
  const [qr, setQr] = useState(qrDataUrl);
  const [rotatesIn, setRotatesIn] = useState(ROTATE_SECONDS);
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
            setRotatesIn(d.rotateInSeconds ?? ROTATE_SECONDS);
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
    const t = setInterval(() => setRotatesIn((s) => (s <= 1 ? ROTATE_SECONDS : s - 1)), 1000);
    return () => clearInterval(t);
  }, []);

  // Esc leaves projector mode — the professor is at a lectern, not a mouse.
  useEffect(() => {
    if (!projector) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setProjector(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [projector]);

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
        setError(d.error ?? 'The assistant could not read the discussion.');
      }
    } catch {
      setError('Network problem running the assistant.');
    } finally {
      setJudging(false);
    }
  }

  const teams = session.teams ?? [];
  const teamIds = new Set(teams.map((t) => t.id));
  /** Every configured group, plus an Observers bucket when anyone is in it. */
  const groups = [
    ...teams.map((t) => ({ ...t, members: participants.filter((p) => p.team === t.id) })),
    { ...OBSERVER, members: participants.filter((p) => !teamIds.has(p.team)) },
  ].filter((g) => g.id !== OBSERVER.id || g.members.length > 0);
  const colorOf = (id: string): string => teams.find((t) => t.id === id)?.color ?? OBSERVER.color;
  const insight = judgement?.scores as Insight | undefined;
  const ended = session.status === 'ended';
  const openFloor = session.openFloor !== false;
  const requireTicket = session.requireTicket !== false;
  const raisedCount = participants.filter((p) => p.handRaisedAt != null).length;

  return (
    <div className="console">
      <header className="console-head">
        <a className="brand" href="/debate" title="All discussions">
          <div className="brand-mark">VTA</div>
        </a>
        <div className="console-topic" style={{ flex: 1 }}>
          <h1 title={session.topic}>{session.topic}</h1>
          <div className="console-stats">
            <span>
              {participants.length} joined
            </span>
            <span>{turns.length} contributions</span>
            {raisedCount > 0 && <span style={{ color: 'var(--warn)' }}>{raisedCount} raised</span>}
          </div>
        </div>

        {ended ? (
          <span className="badge">Ended</span>
        ) : (
          <>
            <span className="badge ok">
              <i className="dot pulse" />
              Live
            </span>
            <button
              type="button"
              className="btn danger sm"
              disabled={busy}
              onClick={() => {
                if (
                  window.confirm('End this discussion? Students will no longer be able to speak.')
                ) {
                  void patch({ endNow: true });
                }
              }}
            >
              End
            </button>
          </>
        )}
        <span className="appbar-email t-small t-subtle">{professorEmail}</span>
      </header>

      <div className="console-body">
        <main className="console-main">
          {error !== null && (
            <div style={{ padding: '12px 18px 0' }}>
              <p className="banner error" role="alert">
                {error}
              </p>
            </div>
          )}
          <Transcript
            turns={turns}
            groups={teams}
            emptyTitle="No one has spoken yet"
            emptyBody="Turns appear here the moment a student stops recording. Put the QR on screen to let people in."
          />
        </main>

        <aside className="console-side">
          {/* ---- Check-in ---- */}
          <section className="panel">
            <div className="panel-head">
              <h2>Check-in</h2>
              <span className="spacer" />
              <button type="button" className="btn-link" onClick={() => setProjector(true)}>
                Full screen
              </button>
            </div>
            <div className="panel-body" style={{ padding: 12 }}>
              <div className="qr-tile">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="qr-img" src={qr} alt="QR code to join this discussion" />
                {requireTicket ? (
                  <div className="qr-rotate">
                    <span className="qr-bar">
                      <i style={{ width: `${(rotatesIn / ROTATE_SECONDS) * 100}%` }} />
                    </span>
                    <span>refreshes in {rotatesIn}s</span>
                  </div>
                ) : (
                  <div className="joincode">{session.joinCode}</div>
                )}
              </div>

              <p className="t-small t-muted" style={{ marginTop: 10 }}>
                {requireTicket
                  ? 'Students must scan this live. A screenshot or the typed code alone will not work.'
                  : 'Open joining — anyone with the code can get in, from anywhere.'}
              </p>

              <label className="check" style={{ marginTop: 12 }}>
                <input
                  type="checkbox"
                  checked={requireTicket}
                  disabled={busy || ended}
                  onChange={(e) => void patch({ requireTicket: e.target.checked })}
                />
                <span>Require a live scan to join</span>
              </label>
            </div>
          </section>

          {/* ---- Microphone ---- */}
          <section className="panel">
            <div className="panel-head">
              <h2>Microphone</h2>
              <span className="spacer" />
              <button
                type="button"
                className="btn-link"
                disabled={busy || session.floorParticipantId === null}
                onClick={() => void patch({ floorParticipantId: null })}
              >
                Close floor
              </button>
            </div>
            <div className="panel-body">
              <label className="check">
                <input
                  type="checkbox"
                  checked={openFloor}
                  disabled={busy || ended}
                  onChange={(e) => void patch({ openFloor: e.target.checked })}
                />
                <span>
                  <strong>Open floor</strong> — anyone can switch their own mic on and off.
                  {!openFloor && ' Untick means only the person you pick can record.'}
                </span>
              </label>

              <div className="stack" style={{ marginTop: 16, gap: 14 }}>
                {groups.map((g) => (
                  <div key={g.id} style={{ '--group': g.color } as CSSProperties}>
                    <div className="row" style={{ gap: 7, marginBottom: 7 }}>
                      <i className="group-dot" />
                      <span className="group-name t-small">{g.label}</span>
                      <span className="t-small t-subtle">{g.members.length}</span>
                    </div>
                    {g.members.length === 0 ? (
                      <span className="t-small t-subtle">nobody yet</span>
                    ) : (
                      <div className="row wrap" style={{ gap: 6 }}>
                        {g.members.map((p) => {
                          const holds = session.floorParticipantId === p.id;
                          const raised = p.handRaisedAt != null;
                          return (
                            <button
                              key={p.id}
                              type="button"
                              className="pill"
                              data-state={holds ? 'holding' : raised ? 'raised' : undefined}
                              disabled={busy || ended}
                              title={
                                holds ? 'Has the floor — click to take it back' : 'Give the floor'
                              }
                              onClick={() =>
                                void patch({ floorParticipantId: holds ? null : p.id })
                              }
                            >
                              {holds ? '🎤' : raised ? '✋' : null}
                              {p.displayName}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ))}
                {participants.length === 0 && (
                  <p className="t-small t-subtle">
                    Nobody has joined yet — show the QR on the projector.
                  </p>
                )}
              </div>
            </div>
          </section>

          {/* ---- AI ---- */}
          <section className="panel">
            <div className="panel-head">
              <h2>AI assistant</h2>
              <span className="spacer" />
              <button
                type="button"
                className="btn-link"
                disabled={judging || turns.length === 0}
                onClick={() => void runJudge()}
              >
                {judgement === undefined ? 'Read the room' : 'Refresh'}
              </button>
            </div>
            <div className="panel-body">
              {judging ? (
                <div className="thinking">
                  <i />
                  <i />
                  <i />
                  <span>Reading {turns.length} contributions…</span>
                </div>
              ) : judgement === undefined ? (
                <p className="t-small t-muted">
                  Summarises what each group argued, finds real agreement and disagreement, and
                  points at what nobody said. It never scores anyone or picks a winner, and it
                  never sees student names.
                </p>
              ) : (
                <div className="stack">
                  <p className="insight-summary">{judgement.rationale}</p>

                  {(insight?.teams ?? []).map((t) => (
                    <div
                      className="insight-block"
                      key={t.teamId}
                      style={{ '--group': colorOf(t.teamId) } as CSSProperties}
                    >
                      <div className="row" style={{ gap: 7, marginBottom: 7 }}>
                        <i className="group-dot" />
                        <span className="group-name t-small">{t.label}</span>
                      </div>
                      <ul className="insight-list">
                        {t.points.map((pt, i) => (
                          <li key={i}>{pt}</li>
                        ))}
                      </ul>
                      {t.suggestion !== '' && <p className="insight-suggestion">{t.suggestion}</p>}
                    </div>
                  ))}

                  {(
                    [
                      ['Common ground', insight?.agreements ?? []],
                      ['Where they differ', insight?.disagreements ?? []],
                      ['Nobody mentioned', insight?.gaps ?? []],
                    ] as const
                  ).map(([label, items]) =>
                    items.length === 0 ? null : (
                      <div className="insight-block" key={label}>
                        <h4>{label}</h4>
                        <ul className="insight-list">
                          {items.map((x, i) => (
                            <li key={i}>{x}</li>
                          ))}
                        </ul>
                      </div>
                    ),
                  )}

                  {insight?.nextQuestion !== undefined && insight.nextQuestion !== '' && (
                    <div className="insight-block">
                      <h4>Ask the room next</h4>
                      <p className="insight-question">{insight.nextQuestion}</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>

          {/* ---- Participation ---- */}
          <section className="panel">
            <div className="panel-head">
              <h2>Contribution review</h2>
              <span className="spacer" />
              <span className="badge">You only</span>
            </div>
            <div className="panel-body">
              <p className="t-small t-muted">
                A per-student read of how each person took part — measured turns and share of the
                talking, plus bands for substance, engagement and moving the discussion on.
                Advisory, never a grade, and never shown to students.
              </p>
              <button
                type="button"
                className="btn block"
                style={{ marginTop: 12 }}
                disabled={turns.length === 0}
                onClick={() => setContributions(true)}
              >
                {turns.length === 0 ? 'Nothing to review yet' : 'Open review'}
              </button>
            </div>
          </section>
        </aside>
      </div>

      {contributions && (
        <ContributionSheet
          sessionId={session.id}
          groups={[...teams, OBSERVER]}
          onClose={() => setContributions(false)}
        />
      )}

      {/* ---- Projector mode ---- */}
      {projector && (
        <div className="projector" role="dialog" aria-modal="true" aria-label="Join code">
          <button
            type="button"
            className="btn projector-close"
            onClick={() => setProjector(false)}
          >
            Close (Esc)
          </button>
          <p className="projector-topic t-balance">{session.topic}</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="projector-qr" src={qr} alt="QR code to join this discussion" />
          {requireTicket ? (
            <p className="projector-hint">
              Scan to join · refreshes in {rotatesIn}s
            </p>
          ) : (
            <p className="projector-hint">
              Scan, or go to <strong>{new URL(joinUrl).host}</strong> and enter{' '}
              <strong>{session.joinCode}</strong>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
