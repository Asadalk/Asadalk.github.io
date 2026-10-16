/// <reference lib="webworker" />
// Runs the fine-tuned YOLO11n text detector off the main thread.
// WebGPU when the browser has it, single-threaded WASM otherwise (GitHub Pages
// can't send the COOP/COEP headers that multi-threaded WASM needs).
import * as ort from 'onnxruntime-web/webgpu';
import { MODEL_SIZE, decode, letterbox, toTensor } from '../lib/yolo';

type Prefer = 'webgpu' | 'wasm' | undefined;
export type WorkerIn = { type: 'load'; prefer?: Prefer } | { type: 'detect'; id: number; file: Blob; prefer?: Prefer };
export type WorkerOut =
  | { type: 'progress'; loaded: number; total: number }
  | { type: 'ready'; backend: 'webgpu' | 'wasm' }
  | { type: 'result'; id: number; width: number; height: number; detections: { box: number[]; score: number }[]; timings: Record<string, number>; backend: string }
  | { type: 'error'; id?: number; message: string };

const MODEL_URL = '/models/yolo11n-bstd.onnx';
ort.env.wasm.wasmPaths = '/ort/';
ort.env.wasm.numThreads = 1;

const post = (m: WorkerOut) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m);
let session: Promise<{ s: ort.InferenceSession; backend: 'webgpu' | 'wasm' }> | null = null;

async function fetchModel(): Promise<Uint8Array> {
  const res = await fetch(MODEL_URL);
  if (!res.ok || !res.body) throw new Error(`model download failed (${res.status})`);
  const total = Number(res.headers.get('content-length')) || 10_600_000;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    post({ type: 'progress', loaded, total });
  }
  const buf = new Uint8Array(loaded);
  let o = 0;
  for (const c of chunks) {
    buf.set(c, o);
    o += c.length;
  }
  return buf;
}

function load(prefer?: Prefer) {
  session ??= (async () => {
    const model = await fetchModel();
    const hasGpu = prefer !== 'wasm' && 'gpu' in navigator && !!(await (navigator as Navigator & { gpu: { requestAdapter(): Promise<unknown> } }).gpu.requestAdapter().catch(() => null));
    if (hasGpu) {
      try {
        const s = await ort.InferenceSession.create(model, { executionProviders: ['webgpu'] });
        return { s, backend: 'webgpu' as const };
      } catch {
        // Fall through to WASM.
      }
    }
    const s = await ort.InferenceSession.create(model, { executionProviders: ['wasm'] });
    return { s, backend: 'wasm' as const };
  })();
  session.catch(() => (session = null));
  return session;
}

async function detect(id: number, file: Blob, prefer?: Prefer) {
  const t0 = performance.now();
  const { s, backend } = await load(prefer);
  const t1 = performance.now();

  // createImageBitmap applies EXIF orientation, like cv2.imread does.
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const { width, height } = bitmap;
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const rgba = ctx.getImageData(0, 0, width, height).data;
  const t2 = performance.now();

  const lb = letterbox(width, height);
  const input = new ort.Tensor('float32', toTensor(rgba, width, height, lb), [1, 3, MODEL_SIZE, MODEL_SIZE]);
  const t3 = performance.now();

  const out = await s.run({ [s.inputNames[0]]: input });
  const output = out[s.outputNames[0]];
  const data = (await output.getData()) as Float32Array;
  const t4 = performance.now();

  const anchors = output.dims[2];
  const detections = decode(data, anchors, lb, width, height);
  const t5 = performance.now();
  input.dispose();
  output.dispose();

  post({
    type: 'result',
    id,
    width,
    height,
    detections,
    backend,
    timings: { load: t1 - t0, decode: t2 - t1, preprocess: t3 - t2, inference: t4 - t3, postprocess: t5 - t4 },
  });
}

self.onmessage = (e: MessageEvent<WorkerIn>) => {
  const m = e.data;
  if (m.type === 'load') {
    load(m.prefer).then(
      ({ backend }) => post({ type: 'ready', backend }),
      (err) => post({ type: 'error', message: String(err?.message ?? err) }),
    );
  } else if (m.type === 'detect') {
    detect(m.id, m.file, m.prefer).catch((err) => post({ type: 'error', id: m.id, message: String(err?.message ?? err) }));
  }
};
