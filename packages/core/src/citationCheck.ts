/**
 * Citation verification — the deterministic anti-hallucination guarantee for
 * web-sourced answers.
 *
 * The agent is instructed to cite only the exact URLs the web_search tool listed
 * back to it. This ENFORCES that: every http(s) URL in the answer is checked
 * against the set of URLs carried by the real captured citations (retrieve
 * citations have no URL and are ignored — the fabrication-prone kind is web
 * links). A URL the model emitted that is NOT a real captured source is replaced
 * with a neutral marker so a fabricated link never reaches a student, and the
 * caller records a governance verdict.
 *
 * Robustness (learned from review): URLs commonly contain parentheses
 * (Wikipedia disambiguation), query strings, and fragments, and often arrive
 * wrapped in markdown `[label](url)` or prose `(see url)`. So we (a) match URLs
 * inclusively, (b) normalize via the WHATWG URL parser lowercasing ONLY the
 * scheme+host (paths/queries are case-sensitive), (c) trim trailing punctuation
 * and UNBALANCED closing parens, and (d) unwrap fabricated markdown links to
 * plain text so no dangling `[label](marker)` is produced.
 *
 * This is intentionally NOT an LLM step: a cheap, deterministic membership check
 * that cannot itself hallucinate.
 */

import type { Citation } from '@vta/shared';

/** Marker substituted for a URL that does not correspond to a real source. */
export const UNVERIFIED_SOURCE_MARKER = '[unverified source removed]';

/** Markdown link `[label](http(s)://…)`, tolerating one level of nested parens in the URL. */
const MD_LINK_RE = /\[([^\]]*)\]\((https?:\/\/[^)]*(?:\([^)]*\)[^)]*)*)\)/gi;

/** A bare http(s) URL: stops only at whitespace/quotes/brackets/angle — KEEPS parens. */
const BARE_URL_RE = /https?:\/\/[^\s<>"'`\][]+/gi;

/**
 * Normalize a URL for comparison. Uses the WHATWG parser to lowercase the
 * scheme + host only (RFC 3986: path/query/fragment are case-sensitive) and drop
 * a trailing slash. Falls back to a whole-string lowercase if parsing fails.
 */
function normalizeUrl(raw: string): string {
  const cleaned = trimUrlEnd(raw);
  try {
    const u = new URL(cleaned);
    const path = u.pathname.replace(/\/+$/, '');
    return `${u.protocol}//${u.host.toLowerCase()}${path}${u.search}${u.hash}`;
  } catch {
    return cleaned.replace(/\/+$/, '').toLowerCase();
  }
}

/** Trim trailing sentence punctuation and UNBALANCED trailing `)`/`]` (prose/markdown wrappers). */
function trimUrlEnd(url: string): string {
  let s = url;
  for (;;) {
    const before = s;
    s = s.replace(/[.,;:!?]+$/, '');
    if (s.endsWith(')') && countOf(s, ')') > countOf(s, '(')) s = s.slice(0, -1);
    else if (s.endsWith(']') && countOf(s, ']') > countOf(s, '[')) s = s.slice(0, -1);
    if (s === before) return s;
  }
}

function countOf(s: string, ch: string): number {
  let n = 0;
  for (const c of s) if (c === ch) n += 1;
  return n;
}

export interface CitationCheckResult {
  /** The answer with any non-real URL replaced by {@link UNVERIFIED_SOURCE_MARKER}. */
  readonly text: string;
  /** How many URL occurrences were stripped as unverifiable. */
  readonly fabricatedCount: number;
}

/**
 * Verify the URLs cited in `answer` against the real captured `citations`.
 * Returns the (possibly cleaned) text and the count of stripped fabrications.
 */
export function verifyCitations(
  answer: string,
  citations: readonly Citation[],
): CitationCheckResult {
  // Allowed URLs from real captured citations. Web citations carry the URL in
  // sourceId and locator; course citations carry a material uuid (not a URL) and
  // contribute nothing here.
  const allowed = new Set<string>();
  for (const c of citations) {
    for (const value of [c.sourceId, c.locator]) {
      if (typeof value === 'string' && /^https?:\/\//i.test(value)) {
        allowed.add(normalizeUrl(value));
      }
    }
  }
  const isAllowed = (rawUrl: string): boolean => allowed.has(normalizeUrl(rawUrl));

  let fabricatedCount = 0;

  // Pass 1: markdown links. A fabricated link is UNWRAPPED to "label (marker)"
  // so no dangling `[label](marker)` markdown remains; a real link is kept whole.
  let text = answer.replace(MD_LINK_RE, (whole: string, label: string, url: string) => {
    if (isAllowed(url)) return whole;
    fabricatedCount += 1;
    const trimmedLabel = label.trim();
    return trimmedLabel === ''
      ? UNVERIFIED_SOURCE_MARKER
      : `${trimmedLabel} (${UNVERIFIED_SOURCE_MARKER})`;
  });

  // Pass 2: remaining bare URLs (kept markdown links' inner URLs are allowed and
  // pass through unchanged). Preserve any trailing punctuation we trimmed.
  text = text.replace(BARE_URL_RE, (raw: string) => {
    const clean = trimUrlEnd(raw);
    if (allowed.has(normalizeUrl(clean))) return raw;
    fabricatedCount += 1;
    return UNVERIFIED_SOURCE_MARKER + raw.slice(clean.length);
  });

  return { text: fabricatedCount > 0 ? text : answer, fabricatedCount };
}
