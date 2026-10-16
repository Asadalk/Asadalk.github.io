// The lookup from the Cellular project's FastAPI backend (backend/main.py,
// POST /locate), reproduced over the 49-row tower sample from its repo.
// Exact match on all four identifiers, first row wins (LIMIT 1), fixed 1 km
// radius, explicit "tower_not_found". No nearest-neighbour guessing.

export interface Tower {
  mcc: number;
  mnc: number;
  tac: number;
  cid: number;
  lat: number;
  lon: number;
}

/** The fields of the app's CellPayload that /locate reads. */
export interface CellPayload {
  mcc: number;
  mnc: number;
  tac: number;
  cid: number;
}

export type LocateResponse = { lat: number; lon: number; radius: 1000 } | { error: 'tower_not_found' };

export const RADIUS_M = 1000;

/** The query in backend/main.py, as written there. */
export const SQL = `SELECT lat, lon
FROM cell_towers
WHERE mcc=%s AND mnc=%s AND tac=%s AND cid=%s
LIMIT 1;`;

export function locate(towers: Tower[], p: CellPayload): LocateResponse {
  const row = towers.find((t) => t.mcc === p.mcc && t.mnc === p.mnc && t.tac === p.tac && t.cid === p.cid);
  if (!row) return { error: 'tower_not_found' };
  return { lat: row.lat, lon: row.lon, radius: RADIUS_M };
}

export function isFound(r: LocateResponse): r is { lat: number; lon: number; radius: 1000 } {
  return !('error' in r);
}

export interface Sample {
  id: string;
  label: string;
  payload: CellPayload;
}

/** A handful of rows from tower_sample.csv, plus one cell that is not in it. */
export const SAMPLES: Sample[] = [
  { id: 'gujarat', label: 'Gujarat (the app’s test cell)', payload: { mcc: 404, mnc: 5, tac: 221, cid: 2171 } },
  { id: 'delhi', label: 'Delhi', payload: { mcc: 404, mnc: 10, tac: 310, cid: 27942 } },
  { id: 'mumbai', label: 'Mumbai', payload: { mcc: 405, mnc: 805, tac: 101, cid: 55963 } },
  { id: 'bengaluru', label: 'Bengaluru', payload: { mcc: 404, mnc: 45, tac: 61111, cid: 45842 } },
  { id: 'kochi', label: 'Kochi', payload: { mcc: 404, mnc: 46, tac: 101, cid: 10051 } },
  { id: 'chhattisgarh', label: 'Chhattisgarh', payload: { mcc: 404, mnc: 58, tac: 6043, cid: 60092 } },
  { id: 'unknown', label: 'Unknown: Delhi’s CID + 1', payload: { mcc: 404, mnc: 10, tac: 310, cid: 27943 } },
];

/** Equirectangular projection parameters written by scripts/build-india-outline.py. */
export interface MapOutline {
  lat0: number;
  lonMin: number;
  latMax: number;
  scale: number;
  width: number;
  height: number;
  d: string;
}

export function project(map: MapOutline, lat: number, lon: number): { x: number; y: number } {
  const kx = Math.cos((map.lat0 * Math.PI) / 180);
  return { x: (lon - map.lonMin) * kx * map.scale, y: (map.latMax - lat) * map.scale };
}

export interface Hop {
  key: string;
  title: string;
  where: string;
  /** Code or data shown for this hop. */
  code: string;
  lang: 'json' | 'sql' | 'kotlin' | 'text';
  note?: string;
}

/** The request's path through the system, filled in for one payload. */
export function hops(towers: Tower[], p: CellPayload): { hops: Hop[]; response: LocateResponse } {
  const response = locate(towers, p);
  const body = JSON.stringify({ mcc: p.mcc, mnc: p.mnc, tac: p.tac, cid: p.cid });
  const found = isFound(response);
  return {
    response,
    hops: [
      {
        key: 'android',
        title: 'Phone reads its serving cell',
        where: 'Android · TelephonyManager → CellInfoLte / CellInfoNr',
        code: `CellPayload(mcc = ${p.mcc}, mnc = ${p.mnc}, tac = ${p.tac}, cid = ${p.cid})`,
        lang: 'kotlin',
        note: 'Only the registered (serving) cell is used. On 5G NR the NCI is sent as the cell ID.',
      },
      {
        key: 'retrofit',
        title: 'Retrofit sends it to the backend',
        where: 'Retrofit 2.9 · POST /locate',
        code: `POST /locate\nContent-Type: application/json\n\n${body}`,
        lang: 'json',
        note: 'The app also sends rsrp (signal strength) when available; /locate ignores it.',
      },
      {
        key: 'fastapi',
        title: 'FastAPI reads the four identifiers',
        where: 'FastAPI · locate_cell(data)',
        code: `mcc = ${p.mcc}, mnc = ${p.mnc}, tac = ${p.tac}, cid = ${p.cid}`,
        lang: 'text',
      },
      {
        key: 'postgres',
        title: 'PostgreSQL: exact match',
        where: 'PostgreSQL · cell_towers',
        code: `${SQL}\n-- params: (${p.mcc}, ${p.mnc}, ${p.tac}, ${p.cid})\n-- ${found ? '1 row' : '0 rows'}`,
        lang: 'sql',
        note: 'All four values must match. A cell one digit away is a different cell.',
      },
      {
        key: 'response',
        title: found ? 'Response: tower found' : 'Response: tower not found',
        where: 'FastAPI → app',
        code: JSON.stringify(response),
        lang: 'json',
        note: found
          ? 'The radius is fixed at 1,000 m. It is not a measured accuracy.'
          : 'The failure is reported, not hidden behind a guess.',
      },
      {
        key: 'map',
        title: found ? 'The app draws a pin and a 1 km circle' : 'Nothing is drawn',
        where: 'osmdroid map (here: an offline outline of India)',
        code: found ? `lat ${response.lat}, lon ${response.lon}, radius ${response.radius} m` : 'body.error != null → "Tower not found"',
        lang: 'text',
      },
    ],
  };
}
