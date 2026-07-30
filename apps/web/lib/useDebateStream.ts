'use client';

import { useEffect, useState } from 'react';

/** Mirrors `DebateSnapshot` from @vta/data, as it arrives over the wire (dates are strings). */
export interface Snapshot {
  session: {
    id: string;
    courseId: string;
    topic: string;
    status: string;
    phase: string;
    phaseSeq: number;
    floorParticipantId: string | null;
    joinCode: string;
  };
  participants: {
    id: string;
    displayName: string;
    team: string;
    consentAt: string | null;
  }[];
  turns: {
    id: string;
    speakerName: string;
    team: string;
    phase: string;
    text: string;
    createdAt: string;
  }[];
  judgement?: {
    id: string;
    scores: unknown;
    rationale: string;
    model: string;
    isFinal: boolean;
  };
}

/**
 * Subscribe to a debate's live state over SSE.
 *
 * Every event carries a FULL snapshot, so there is no delta to merge and a
 * reconnect needs no replay: the next message is the whole truth. `EventSource`
 * reconnects on its own, which covers a phone waking from sleep.
 */
export function useDebateStream(sessionId: string, initial: Snapshot): Snapshot {
  const [snapshot, setSnapshot] = useState<Snapshot>(initial);

  useEffect(() => {
    let source: EventSource | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;

    const connect = (): void => {
      if (stopped) return;
      source?.close();
      source = new EventSource(`/api/debate/sessions/${sessionId}/stream`);
      source.addEventListener('snapshot', (e) => {
        try {
          setSnapshot(JSON.parse((e as MessageEvent<string>).data) as Snapshot);
        } catch {
          /* ignore a malformed frame; the next one supersedes it */
        }
      });
      // EventSource retries on its own, but not from CLOSED (which is where a
      // phone that slept, or a 404/500, lands). Reconnect explicitly.
      source.onerror = () => {
        if (stopped) return;
        if (source?.readyState === EventSource.CLOSED) {
          if (retry !== null) clearTimeout(retry);
          retry = setTimeout(connect, 2000);
        }
      };
    };

    // A backgrounded phone can miss frames; resync when it comes back.
    const onVisible = (): void => {
      if (document.visibilityState === 'visible' && source?.readyState !== EventSource.OPEN) {
        connect();
      }
    };

    connect();
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', onVisible);
      if (retry !== null) clearTimeout(retry);
      source?.close();
    };
  }, [sessionId]);

  return snapshot;
}
