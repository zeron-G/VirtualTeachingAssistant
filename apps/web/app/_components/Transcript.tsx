'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';

import { clockTime, initials } from '@/lib/format';

export interface Turn {
  id: string;
  speakerName: string;
  team: string;
  text: string;
  createdAt: string;
}

export interface Group {
  id: string;
  label: string;
  color: string;
}

/**
 * The live transcript, shared by the professor console and the student room.
 *
 * Two behaviours make this usable during an actual class:
 *  - it follows new turns automatically, but ONLY while the reader is already at
 *    the bottom. Yanking the view away from someone re-reading an earlier point
 *    is worse than missing a line.
 *  - consecutive turns from one speaker collapse into a block, so a person who
 *    talks for a while doesn't produce a column of repeated name badges.
 */
export function Transcript({
  turns,
  groups,
  className = 'transcript',
  emptyTitle = 'Nothing spoken yet',
  emptyBody,
}: {
  turns: Turn[];
  groups: Group[];
  className?: string;
  emptyTitle?: string;
  emptyBody?: string;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pinnedRef = useRef(true);
  const [showJump, setShowJump] = useState(false);

  const colorOf = (teamId: string): string =>
    groups.find((g) => g.id === teamId)?.color ?? 'var(--text-subtle)';

  // Track whether the reader is at the bottom. 60px of slack so a stray pixel
  // of momentum scrolling doesn't count as "scrolled away".
  useEffect(() => {
    const el = scrollRef.current;
    if (el === null) return;
    const onScroll = (): void => {
      const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
      pinnedRef.current = atBottom;
      setShowJump(!atBottom);
    };
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  // Before paint, so following the feed never shows a frame of the old position.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el === null || !pinnedRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [turns.length]);

  function jumpToNewest(): void {
    const el = scrollRef.current;
    if (el === null) return;
    el.scrollTop = el.scrollHeight;
    pinnedRef.current = true;
    setShowJump(false);
  }

  return (
    <div className="transcript-wrap">
      <div ref={scrollRef} className={className} role="log" aria-live="polite" aria-atomic="false">
        {turns.length === 0 ? (
          <div className="empty">
            <div className="empty-title">{emptyTitle}</div>
            {emptyBody !== undefined && <p>{emptyBody}</p>}
          </div>
        ) : (
          turns.map((t, i) => {
            const prev = turns[i - 1];
            const cont = prev !== undefined && prev.speakerName === t.speakerName && prev.team === t.team;
            return (
              <article
                key={t.id}
                className={cont ? 'turn cont' : 'turn'}
                style={{ '--group': colorOf(t.team) } as CSSProperties}
              >
                <div className="turn-avatar" aria-hidden="true">
                  {initials(t.speakerName)}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div className="turn-meta">
                    <span className="turn-name">{t.speakerName}</span>
                    <span className="turn-time">{clockTime(t.createdAt)}</span>
                  </div>
                  <p className="turn-text">{t.text}</p>
                </div>
              </article>
            );
          })
        )}
      </div>

      {showJump && turns.length > 0 && (
        <button type="button" className="btn sm jump" onClick={jumpToNewest}>
          ↓ Jump to newest
        </button>
      )}
    </div>
  );
}
