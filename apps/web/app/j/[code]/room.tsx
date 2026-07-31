'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';

import { useDebateStream } from '@/lib/useDebateStream';
import type { Snapshot } from '@/lib/useDebateStream';

const EMPTY: Snapshot = {
  session: {
    id: '',
    courseId: '',
    topic: '',
    status: 'lobby',
    phase: 'Lobby',
    phaseSeq: 0,
    floorParticipantId: null,
    joinCode: '',
  },
  participants: [],
  turns: [],
};

export function Room({
  code,
  sessionId,
  topic,
  ended,
  resumeParticipantId = null,
  ticket = '',
  requireTicket = false,
  teams,
}: {
  code: string;
  sessionId: string;
  topic: string;
  ended: boolean;
  /** Set when a valid participant cookie already exists — skip the join form. */
  resumeParticipantId?: string | null;
  /** Rotating check-in ticket from the QR (`?t=`). */
  ticket?: string;
  requireTicket?: boolean;
  /** The 2-4 groups configured for this discussion. */
  teams: { id: string; label: string; color: string }[];
}) {
  const [participantId, setParticipantId] = useState<string | null>(resumeParticipantId);
  const [name, setName] = useState('');
  const [team, setTeam] = useState<string>(teams[0]?.id ?? 'red');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (ended) {
    return (
      <div className="auth-wrap">
        <div className="auth-card">
          <h1>This discussion has ended</h1>
          <p className="sub">Ask your instructor for a new code.</p>
        </div>
      </div>
    );
  }

  async function join(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await fetch('/api/debate/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, name, team, consent, ticket }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      participant?: { id: string };
      error?: string;
    };
    setBusy(false);
    if (res.ok && data.participant !== undefined) {
      setParticipantId(data.participant.id);
      return;
    }
    setError(data.error ?? 'Could not join.');
  }

  if (participantId === null) {
    return (
      <div className="auth-wrap">
        <div className="auth-card">
          <div className="brand">
            <div className="brand-mark">VTA</div>
            <div className="brand-name">Classroom discussion</div>
          </div>
          <h1>Join the discussion</h1>
          <p className="sub">{topic}</p>

          {requireTicket && ticket === '' && (
            <p className="error" style={{ marginTop: 0 }}>
              Scan the QR code on the screen to check in — it changes every 30 seconds, so a
              screenshot or a typed code won&apos;t work.
            </p>
          )}

          <form onSubmit={join}>
            <label htmlFor="name">Your name</label>
            <input
              id="name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="How your name should appear"
              maxLength={40}
              required
              autoFocus
            />

            <div style={{ height: 14 }} />
            <label htmlFor="team">Your group</label>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {[...teams, { id: 'observer', label: 'Just listening', color: '#5b6672' }].map(
                (t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTeam(t.id)}
                    style={{
                      flex: '1 1 40%',
                      padding: '10px 6px',
                      borderRadius: 10,
                      border: `2px solid ${team === t.id ? t.color : 'var(--border)'}`,
                      background: team === t.id ? t.color : 'var(--bg)',
                      color: team === t.id ? '#fff' : 'var(--text)',
                      fontWeight: 700,
                      fontSize: 13,
                      cursor: 'pointer',
                    }}
                  >
                    {t.label}
                  </button>
                ),
              )}
            </div>

            <label
              style={{
                display: 'flex',
                gap: 10,
                alignItems: 'flex-start',
                marginTop: 18,
                fontWeight: 400,
                fontSize: 13,
              }}
            >
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                style={{ marginTop: 3 }}
              />
              <span>
                I understand that when I hold the microphone my speech is recorded and
                transcribed for this class activity, that the transcript is shown to my
                instructor and classmates, and that an AI will summarise the discussion.
              </span>
            </label>

            <button className="primary" type="submit" disabled={busy || name.trim() === '' || !consent}>
              {busy ? 'Joining…' : 'Join'}
            </button>
            {error !== null && <p className="error">{error}</p>}
          </form>
        </div>
      </div>
    );
  }

  return <LiveRoom sessionId={sessionId} participantId={participantId} teams={teams} />;
}

