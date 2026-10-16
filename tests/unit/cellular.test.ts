import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SAMPLES, hops, isFound, locate, project, type MapOutline, type Tower } from '../../src/lib/cellular';

const dir = join(__dirname, '../../src/content/data/cellular');
const towers: Tower[] = JSON.parse(readFileSync(join(dir, 'towers.json'), 'utf8'));
const india: MapOutline = JSON.parse(readFileSync(join(dir, 'india.json'), 'utf8'));
const csvRows = readFileSync(join(dir, 'tower_sample.csv'), 'utf8').trim().split('\n').slice(1);

describe('towers.json', () => {
  it('is the CSV, row for row', () => {
    expect(towers).toHaveLength(49);
    expect(csvRows).toHaveLength(49);
    csvRows.forEach((line, i) => {
      const [mcc, mnc, tac, cid, lat, lon] = line.split(',').map(Number);
      expect(towers[i]).toEqual({ mcc, mnc, tac, cid, lat, lon });
    });
  });
});

describe('locate (exact match, as in backend/main.py)', () => {
  it('finds a known cell and returns its coordinates with a fixed 1000 m radius', () => {
    expect(locate(towers, { mcc: 404, mnc: 5, tac: 221, cid: 2171 })).toEqual({
      lat: 20.913162231445,
      lon: 70.380477905273,
      radius: 1000,
    });
  });

  it('returns tower_not_found when any one identifier differs', () => {
    const known = { mcc: 404, mnc: 10, tac: 310, cid: 27942 };
    expect(isFound(locate(towers, known))).toBe(true);
    for (const k of ['mcc', 'mnc', 'tac', 'cid'] as const) {
      expect(locate(towers, { ...known, [k]: known[k] + 1 }), k).toEqual({ error: 'tower_not_found' });
    }
  });

  it('two cells on the same site resolve to the same coordinates', () => {
    // Two rows of the sample share coordinates but have different CIDs.
    const a = locate(towers, { mcc: 404, mnc: 45, tac: 61011, cid: 10533 });
    const b = locate(towers, { mcc: 404, mnc: 45, tac: 61011, cid: 63271 });
    expect(a).toEqual(b);
  });
});

describe('samples', () => {
  it('every known sample is a row of the CSV, and the unknown one is not', () => {
    for (const s of SAMPLES) {
      const found = isFound(locate(towers, s.payload));
      expect(found, s.id).toBe(s.id !== 'unknown');
    }
  });

  it('every found sample projects inside the India outline box', () => {
    for (const s of SAMPLES.filter((x) => x.id !== 'unknown')) {
      const r = locate(towers, s.payload);
      if (!isFound(r)) throw new Error(s.id);
      const { x, y } = project(india, r.lat, r.lon);
      expect(x).toBeGreaterThan(0);
      expect(x).toBeLessThan(india.width);
      expect(y).toBeGreaterThan(0);
      expect(y).toBeLessThan(india.height);
    }
  });

  it('hops end in the response the lookup gave', () => {
    const h = hops(towers, SAMPLES.find((s) => s.id === 'unknown')!.payload);
    expect(h.hops.map((x) => x.key)).toEqual(['android', 'retrofit', 'fastapi', 'postgres', 'response', 'map']);
    expect(h.hops[4].code).toBe('{"error":"tower_not_found"}');
    expect(h.hops[3].code).toContain('0 rows');
  });
});

describe('india.json', () => {
  it('is small and self-contained', () => {
    expect(readFileSync(join(dir, 'india.json')).length).toBeLessThan(40_000);
    expect(india.d.startsWith('M')).toBe(true);
  });
});
