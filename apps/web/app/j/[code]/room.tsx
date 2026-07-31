'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, FormEvent } from 'react';

import { Transcript } from '@/app/_components/Transcript';
import { duration } from '@/lib/format';
import { useDebateStream } from '@/lib/useDebateStream';
import type { Snapshot } from '@/lib/useDebateStream';

const OBSERVER = { id: 'observer', label: 'Just listening', color: '#5b6672' };

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
  ticketValid = false,
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
  /** Whether the server accepted that ticket — a forged `?t=` is not a check-in. */
  ticketValid?: boolean;
  requireTicket?: boolean;
  /** The 2-4 groups configured for this discussion. */
  teams: { id: string; label: string; color: string }[];
}) {
  const [participantId, setParticipantId] = useState<string | null>(resumeParticipantId);
  const [name, setName] = useState('');
  const [team, setTeam] = useState<string>('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (ended) {
    return (
      <div className="auth-wrap">
        <div className="auth-card" style={{ textAlign: 'center' }}>
          <h1 className="t-title">This discussion has ended</h1>
          <p className="t-small t-muted" style={{ marginTop: 6 }}>
            Ask your instructor for a new code.
          </p>
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
    const options = [...teams, OBSERVER];
    return (
      <div className="auth-wrap">
        <div className="auth-card">
          <div className="brand">
            <div className="brand-mark">VTA</div>
            <div className="brand-name">Classroom discussion</div>
          </div>

          <p className="t-eyebrow">You&apos;re joining</p>
          <h1 className="t-title t-balance" style={{ marginTop: 4 }}>
            {topic}
          </h1>

          {requireTicket && !ticketValid && (
            <p className="banner warn" style={{ marginTop: 18 }} role="alert">
              Scan the QR code on the screen to check in. It changes every 30 seconds, so a
              screenshot or the typed code won&apos;t work.
            </p>
          )}

          <form onSubmit={join} className="stack" style={{ marginTop: 22 }}>
            <div className="field">
              <label htmlFor="name">Your name</label>
              <input
                id="name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="How it should appear to the class"
                maxLength={40}
                autoComplete="name"
                required
                autoFocus
              />
            </div>

            <div className="field">
              <span className="label">Your group</span>
              <span className="field-hint">Pick the side you&apos;ll be speaking for.</span>
              <div className="group-picker">
                {options.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={t.id === OBSERVER.id ? 'group-opt wide' : 'group-opt'}
                    aria-pressed={team === t.id}
                    style={{ '--group': t.color } as CSSProperties}
                    onClick={() => setTeam(t.id)}
                  >
                    <i className="group-dot" />
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <label className="check" style={{ marginTop: 4 }}>
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />
              <span className="t-muted">
                I understand that when I turn my microphone on my speech is recorded and
                transcribed for this class activity, that the transcript is shown to my instructor
                and classmates, and that an AI will summarise the discussion.
              </span>
            </label>

            {error !== null && (
              <p className="banner error" role="alert">
                {error}
              </p>
            )}

            <button
              className="btn primary lg block"
              type="submit"
              disabled={busy || name.trim() === '' || team === '' || !consent}
            >
              {busy ? 'Joining…' : 'Join the discussion'}
            </button>
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
  const snapshot = useDebateStream(sessionId, {
    ...EMPTY,
    session: { ...EMPTY.session, id: sessionId },
  });
  const { session, turns } = snapshot;
  const me = snapshot.participants.find((p) => p.id === participantId);
  // You may record when the whole room is open (the DEFAULT), or when the
  // professor gave you the floor in strict turn-taking mode.
  const hasFloor = session.openFloor !== false || session.floorParticipantId === participantId;
  const handRaised = me?.handRaisedAt != null;
  const myGroup = teams.find((t) => t.id === me?.team);

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
      else if (data.empty === true)
        setNote("We couldn't hear anything — try again, closer to the mic.");
    } catch {
      setNote('Network problem sending that clip.');
    } finally {
      setUploading(false);
    }
  }

  const micState = uploading ? 'sending' : recording ? 'recording' : 'idle';

  return (
    <div className="room">
      <header className="appbar">
        <div className="brand">
          <div className="brand-mark">VTA</div>
          <div className="brand-name">Discussion</div>
        </div>
        <div className="appbar-meta">
          <span className="appbar-name">{me?.displayName ?? '…'}</span>
          {myGroup !== undefined ? (
            <span className="group-chip" style={{ '--group': myGroup.color } as CSSProperties}>
              <i className="group-dot" />
              {myGroup.label}
            </span>
          ) : (
            <span className="badge">Observer</span>
          )}
        </div>
      </header>

      <div className="room-topic">
        <p className="t-eyebrow">Question</p>
        <p className="t-heading t-balance" style={{ marginTop: 2 }}>
          {session.topic}
        </p>
      </div>

      <Transcript
        turns={turns}
        groups={teams}
        className="room-feed"
        emptyTitle="Nothing spoken yet"
        emptyBody="Turn your microphone on to say the first thing."
      />

      {/* The only path to a microphone — it never scrolls away. */}
      <div className="micbar">
        {note !== null && (
          <p className="banner error" style={{ marginBottom: 10 }} role="alert">
            {note}
          </p>
        )}

        {hasFloor ? (
          <>
            <button
              type="button"
              className="mic-btn"
              data-state={micState}
              // Tap to open the mic, tap again to close and send. A multi-minute
              // contribution is not something anyone can hold a button through.
              onClick={() => (recording ? stopRecording() : void startRecording())}
              disabled={uploading}
            >
              {uploading ? (
                'Sending…'
              ) : recording ? (
                <>
                  <i className="mic-ring" />
                  Stop &amp; send
                  <span className="timer">{duration(elapsed)}</span>
                </>
              ) : (
                'Turn on microphone'
              )}
            </button>
            <p className={recording ? 'mic-note live' : 'mic-note'}>
              {recording
                ? 'Your microphone is on — everyone nearby is being recorded on your device.'
                : 'Nothing is recorded until you tap.'}
            </p>
          </>
        ) : (
          <>
            <button
              type="button"
              className="mic-btn"
              data-state={handRaised ? 'raised' : 'waiting'}
              onClick={() => void toggleHand(!handRaised)}
            >
              {handRaised ? '✋ Hand raised — tap to lower' : '✋ Request to speak'}
            </button>
            <p className="mic-note">
              {handRaised
                ? 'Your instructor can see your hand. The mic opens when they give you the floor.'
                : 'Your microphone stays off until your instructor gives you the floor.'}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
