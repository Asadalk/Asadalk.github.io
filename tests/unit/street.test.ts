import { describe, expect, it } from 'vitest';
import { detectionBox, labelWidth, rotatedBounds, rng, signLook, tallScene, wideScene, type Box } from '../../src/lib/street';
import { site } from '../../src/lib/content';

const overlap = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('detection boxes', () => {
  it('upright bounds of a tilted board contain all four corners', () => {
    const b = { x: 10, y: 20, w: 200, h: 70 };
    const a = rotatedBounds(b, -1.8);
    expect(a.w).toBeGreaterThan(b.w);
    expect(a.h).toBeGreaterThan(b.h);
    expect(rotatedBounds(b, 0)).toEqual(b);
  });

  it('rng is deterministic', () => {
    const a = rng(3);
    const b = rng(3);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });

  for (const scene of [wideScene(site.signboards), tallScene(site.signboards)]) {
    describe(`${scene.id} scene`, () => {
      const regions = scene.shops.map((shop) => {
        const look = signLook[shop.target];
        const box = detectionBox(shop.sign, look.tilt);
        const label = { x: box.x - 1, y: box.y - 21, w: labelWidth(`${shop.target} ${look.conf}`), h: 21 };
        return { target: shop.target, box, label, sign: shop.sign };
      });

      it('has one signboard per section', () => {
        expect(scene.shops.map((s) => s.target).sort()).toEqual(site.signboards.map((s) => s.target).sort());
      });

      it('keeps every box and label inside the frame', () => {
        for (const r of regions) {
          for (const b of [r.box, r.label]) {
            expect(b.x, r.target).toBeGreaterThanOrEqual(0);
            expect(b.y, r.target).toBeGreaterThanOrEqual(0);
            expect(b.x + b.w, r.target).toBeLessThanOrEqual(scene.width);
            expect(b.y + b.h, r.target).toBeLessThanOrEqual(scene.ground);
          }
        }
      });

      it('never overlaps one shop’s box or label with another’s', () => {
        for (const a of regions) {
          for (const b of regions) {
            if (a === b) continue;
            for (const ra of [a.box, a.label]) {
              for (const rb of [b.box, b.label]) expect(overlap(ra, rb), `${a.target} vs ${b.target}`).toBe(false);
            }
          }
        }
      });

      it('labels fit on their box', () => {
        for (const r of regions) expect(r.label.w, r.target).toBeLessThanOrEqual(r.box.w + 2);
      });
    });
  }
});
