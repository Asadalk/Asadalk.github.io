// Geometry for the "Read the Street" hero. Pure and deterministic: the same
// input always yields the same scene, so it renders at build time and can be
// tested. Two layouts share one vocabulary: a wide street of five shopfronts
// (desktop) and one tall market building with stacked signboards (phones).

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SignLook {
  bg: string;
  fg: string;
  /** Mock detector confidence shown on the box label. */
  conf: string;
  /** Hand-hung boards are rarely level. Degrees. */
  tilt?: number;
}

export const signLook: Record<string, SignLook> = {
  about: { bg: 'var(--sign-neem)', fg: 'var(--sign-light)', conf: '0.93' },
  research: { bg: 'var(--sign-brick)', fg: 'var(--sign-light)', conf: '0.97' },
  projects: { bg: 'var(--sign-kohl)', fg: 'var(--sign-light)', conf: '0.95', tilt: -1.8 },
  experience: { bg: 'var(--sign-plaster)', fg: 'var(--sign-brick)', conf: '0.88' },
  contact: { bg: 'var(--sign-mauve)', fg: 'var(--sign-light)', conf: '0.91' },
};

/** Margin between a signboard and its detection box. */
const BOX_MARGIN = 7;
/** Martian Mono advance width at the 12-unit label size (measured ≈ 0.72em). */
const LABEL_CHAR = 8.7;

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Axis-aligned bounds of a box rotated about its centre: a real detector
 *  draws upright boxes even around tilted boards. */
export function rotatedBounds(b: Box, tiltDeg = 0): Box {
  const t = (Math.abs(tiltDeg) * Math.PI) / 180;
  const w = b.w * Math.cos(t) + b.h * Math.sin(t);
  const h = b.w * Math.sin(t) + b.h * Math.cos(t);
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

export function detectionBox(sign: Box, tiltDeg = 0): Box {
  const a = rotatedBounds(sign, tiltDeg);
  return {
    x: r1(a.x - BOX_MARGIN),
    y: r1(a.y - BOX_MARGIN),
    w: r1(a.w + 2 * BOX_MARGIN),
    h: r1(a.h + 2 * BOX_MARGIN),
  };
}

export function labelWidth(text: string): number {
  return r1(text.length * LABEL_CHAR + 12);
}

/** Small LCG so "random" windows and skylines are identical on every build. */
export function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Point on a quadratic Bézier, for sitting birds on wires. */
export function quadPoint(
  a: [number, number],
  c: [number, number],
  b: [number, number],
  t: number,
): [number, number] {
  const u = 1 - t;
  return [r1(u * u * a[0] + 2 * u * t * c[0] + t * t * b[0]), r1(u * u * a[1] + 2 * u * t * c[1] + t * t * b[1])];
}

/** A sagging wire from a to b. The curve's lowest point sits `sag` below the chord. */
export function wire(a: [number, number], b: [number, number], sag: number) {
  const c: [number, number] = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2 + 2 * sag];
  return { d: `M${a[0]} ${a[1]}Q${c[0]} ${c[1]} ${b[0]} ${b[1]}`, a, c, b };
}

export interface SkylineBlock {
  x: number;
  y: number;
  w: number;
  h: number;
  tone: 1 | 2;
  tank?: Box;
  mast?: number;
}

export function skyline(seed: number, width: number, base: number, minTop: number, maxTop: number): SkylineBlock[] {
  const rand = rng(seed);
  const out: SkylineBlock[] = [];
  let x = -12;
  while (x < width + 12) {
    const w = r1(46 + rand() * 88);
    const y = r1(minTop + rand() * (maxTop - minTop));
    const block: SkylineBlock = { x: r1(x), y, w, h: r1(base - y), tone: rand() < 0.5 ? 1 : 2 };
    const roll = rand();
    if (roll < 0.45) block.tank = { x: r1(x + 8 + rand() * (w - 40)), y: r1(y - 20), w: 24, h: 20 };
    else if (roll < 0.6) block.mast = r1(x + w * 0.3);
    out.push(block);
    x += w - 2;
  }
  return out;
}

export interface Shop {
  target: string;
  en: string;
  hi: string;
  sign: Box;
  hiSize: number;
  enSize: number;
}

export interface Window {
  x: number;
  y: number;
  w: number;
  h: number;
  lit: boolean;
}

export interface Facade {
  x: number;
  y: number;
  w: number;
  h: number;
  wall: string;
  windows: Window[];
  rails: { x1: number; x2: number; y: number }[];
  bricks: Box[];
  tank?: Box;
}

export interface Shutter extends Box {
  open?: number;
  plaque?: string;
}

export interface Scene {
  id: 'wide' | 'tall';
  width: number;
  height: number;
  ground: number;
  sun: { cx: number; cy: number; r: number };
  skyline: SkylineBlock[];
  tower: { x: number; top: number; base: number };
  facades: Facade[];
  shutters: Shutter[];
  poles: { x: number; top: number }[];
  wires: ReturnType<typeof wire>[];
  birds: [number, number][];
  bicycle: { x: number; y: number };
  shops: Shop[];
}

function windowsFor(x: number, top: number, bottom: number, cols: number[], rand: () => number) {
  const windows: Window[] = [];
  const rails: Facade['rails'] = [];
  for (let y = top + 30; y + 52 <= bottom; y += 76) {
    for (const cx of cols) windows.push({ x: r1(x + cx), y: r1(y), w: 52, h: 46, lit: rand() < 0.45 });
    rails.push({ x1: r1(x + cols[0] - 8), x2: r1(x + cols[cols.length - 1] + 60), y: r1(y + 52) });
  }
  return { windows, rails };
}

