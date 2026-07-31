'use client';

import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';

import { BANDS, DIMENSIONS } from '@/lib/contributionTypes';
import type { ContributionReport, DimensionId } from '@/lib/contributionTypes';
import { relativeTime } from '@/lib/format';

interface Group {
  id: string;
  label: string;
  color: string;
}

/** Ordinal bands render as segments — there is no number to average into a grade. */
function Meter({ value }: { value: number | undefined }) {
  if (value === undefined) return <span className="t-small t-subtle">—</span>;
  return (
    <span className="band">
      <span className="band-word">{BANDS[value]}</span>
      <span className="meter" data-band={value} role="img" aria-label={`${value} of 4`}>
        {[1, 2, 3, 4].map((i) => (
          <i key={i} data-on={i <= value} />
        ))}
      </span>
    </span>
  );
}

/**
 * The instructor-only participation review.
 *
 * Rendered in ROSTER ORDER, never sorted by band. Sorting a class by an AI
 * judgement turns an advisory read into a league table, which is the one thing
 * this is not allowed to become.
 */
export function ContributionSheet({
  sessionId,
  groups,
  onClose,
}: {
  sessionId: string;
  groups: Group[];
  onClose: () => void;
}) {
  const [report, setReport] = useState<ContributionReport | null>(null);
  const [createdAt, setCreatedAt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const colorOf = (id: string): string =>
    groups.find((g) => g.id === id)?.color ?? 'var(--text-subtle)';
  const labelOf = (id: string): string =>
    groups.find((g) => g.id === id)?.label ?? 'Observer';

  // Show the last review rather than silently spending another model call.
  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch(`/api/debate/sessions/${sessionId}/contributions`);
        const d = (await res.json().catch(() => ({}))) as {
          report?: ContributionReport | null;
          createdAt?: string;
        };
        if (d.report != null) {
          setReport(d.report);
          setCreatedAt(d.createdAt ?? null);
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [sessionId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function run(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/debate/sessions/${sessionId}/contributions`, {
        method: 'POST',
      });
      const d = (await res.json().catch(() => ({}))) as {
        report?: ContributionReport;
        createdAt?: string;
        error?: string;
      };
      if (!res.ok || d.report === undefined) {
        setError(d.error ?? 'Could not review contributions.');
      } else {
        setReport(d.report);
        setCreatedAt(d.createdAt ?? null);
      }
    } catch {
      setError('Network problem running the review.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sheet" role="dialog" aria-modal="true" aria-label="Contribution review">
      <header className="sheet-head">
        <div style={{ minWidth: 0 }}>
          <h2 className="t-heading">Contribution review</h2>
          <p className="t-small t-subtle">
            Only you can see this
            {createdAt !== null && ` · generated ${relativeTime(createdAt)}`}
          </p>
        </div>
        <span className="spacer" />
        <button type="button" className="btn" disabled={busy} onClick={() => void run()}>
          {busy ? 'Reviewing…' : report === null ? 'Run review' : 'Re-run'}
        </button>
        <button type="button" className="btn ghost" onClick={onClose}>
          Close (Esc)
        </button>
      </header>

      <div className="sheet-body">
        <div className="sheet-inner">
          <p className="banner warn">
            Advisory only — not a grade. This reads a speech-to-text transcript, so it
            under-counts quiet speakers, people with a poor microphone, non-native speakers, and
            anyone who contributed by listening. Treat a low band as &ldquo;little evidence in this
            transcript&rdquo;, not as a judgement of the student. Names are hidden from the AI.
          </p>

          {error !== null && (
            <p className="banner error" role="alert">
              {error}
            </p>
          )}

          {loading ? (
            <div className="empty">
              <p>Loading…</p>
            </div>
          ) : busy && report === null ? (
            <div className="empty">
              <div className="thinking">
                <i />
                <i />
                <i />
                <span>Reading the transcript…</span>
              </div>
            </div>
          ) : report === null ? (
            <div className="empty">
              <div className="empty-title">No review yet</div>
              <p>
                Run it once the discussion has some substance in it — usually at the end, though
                you can re-run it as often as you like.
              </p>
            </div>
          ) : (
            <>
              <p className="insight-summary">{report.summary}</p>

              {report.roomNotes.length > 0 && (
                <section className="panel">
                  <div className="panel-head">
                    <h3>About the room</h3>
                  </div>
                  <div className="panel-body">
                    <ul className="insight-list">
                      {report.roomNotes.map((n, i) => (
                        <li key={i}>{n}</li>
                      ))}
                    </ul>
                  </div>
                </section>
              )}

              {report.reviews.map((r) => (
                <article
                  className="reviewee"
                  key={r.participantId}
                  style={{ '--group': colorOf(r.team) } as CSSProperties}
                >
                  <div style={{ minWidth: 0 }}>
                    <div className="row" style={{ gap: 8 }}>
                      <span className="t-heading">{r.displayName}</span>
                      <span className="group-chip">
                        <i className="group-dot" />
                        {labelOf(r.team)}
                      </span>
                    </div>
                    <div className="reviewee-stats">
                      <span>{r.stats.turns === 1 ? '1 turn' : `${r.stats.turns} turns`}</span>
                      <span>{r.stats.words} words</span>
                      <span>{Math.round(r.stats.shareOfTalk * 100)}% of the talking</span>
                    </div>

                    {r.evidence !== '' && (
                      <p className="evidence">
                        <b>What they did</b>
                        {r.evidence}
                      </p>
                    )}
                    {r.suggestion !== '' && (
                      <p className="evidence">
                        <b>Next time</b>
                        {r.suggestion}
                      </p>
                    )}
                  </div>

                  <div>
                    {DIMENSIONS.map((d) => (
                      <div className="bandrow" key={d.id}>
                        <span className="bandrow-label" title={d.blurb}>
                          {d.label}
                        </span>
                        <Meter value={r.bands[d.id as DimensionId]} />
                      </div>
                    ))}
                  </div>
                </article>
              ))}

              {report.silent.length > 0 && (
                <section className="panel">
                  <div className="panel-head">
                    <h3>Didn&apos;t speak</h3>
                    <span className="spacer" />
                    <span className="t-small t-subtle">{report.silent.length}</span>
                  </div>
                  <div className="panel-body">
                    <p className="t-small t-muted" style={{ marginBottom: 10 }}>
                      Joined but no transcribed turn. That can mean they were quiet, or that their
                      microphone never worked — worth asking before drawing a conclusion.
                    </p>
                    <div className="row wrap" style={{ gap: 6 }}>
                      {report.silent.map((p) => (
                        <span
                          className="group-chip"
                          key={p.participantId}
                          style={{ '--group': colorOf(p.team) } as CSSProperties}
                        >
                          <i className="group-dot" />
                          {p.displayName}
                        </span>
                      ))}
                    </div>
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
