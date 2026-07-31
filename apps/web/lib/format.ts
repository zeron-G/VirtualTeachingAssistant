/** Presentation helpers shared by the console, the room and the session list. */

/** "just now" / "4m ago" / "2h ago" / "3d ago" — coarse on purpose. */
export function relativeTime(value: string | Date): string {
  const then = typeof value === 'string' ? new Date(value) : value;
  const secs = Math.round((Date.now() - then.getTime()) / 1000);
  if (!Number.isFinite(secs)) return '';
  if (secs < 45) return 'just now';
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

/** Wall-clock time for a transcript line — the professor scans these vertically. */
export function clockTime(value: string | Date): string {
  const d = typeof value === 'string' ? new Date(value) : value;
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** m:ss for an open microphone. */
export function duration(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * Up to two letters for an avatar. Falls back to '?' so a blank name can never
 * render an empty circle.
 */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : '';
  return (first + last).toUpperCase() || '?';
}
