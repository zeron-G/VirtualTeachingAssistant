/**
 * Unit tests for {@link CompositeInjectionDetector} — the OR-combiner that pairs
 * the fast heuristic with a model-backed detector, with graceful degradation.
 */

import { describe, expect, it } from 'vitest';

import { CompositeInjectionDetector } from './defaults.js';
import type { InjectionDetector } from './ports.js';

const clean: InjectionDetector = { detect: () => Promise.resolve({ injection: false, score: 0.1 }) };
const flags: InjectionDetector = { detect: () => Promise.resolve({ injection: true, reason: 'r' }) };
const throws: InjectionDetector = {
  detect: () => Promise.reject(new Error('detector down')),
};

describe('CompositeInjectionDetector', () => {
  it('flags when any detector flags', async () => {
    const d = new CompositeInjectionDetector([clean, flags]);
    expect((await d.detect('x')).injection).toBe(true);
  });

  it('returns clean (max score) when all detectors pass', async () => {
    const d = new CompositeInjectionDetector([clean, clean]);
    const r = await d.detect('x');
    expect(r.injection).toBe(false);
    expect(r.score).toBe(0.1);
  });

  it('tolerates a thrown detector when another succeeds (degrade, not block)', async () => {
    const d = new CompositeInjectionDetector([clean, throws]);
    expect((await d.detect('x')).injection).toBe(false);
  });

  it('still flags when a surviving detector flags and another throws', async () => {
    const d = new CompositeInjectionDetector([throws, flags]);
    expect((await d.detect('x')).injection).toBe(true);
  });

  it('rethrows when EVERY detector throws (fail-safe → ingress blocks)', async () => {
    const d = new CompositeInjectionDetector([throws, throws]);
    await expect(d.detect('x')).rejects.toThrow();
  });
});
