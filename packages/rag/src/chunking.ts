/**
 * Deterministic, dependency-free Markdown chunker.
 *
 * Retrieval quality starts here: chunks must be semantically coherent (prefer
 * breaking on headings / paragraph boundaries), bounded in size (so they fit a
 * context budget and embed cleanly), and produced deterministically (the same
 * input always yields the same chunks, which keeps `contentHash`-based skipping
 * and re-embedding stable).
 *
 * Guarantees:
 *   - NEVER drops content: every character of the input (modulo leading/trailing
 *     whitespace that we trim per chunk) appears in some chunk.
 *   - Enforces a hard `maxChars` ceiling even when a single block exceeds it
 *     (such a block is sliced on word boundaries where possible, hard-cut
 *     otherwise so we still respect the ceiling).
 *   - Adds a configurable character overlap between adjacent chunks so a fact
 *     straddling a boundary is recoverable from at least one chunk.
 *   - Deterministic: no randomness, no time, no locale-dependent behavior.
 */

/** Default target maximum chunk size in characters (~300 tokens at 4 chars/token). */
const DEFAULT_MAX_CHARS = 1200;
/** Default overlap carried from the end of one chunk into the start of the next. */
const DEFAULT_OVERLAP_CHARS = 150;

export interface ChunkOptions {
  /** Hard ceiling on chunk size in characters. Default ~1200. */
  readonly maxChars?: number;
  /** Characters of trailing context repeated at the start of the next chunk. Default ~150. */
  readonly overlapChars?: number;
}

export interface Chunk {
  readonly content: string;
  /** 0-based ordinal position of this chunk within the source document. */
  readonly ord: number;
}

/**
 * Approximate token count from a character count.
 *
 * This is a deliberate APPROXIMATION (~4 chars per token for English text) so we
 * avoid a heavyweight `tiktoken` dependency. It is good enough for context-
 * budgeting and is what the `chunks.token_count` column stores. Replace with a
 * real tokenizer only if budgeting accuracy becomes a problem.
 */
export function approximateTokenCount(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Split Markdown into ordered, size-bounded chunks.
 *
 * Algorithm (purely deterministic):
 *   1. Split the document into "blocks" on blank lines, but keep a Markdown
 *      heading attached to the paragraph that follows it (a heading alone is
 *      poor retrieval context). This yields heading-led, paragraph-sized blocks.
 *   2. Greedily pack blocks into a chunk until adding the next block would
 *      exceed `maxChars`; then start a new chunk, seeding it with up to
 *      `overlapChars` of trailing text from the previous chunk.
 *   3. Any single block larger than `maxChars` is hard-split (on whitespace
 *      where possible) so the ceiling always holds.
 *
 * @param markdown the source Markdown body (may be empty).
 * @param opts     optional size/overlap overrides.
 * @returns ordered chunks; an empty array for empty/whitespace-only input.
 */
export function chunkMarkdown(markdown: string, opts: ChunkOptions = {}): Chunk[] {
  const maxChars = normalizePositive(opts.maxChars, DEFAULT_MAX_CHARS);
  // Overlap must be strictly smaller than maxChars, otherwise packing cannot
  // make forward progress. Clamp defensively.
  const overlapChars = Math.min(
    normalizeNonNegative(opts.overlapChars, DEFAULT_OVERLAP_CHARS),
    Math.max(0, maxChars - 1),
  );

  if (typeof markdown !== 'string') return [];
  const normalized = markdown.replace(/\r\n/g, '\n').trim();
  if (normalized === '') return [];

  const blocks = splitIntoBlocks(normalized);

  // Pre-split any oversized block so the packing loop only ever sees blocks
  // that individually fit within maxChars.
  const fittingBlocks: string[] = [];
  for (const block of blocks) {
    if (block.length <= maxChars) {
      fittingBlocks.push(block);
    } else {
      for (const piece of hardSplit(block, maxChars)) fittingBlocks.push(piece);
    }
  }

  const chunks: Chunk[] = [];
  let current = '';
  let ord = 0;

  const flush = (): void => {
    const trimmed = current.trim();
    if (trimmed !== '') {
      chunks.push({ content: trimmed, ord });
      ord += 1;
    }
    current = '';
  };

  for (const block of fittingBlocks) {
    if (current === '') {
      current = block;
      continue;
    }
    // +2 accounts for the "\n\n" separator we join blocks with.
    if (current.length + 2 + block.length <= maxChars) {
      current = `${current}\n\n${block}`;
    } else {
      // Close the current chunk, then seed the next one with overlap context.
      const overlap = overlapChars > 0 ? tailOverlap(current, overlapChars) : '';
      flush();
      current = overlap === '' ? block : `${overlap}\n\n${block}`;
      // If seeding with overlap pushed us back over the ceiling (possible when a
      // block is itself near maxChars), drop the overlap to keep the guarantee.
      if (current.length > maxChars) current = block;
    }
  }
  flush();

  return chunks;
}

/**
 * Split text into paragraph-ish blocks on blank lines, re-attaching a standalone
 * Markdown ATX heading (`#`..`######`) to the block that follows it so headings
 * never become orphan chunks.
 */
function splitIntoBlocks(text: string): string[] {
  const rawBlocks = text
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter((b) => b !== '');

  const merged: string[] = [];
  for (let i = 0; i < rawBlocks.length; i += 1) {
    const block = rawBlocks[i];
    if (block === undefined) continue;
    if (isHeadingOnly(block) && i + 1 < rawBlocks.length) {
      const next = rawBlocks[i + 1];
      if (next !== undefined) {
        merged.push(`${block}\n\n${next}`);
        i += 1; // consume the following block
        continue;
      }
    }
    merged.push(block);
  }
  return merged;
}

/** True when a block is a single ATX heading line and nothing else. */
function isHeadingOnly(block: string): boolean {
  return /^#{1,6}\s+\S/.test(block) && !block.includes('\n');
}

/**
 * Hard-split an oversized block into <= maxChars pieces, breaking on whitespace
 * where possible to avoid cutting mid-word; falls back to a hard character cut
 * when no whitespace break exists within the window. Never drops characters.
 */
function hardSplit(block: string, maxChars: number): string[] {
  const pieces: string[] = [];
  let rest = block;
  while (rest.length > maxChars) {
    const window = rest.slice(0, maxChars);
    // Prefer the last whitespace in the window so we cut on a word boundary.
    const lastWs = window.search(/\s\S*$/);
    // Only use the whitespace break if it leaves a reasonably full piece
    // (avoids degenerate tiny pieces when whitespace is near the start).
    const cut = lastWs > maxChars * 0.5 ? lastWs : maxChars;
    const head = rest.slice(0, cut).trim();
    if (head !== '') pieces.push(head);
    rest = rest.slice(cut);
  }
  const tail = rest.trim();
  if (tail !== '') pieces.push(tail);
  return pieces;
}

/**
 * Take up to `overlapChars` characters from the end of `text`, snapped forward
 * to the nearest whitespace so the overlap begins on a word boundary rather than
 * mid-word. Deterministic.
 */
function tailOverlap(text: string, overlapChars: number): string {
  if (text.length <= overlapChars) return text.trim();
  const tail = text.slice(text.length - overlapChars);
  const firstWs = tail.search(/\s/);
  const snapped = firstWs >= 0 ? tail.slice(firstWs + 1) : tail;
  return snapped.trim();
}

/** Coerce an optional positive integer option, falling back to a default. */
function normalizePositive(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.trunc(value);
}

/** Coerce an optional non-negative integer option, falling back to a default. */
function normalizeNonNegative(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value < 0) return fallback;
  return Math.trunc(value);
}
