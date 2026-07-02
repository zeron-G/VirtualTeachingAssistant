import { describe, it, expect } from 'vitest';
import type { Citation } from '@vta/shared';

import { verifyCitations, UNVERIFIED_SOURCE_MARKER } from './citationCheck.js';

const web = (url: string, title = 't'): Citation => ({ sourceId: url, title, locator: url });
const course: Citation = { sourceId: 'material-uuid-1', title: 'Module 3', locator: 'chunk 2' };

describe('verifyCitations', () => {
  it('keeps a URL that matches a real captured web source', () => {
    const r = verifyCitations(
      'Paris is the capital (https://example.edu/geo).',
      [web('https://example.edu/geo')],
    );
    expect(r.fabricatedCount).toBe(0);
    expect(r.text).toContain('https://example.edu/geo');
  });

  it('strips a URL the model invented (not in any captured source)', () => {
    const r = verifyCitations(
      'See https://totally-made-up.example/fake for details.',
      [web('https://example.edu/geo')],
    );
    expect(r.fabricatedCount).toBe(1);
    expect(r.text).toContain(UNVERIFIED_SOURCE_MARKER);
    expect(r.text).not.toContain('totally-made-up');
  });

  it('matches despite trailing punctuation and a trailing slash', () => {
    const r = verifyCitations(
      'Source: https://example.edu/geo/.',
      [web('https://example.edu/geo')],
    );
    expect(r.fabricatedCount).toBe(0);
  });

  it('ignores course-material citations (no URL) and leaves plain text untouched', () => {
    const r = verifyCitations('Neural nets learn weights (Module 3).', [course]);
    expect(r.fabricatedCount).toBe(0);
    expect(r.text).toBe('Neural nets learn weights (Module 3).');
  });

  it('strips fabricated while keeping real in the same answer', () => {
    const r = verifyCitations(
      'Real https://ok.example/a and fake https://bad.example/b.',
      [web('https://ok.example/a')],
    );
    expect(r.fabricatedCount).toBe(1);
    expect(r.text).toContain('https://ok.example/a');
    expect(r.text).not.toContain('bad.example');
  });

  // --- Regressions from the adversarial review ---

  it('KEEPS a real URL containing parentheses (Wikipedia disambiguation)', () => {
    const url = 'https://en.wikipedia.org/wiki/Python_(programming_language)';
    const r = verifyCitations(`See ${url} for details.`, [web(url)]);
    expect(r.fabricatedCount).toBe(0);
    expect(r.text).toContain(url); // not truncated at '('
  });

  it('unwraps a FABRICATED markdown link to plain label + marker (no dangling markdown)', () => {
    const r = verifyCitations(
      'Check the [official syllabus](https://fabricated.edu/course).',
      [web('https://ok.example/a')],
    );
    expect(r.fabricatedCount).toBe(1);
    expect(r.text).not.toContain('fabricated.edu');
    expect(r.text).not.toContain('](' ); // no malformed markdown link remains
    expect(r.text).toContain('official syllabus');
  });

  it('keeps a REAL markdown link intact', () => {
    const r = verifyCitations(
      'See [the docs](https://ok.example/a/).',
      [web('https://ok.example/a')],
    );
    expect(r.fabricatedCount).toBe(0);
    expect(r.text).toContain('[the docs](https://ok.example/a/)');
  });

  it('treats a case-variant path as a DIFFERENT resource (strips it)', () => {
    // path case is significant; a variant of a real URL is not the real source.
    const r = verifyCitations('See https://host.edu/docs/secret here.', [
      web('https://host.edu/Docs/Secret'),
    ]);
    expect(r.fabricatedCount).toBe(1);
    // but scheme+host case is NOT significant:
    const r2 = verifyCitations('See https://HOST.edu/Docs/Secret here.', [
      web('https://host.edu/Docs/Secret'),
    ]);
    expect(r2.fabricatedCount).toBe(0);
  });

  it('matches URLs with query strings and fragments', () => {
    const url = 'https://x.example/a?b=1&c=2#frag';
    const r = verifyCitations(`Ref: ${url}`, [web(url)]);
    expect(r.fabricatedCount).toBe(0);
  });
});
