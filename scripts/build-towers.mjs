// Converts the Cellular repo's tower sample (dataset/tower_sample.csv, copied
// verbatim to src/content/data/cellular/tower_sample.csv) into towers.json for
// the "Follow the packet" demo. Runs before every build (npm "prebuild").
//
// Tower data: OpenCellID, CC BY-SA 4.0, via a Kaggle sample.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dir = new URL('../src/content/data/cellular/', import.meta.url);
const csv = readFileSync(new URL('tower_sample.csv', dir), 'utf8').trim().split(/\r?\n/);
const header = csv[0].split(',');
const expected = ['mcc', 'mnc', 'tac', 'cid', 'lat', 'lon'];
if (header.join() !== expected.join()) throw new Error(`Unexpected CSV header: ${header.join()}`);

const towers = csv.slice(1).map((line, i) => {
  const cells = line.split(',');
  if (cells.length !== 6) throw new Error(`Row ${i + 2}: expected 6 columns`);
  const [mcc, mnc, tac, cid] = cells.slice(0, 4).map((v) => {
    if (!/^\d+$/.test(v)) throw new Error(`Row ${i + 2}: "${v}" is not an integer`);
    return Number(v);
  });
  const [lat, lon] = cells.slice(4).map(Number);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error(`Row ${i + 2}: bad coordinates`);
  return { mcc, mnc, tac, cid, lat, lon };
});

const out = fileURLToPath(new URL('towers.json', dir));
writeFileSync(out, JSON.stringify(towers) + '\n');
console.log(`towers.json: ${towers.length} towers`);