/** The in-discussion view: transcript plus the microphone control. */
function LiveRoom({
  sessionId,
  participantId,
  teams,
}: {
  sessionId: string;
  participantId: string;
  teams: { id: string; label: string; color: string }[];
}) {
  const colorOf = (id: string): string =>
    teams.find((t) => t.id === id)?.color ?? 'var(--muted)';
  const snapshot = useDebateStream(sessionId, { ...EMPTY, session: { ...EMPTY.session, id: sessionId } });
  const { session, turns } = snapshot;
  const me = snapshot.participants.find((p) => p.id === participantId);
  // You may record when the whole room is open (the DEFAULT), or when the
  // professor gave you the floor in strict turn-taking mode.
  const hasFloor = session.openFloor !== false || session.floorParticipantId === participantId;
  const handRaised = me?.handRaisedAt != null;

  async function toggleHand(raised: boolean): Promise<void> {
    await fetch('/api/debate/hand', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ raised }),
    }).catch(() => undefined);
  }

  const [recording, setRecording] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  /**
   * Synchronous record of INTENT. `startRecording` is async (getUserMedia), and
   * the very first press always resolves AFTER the finger lifts — the student
   * has to release the button to tap "Allow" on the permission prompt. Without
   * this guard the mic would open with nobody holding the button and keep
   * recording the room. Every async continuation re-checks the generation.
   */
  const wantRef = useRef(false);
  const genRef = useRef(0);
  const maxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** Hard ceiling so a forgotten open mic can never record indefinitely. */
  const MAX_TURN_MS = 5 * 60 * 1000;
  const [elapsed, setElapsed] = useState(0);

  const hardStop = useCallback((): void => {
    wantRef.current = false;
    genRef.current += 1;
    if (maxTimerRef.current !== null) {
      clearTimeout(maxTimerRef.current);
      maxTimerRef.current = null;
    }
    const rec = recorderRef.current;
    if (rec !== null && rec.state === 'recording') rec.stop();
    else rec?.stream.getTracks().forEach((t) => t.stop());
    setRecording(false);
  }, []);

  // Losing the floor mid-sentence must stop the mic immediately.
  useEffect(() => {
    if (!hasFloor) hardStop();
  }, [hasFloor, hardStop]);

  // Live elapsed counter — an open mic must never be ambiguous.
  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [recording]);

  // Never leave a live microphone behind on unmount.
  useEffect(() => {
    return () => {
      wantRef.current = false;
      genRef.current += 1;
      if (maxTimerRef.current !== null) clearTimeout(maxTimerRef.current);
      const rec = recorderRef.current;
      if (rec !== null && rec.state === 'recording') rec.stop();
      rec?.stream.getTracks().forEach((t) => t.stop());
    };
  }, []);

  async function startRecording() {
    if (wantRef.current) return; // re-entrant press: ignore
    setNote(null);
    wantRef.current = true;
    const gen = ++genRef.current;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      // The button was released (or the floor was revoked) while we waited:
      // close the tracks and NEVER start — this is the hot-mic guard.
      if (!wantRef.current || gen !== genRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      chunksRef.current = [];
      const rec = new MediaRecorder(stream);
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        if (maxTimerRef.current !== null) {
          clearTimeout(maxTimerRef.current);
          maxTimerRef.current = null;
        }
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' });
        chunksRef.current = [];
        recorderRef.current = null;
        void upload(blob);
      };
      recorderRef.current = rec;
      rec.start();
      setRecording(true);
      setElapsed(0);
      maxTimerRef.current = setTimeout(() => {
        setNote('Microphone closed automatically after 5 minutes.');
        hardStop();
      }, MAX_TURN_MS);
    } catch {
      wantRef.current = false;
      setNote('Could not open the microphone. Check the permission prompt in your browser.');
    }
  }

  function stopRecording() {
    // Clear intent FIRST so an in-flight getUserMedia aborts itself.
    wantRef.current = false;
    setRecording(false);
    if (maxTimerRef.current !== null) {
      clearTimeout(maxTimerRef.current);
      maxTimerRef.current = null;
    }
    const rec = recorderRef.current;
    if (rec !== null && rec.state === 'recording') rec.stop();
  }

  async function upload(blob: Blob) {
    if (blob.size === 0) return;
    setUploading(true);
    try {
      const form = new FormData();
      const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
      form.append('audio', blob, `turn.${ext}`);
      const res = await fetch('/api/debate/turns', { method: 'POST', body: form });
      const data = (await res.json().catch(() => ({}))) as { error?: string; empty?: boolean };
      if (!res.ok) setNote(data.error ?? 'Could not send that clip.');
      else if (data.empty === true) setNote("We couldn't hear anything — try again, closer to the mic.");
    } catch {
      setNote('Network problem sending that clip.');
    } finally {
      setUploading(false);
    }
  }

  const teamColor = colorOf(me?.team ?? '');

  return (
    <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark">VTA</div>
          <div className="brand-name">Discussion</div>
        </div>
        <div className="identity">
          <span>{me?.displayName ?? '…'}</span>
          <span className="badge" style={{ background: teamColor, color: '#fff' }}>
            {me?.team ?? '—'}
          </span>
        </div>
      </header>

      <main className="container" style={{ flex: 1, paddingBottom: 190 }}>
        <p className="sub">{session.topic}</p>
        <h3 style={{ marginTop: 18 }}>Transcript</h3>
        {turns.length === 0 && <p className="sub">Nothing spoken yet.</p>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
          {turns.map((t) => (
            <div key={t.id}>
              <span style={{ fontWeight: 700, color: colorOf(t.team) }}>{t.speakerName}</span>
              <div>{t.text}</div>
            </div>
          ))}
        </div>
      </main>

      {/* Fixed mic bar — the ONLY way audio is ever captured. */}
      <div
        style={{
          position: 'fixed',
          left: 0,
          right: 0,
          bottom: 0,
          padding: 16,
          background: 'var(--surface)',
          borderTop: '1px solid var(--border)',
        }}
      >
        {note !== null && <p className="error" style={{ marginTop: 0 }}>{note}</p>}
        {hasFloor ? (
          <>
            <button
              type="button"
              // Tap to open the mic, tap again to close and send. A 3-minute
              // speech is not something anyone can hold a button through.
              onClick={() => (recording ? stopRecording() : void startRecording())}
              disabled={uploading}
              style={{
                width: '100%',
                padding: '22px 16px',
                borderRadius: 14,
                border: 0,
                fontSize: 18,
                fontWeight: 800,
                color: '#fff',
                background: recording ? '#c0392b' : '#1a7f37',
                cursor: 'pointer',
                touchAction: 'manipulation',
              }}
            >
              {uploading
                ? 'Sending…'
                : recording
                  ? `⏹ Stop & send · ${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`
                  : '🎤 Turn on microphone'}
            </button>
            {recording && (
              <div
                style={{
                  textAlign: 'center',
                  marginTop: 8,
                  fontSize: 13,
                  fontWeight: 700,
                  color: '#c0392b',
                }}
              >
                ● YOUR MICROPHONE IS ON — everyone nearby is being recorded on your device
              </div>
            )}
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => void toggleHand(!handRaised)}
              style={{
                width: '100%',
                padding: '18px 16px',
                borderRadius: 14,
                border: `2px solid ${handRaised ? '#b8860b' : 'var(--border)'}`,
                background: handRaised ? '#b8860b' : 'var(--bg)',
                color: handRaised ? '#fff' : 'var(--text)',
                fontSize: 16,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              {handRaised ? '✋ Hand raised — tap to lower' : '✋ Request to speak'}
            </button>
            <div
              style={{
                textAlign: 'center',
                color: 'var(--muted)',
                fontSize: 13,
                marginTop: 8,
              }}
            >
              {handRaised
                ? 'Your instructor can see your hand. The mic opens when they give you the floor.'
                : 'Your microphone is off until your instructor gives you the floor.'}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
