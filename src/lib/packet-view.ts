// HTML for "Follow the packet" (build-time fallback and browser).
import { esc } from './html';
import { RADIUS_M, isFound, project, type Hop, type LocateResponse, type MapOutline } from './cellular';

export function renderHop(h: Hop, n: number, total: number, heading = 'h5'): string {
  return `<article class="hop" data-hop="${esc(h.key)}">
    <${heading} class="step-title"><span class="hop-n mono">${n}/${total}</span> <span>${esc(h.title)}</span></${heading}>
    <p class="step-time mono">${esc(h.where)}</p>
    <pre class="code" data-lang="${h.lang}"><code>${esc(h.code)}</code></pre>
    ${h.note ? `<p class="step-note">${esc(h.note)}</p>` : ''}
  </article>`;
}

// The inset shows a 5 km × 5 km square around the tower, so the fixed
// 1 km radius can be drawn to scale (on the India outline it is < 1 unit).
const INSET = { size: 110, km: 5 };

/**
 * India outline with an optional pin. `show` false draws the map without it
 * (used while the packet is still on its way).
 */
export function renderMap(map: MapOutline, response: LocateResponse | null, show = true): string {
  const found = response && isFound(response) && show;
  const pad = 6;
  const w = map.width + pad * 2;
  const h = map.height + pad * 2;
  let pin = '';
  let inset = '';
  if (found) {
    const { x, y } = project(map, response.lat, response.lon);
    pin = `<g class="pin" data-pin transform="translate(${(x + pad).toFixed(1)} ${(y + pad).toFixed(1)})">
      <circle r="9" class="pin-halo"/><circle r="4" class="pin-dot"/></g>`;
    const unitsPerKm = INSET.size / INSET.km;
    const r = (RADIUS_M / 1000) * unitsPerKm;
    const ix = pad + 4;
    const iy = h - INSET.size - pad - 22;
    const c = INSET.size / 2;
    inset = `<g class="inset" transform="translate(${ix} ${iy})">
      <rect width="${INSET.size}" height="${INSET.size}" class="inset-box"/>
      <circle cx="${c}" cy="${c}" r="${r}" class="radius"/>
      <circle cx="${c}" cy="${c}" r="3" class="pin-dot"/>
      <line x1="8" x2="${8 + unitsPerKm}" y1="${INSET.size - 10}" y2="${INSET.size - 10}" class="scale"/>
      <text x="8" y="${INSET.size - 14}" class="map-label">1 km</text>
      <text x="0" y="${INSET.size + 14}" class="map-label">1 km circle, to scale</text>
    </g>`;
  }
  return `<svg class="india" viewBox="0 0 ${w} ${h.toFixed(1)}" role="img" aria-labelledby="india-t">
    <title id="india-t">${found ? `Outline of India with a pin at latitude ${response.lat}, longitude ${response.lon}` : 'Outline of India, no tower drawn'}</title>
    <path d="${map.d}" transform="translate(${pad} ${pad})" class="land"/>
    ${pin}${inset}
  </svg>`;
}

export const ATTRIBUTION =
  'Tower data: OpenCellID, CC BY-SA 4.0, via a Kaggle sample. Map outline: Natural Earth (public domain), India point of view.';
