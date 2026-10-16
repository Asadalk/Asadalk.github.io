// YOLO11 pre- and post-processing, ported from Ultralytics 8.3.227 so the
// browser sees exactly what Python sees. Pure functions: no DOM, no ORT.
//
// Preprocessing (ultralytics/data/augment.py LetterBox, predictor.preprocess):
//   resize keeping aspect ratio with cv2.INTER_LINEAR (no antialiasing),
//   pad to a square with grey 114, RGB, CHW, ÷255. No mean/std normalization.
// Postprocessing (ultralytics/utils/nms.py non_max_suppression, ops.scale_boxes):
//   keep score > conf, greedy NMS at IoU > iou, max 300, undo the letterbox, clip.

export const MODEL_SIZE = 1280;
export const CONF = 0.25;
export const IOU = 0.7;
export const MAX_DET = 300;

/** Python's round(): halves go to the nearest even integer. */
export function pyRound(x: number): number {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

export interface Letterbox {
  /** Scale from original to resized pixels. */
  gain: number;
  /** Resized (unpadded) size. */
  newW: number;
  newH: number;
  /** Padding added on the left and top. */
  left: number;
  top: number;
}

export function letterbox(w: number, h: number, size = MODEL_SIZE): Letterbox {
  const gain = Math.min(size / h, size / w);
  const newW = pyRound(w * gain);
  const newH = pyRound(h * gain);
  const dw = (size - newW) / 2;
  const dh = (size - newH) / 2;
  return { gain, newW, newH, left: pyRound(dw - 0.1), top: pyRound(dh - 0.1) };
}

/** OpenCV's rounding (cvRound → rint): halves to even. */
const rint = pyRound;

/**
 * Per-output-pixel source index and 11-bit fixed-point weights, computed the
 * way OpenCV does: coordinates in float32 (Math.fround), weights rounded to
 * multiples of 1/2048 (INTER_RESIZE_COEF_BITS = 11).
 */
function taps(dst: number, src: number) {
  const scale = 1 / (dst / src);
  const index = new Int32Array(dst);
  const w0 = new Int32Array(dst);
  const w1 = new Int32Array(dst);
  for (let d = 0; d < dst; d++) {
    let f = Math.fround((d + 0.5) * scale - 0.5);
    let i = Math.floor(f);
    f = Math.fround(f - i);
    if (i < 0) { i = 0; f = 0; }
    if (i >= src - 1) { i = src - 1; f = 0; }
    index[d] = i;
    w0[d] = rint(Math.fround(Math.fround(1 - f) * 2048));
    w1[d] = rint(Math.fround(f * 2048));
  }
  return { index, w0, w1 };
}

/**
 * Letterbox RGBA pixels into a CHW float tensor in [0, 1].
 *
 * This is a bit-exact port of cv2.resize(INTER_LINEAR) for 8-bit images on
 * OpenCV's SIMD path: a horizontal pass in integers, then a vertical pass that
 * computes ((s0>>4)·b0 >> 16) + ((s1>>4)·b1 >> 16), rounded with +2 >> 2.
 * Verified to produce identical pixels to Ultralytics' LetterBox on real photos
 * (tests/parity/yolo). Canvas drawImage would antialias instead and shift boxes.
 */
export function toTensor(rgba: Uint8ClampedArray, w: number, h: number, lb: Letterbox, size = MODEL_SIZE): Float32Array {
  const plane = size * size;
  const out = new Float32Array(3 * plane).fill(114 / 255);
  const X = taps(lb.newW, w);
  const Y = taps(lb.newH, h);
  const mulHi = (a: number, b: number) => Math.floor((a * b) / 65536);

  for (let y = 0; y < lb.newH; y++) {
    const r0 = Y.index[y] * w * 4;
    const r1 = Math.min(Y.index[y] + 1, h - 1) * w * 4;
    const b0 = Y.w0[y];
    const b1 = Y.w1[y];
    const rowOut = (y + lb.top) * size + lb.left;
    for (let x = 0; x < lb.newW; x++) {
      const c0 = X.index[x] * 4;
      const c1 = Math.min(X.index[x] + 1, w - 1) * 4;
      const a0 = X.w0[x];
      const a1 = X.w1[x];
      const o = rowOut + x;
      for (let c = 0; c < 3; c++) {
        const s0 = rgba[r0 + c0 + c] * a0 + rgba[r0 + c1 + c] * a1;
        const s1 = rgba[r1 + c0 + c] * a0 + rgba[r1 + c1 + c] * a1;
        const v = (mulHi(s0 >> 4, b0) + mulHi(s1 >> 4, b1) + 2) >> 2;
        out[c * plane + o] = Math.min(255, Math.max(0, v)) / 255;
      }
    }
  }
  return out;
}

export interface Detection {
  /** x1, y1, x2, y2 in original-image pixels. */
  box: [number, number, number, number];
  score: number;
}

export function iou(a: number[], b: number[]): number {
  const iw = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]));
  const ih = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const inter = iw * ih;
  const union = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter;
  return union > 0 ? inter / union : 0;
}

/**
 * Decode the raw [1, 5, N] output (cx, cy, w, h, text-score per anchor),
 * run class-agnostic greedy NMS, and map boxes back to the original image.
 */
export function decode(
  output: Float32Array,
  anchors: number,
  lb: Letterbox,
  origW: number,
  origH: number,
  conf = CONF,
  iouThres = IOU,
): Detection[] {
  const cand: { box: number[]; score: number }[] = [];
  for (let i = 0; i < anchors; i++) {
    const score = output[4 * anchors + i];
    if (!(score > conf)) continue;
    const cx = output[i];
    const cy = output[anchors + i];
    const hw = output[2 * anchors + i] / 2;
    const hh = output[3 * anchors + i] / 2;
    cand.push({ box: [cx - hw, cy - hh, cx + hw, cy + hh], score });
  }
  cand.sort((a, b) => b.score - a.score);
  if (cand.length > 30000) cand.length = 30000;

  const keep: typeof cand = [];
  const suppressed = new Uint8Array(cand.length);
  for (let i = 0; i < cand.length && keep.length < MAX_DET; i++) {
    if (suppressed[i]) continue;
    keep.push(cand[i]);
    for (let j = i + 1; j < cand.length; j++) {
      if (!suppressed[j] && iou(cand[i].box, cand[j].box) > iouThres) suppressed[j] = 1;
    }
  }

  // scale_boxes recomputes the padding from the unrounded size (it can differ
  // from the letterbox's by a pixel), then undoes the resize and clips.
  const padX = pyRound((MODEL_SIZE - origW * lb.gain) / 2 - 0.1);
  const padY = pyRound((MODEL_SIZE - origH * lb.gain) / 2 - 0.1);
  const clip = (v: number, hi: number) => Math.min(Math.max(v, 0), hi);
  return keep.map(({ box, score }) => ({
    box: [
      clip((box[0] - padX) / lb.gain, origW),
      clip((box[1] - padY) / lb.gain, origH),
      clip((box[2] - padX) / lb.gain, origW),
      clip((box[3] - padY) / lb.gain, origH),
    ],
    score,
  }));
}
