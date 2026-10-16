// Tuning tests: they justify the chosen α and drift threshold with simulated
// visitors over synthetic 384-d topic clusters. The numbers are recorded in
// docs/decisions.md (Phase 5).
import { describe, expect, test } from 'vitest';
import { DEFAULT_MODEL_CONFIG } from '../../../src/brain/model';
import { DEFAULT_PACING } from '../../../src/brain/pacing';
import { makeFixture } from '../fixtures/items';
import { accuracy, driftSamples, recentDriftSamples, switchLag } from '../fixtures/sim';

const fx = makeFixture({ perCluster: 20 });
const ALPHA = DEFAULT_MODEL_CONFIG.alpha;
const share = (xs: number[], pred: (x: number) => boolean) => xs.filter(pred).length / xs.length;

describe('α (EMA rate)', () => {
  test('chosen α is 0.3, the top of the 0.15–0.3 range', () => {
    expect(ALPHA).toBe(0.3);
  });

  test('accurate for a steady visitor even with 30% off-topic clicks', () => {
    // Share of steps where the best next item is on the visitor's real topic.
    expect(accuracy(fx, ALPHA, 30)).toBeGreaterThanOrEqual(0.95);
  });

  test('follows a change of interest within ~5 signals; small α is far too slow', () => {
    expect(switchLag(fx, ALPHA, 30)).toBeLessThanOrEqual(6);
    expect(switchLag(fx, 0.1, 30)).toBeGreaterThan(12);
  });

  test('larger α chases noise: worse with 50% off-topic clicks', () => {
    expect(accuracy(fx, ALPHA, 30, 0.5)).toBeGreaterThan(accuracy(fx, 0.5, 30, 0.5));
    expect(accuracy(fx, ALPHA, 30, 0.5)).toBeGreaterThan(accuracy(fx, 0.15, 30, 0.5));
  });
}, 60_000);

describe('drift threshold', () => {
  test('profile-vs-profile distance cannot separate noise from a real change (why it is not used)', () => {
    const d = driftSamples(fx, ALPHA, { gap: 6, noise: 0.2 });
    // A steady visitor's profile wanders as far as a switcher's does after 6 signals.
    expect(d.stableP95).toBeGreaterThan(d.switchedP05);
  });

  test(`recent-interest drift > ${DEFAULT_PACING.drift} (after ≥${DEFAULT_PACING.minRecent} signals) separates them`, () => {
    const T = DEFAULT_PACING.drift;
    const d = recentDriftSamples(fx, ALPHA, { gap: 8, noise: 0.2, minRecent: DEFAULT_PACING.minRecent });
    // A focused visitor (≈13% off-topic) almost never trips it, even at the worst moment…
    expect(share(d.stable, (x) => x > T)).toBeLessThanOrEqual(0.05);
    // …while most visitors who really switched trip it within 8 signals.
    expect(share(d.switched, (x) => x > T)).toBeGreaterThanOrEqual(0.75);
  });

  test('the spec’s starting point 0.25 would often fire for steady visitors', () => {
    const d = recentDriftSamples(fx, ALPHA, { gap: 8, noise: 0.2, minRecent: DEFAULT_PACING.minRecent });
    expect(share(d.stable, (x) => x > 0.25)).toBeGreaterThan(0.2);
  });
}, 60_000);