/** An irregular patch where plaster has fallen off and brick shows. */
function brickPatch(x: number, y: number, rand: () => number): Box[] {
  const bricks: Box[] = [];
  const rows = 4;
  for (let r = 0; r < rows; r++) {
    const n = 2 + Math.floor(rand() * 2) + (r === 1 || r === 2 ? 1 : 0);
    const offset = r % 2 ? 8 : 0;
    for (let i = 0; i < n; i++) bricks.push({ x: r1(x + offset + i * 17), y: r1(y + r * 8), w: 15, h: 6 });
  }
  return bricks;
}

type SignboardText = { target: string; en: string; hi: string };

export function wideScene(signs: SignboardText[]): Scene {
  const rand = rng(7);
  const ground = 520;
  const tops = [168, 118, 186, 140, 200];
  const walls = ['var(--wall-a)', 'var(--wall-b)', 'var(--wall-c)', 'var(--wall-a)', 'var(--wall-b)'];
  const facades: Facade[] = [];
  const shutters: Shutter[] = [];
  const shops: Shop[] = [];
  signs.forEach((s, i) => {
    const x = 20 + i * 234;
    const top = tops[i];
    const { windows, rails } = windowsFor(x, top, 286, [34, 136], rand);
    facades.push({
      x,
      y: top,
      w: 222,
      h: ground - top,
      wall: walls[i],
      windows,
      rails,
      bricks: i === 1 || i === 3 ? brickPatch(x + 150, 336 - (i === 3 ? 4 : 0), rand) : [],
      tank: i === 0 || i === 3 ? { x: x + 148, y: top - 30, w: 34, h: 30 } : undefined,
    });
    shutters.push({
      x: x + 14,
      y: 388,
      w: 194,
      h: ground - 388,
      open: s.target === 'research' ? 66 : s.target === 'about' ? 30 : undefined,
      plaque: s.target === 'contact' ? 'STD · ISD · PCO' : undefined,
    });
    shops.push({ ...s, sign: { x: x + 14, y: 290, w: 194, h: 74 }, hiSize: 27, enSize: 19 });
  });

  const p1 = 470;
  const p2 = 944;
  const wires = [0, 1, 2].map((k) => {
    const dx = (k - 1) * 17;
    return [
      wire([-20, 116 + k * 7], [p1 + dx, 103], 14),
      wire([p1 + dx, 103], [p2 + dx, 103], 24 + k * 3),
      wire([p2 + dx, 103], [1220, 120 + k * 7], 12),
    ];
  });
  const mid = wires[1][1];
  const birds = [0.36, 0.43].map((t) => quadPoint(mid.a, mid.c, mid.b, t));

  return {
    id: 'wide',
    width: 1200,
    height: 600,
    ground,
    sun: { cx: 760, cy: 128, r: 44 },
    skyline: skyline(11, 1200, 330, 150, 290),
    tower: { x: 1118, top: 52, base: 330 },
    facades,
    shutters,
    poles: [{ x: p1, top: 92 }, { x: p2, top: 92 }],
    wires: wires.flat(),
    birds,
    bicycle: { x: 610, y: 566 },
    shops,
  };
}

export function tallScene(signs: SignboardText[]): Scene {
  const ground = 584;
  const by = (t: string) => signs.find((s) => s.target === t)!;
  const layout: Record<string, [Box, number, number]> = {
    research: [{ x: 24, y: 148, w: 352, h: 86 }, 34, 22],
    about: [{ x: 24, y: 274, w: 166, h: 72 }, 25, 17],
    experience: [{ x: 210, y: 274, w: 166, h: 72 }, 25, 17],
    projects: [{ x: 26, y: 388, w: 196, h: 76 }, 26, 18],
    contact: [{ x: 242, y: 388, w: 134, h: 76 }, 25, 17],
  };
  const order = ['research', 'about', 'experience', 'projects', 'contact'];
  const shops: Shop[] = order.map((t) => {
    const [sign, hiSize, enSize] = layout[t];
    return { ...by(t), sign, hiSize, enSize };
  });

  const facades: Facade[] = [
    {
      x: 8,
      y: 116,
      w: 384,
      h: ground - 116,
      wall: 'var(--wall-a)',
      windows: [],
      rails: [],
      bricks: [],
      tank: { x: 58, y: 86, w: 34, h: 30 },
    },
  ];
  const shutters: Shutter[] = [
    { x: 20, y: 492, w: 116, h: ground - 492, open: 34 },
    { x: 142, y: 492, w: 116, h: ground - 492 },
    { x: 264, y: 492, w: 116, h: ground - 492, plaque: 'STD · PCO' },
  ];
  const wires = [0, 1].map((k) => wire([-12, 70 + k * 8], [412, 58 + k * 8], 16 + k * 3));
  const birds = [quadPoint(wires[0].a, wires[0].c, wires[0].b, 0.62)];

  return {
    id: 'tall',
    width: 400,
    height: 660,
    ground,
    sun: { cx: 250, cy: 62, r: 30 },
    skyline: skyline(5, 400, 200, 70, 160),
    tower: { x: 352, top: 14, base: 200 },
    facades,
    shutters,
    poles: [],
    wires,
    birds,
    bicycle: { x: 300, y: 628 },
    shops,
  };
}
