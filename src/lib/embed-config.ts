// Which model files are used where. Kept in one place so the worker, the
// build scripts and the parity test agree (see docs/decisions.md, Phase 4).

/** Folder under public/models/. */
export const MODEL_ID = 'all-MiniLM-L6-v2';

type Dtype = 'fp32' | 'fp16' | 'q8';
/**
 * Weights the visitor's browser downloads: onnx/model_fp16.onnx (45 MB).
 * The 8-bit file (23 MB) reordered 2 of the 8 evaluation queries; fp16
 * reorders none (tests/parity/semantic-hire/REPORT.md).
 */
export const BROWSER_DTYPE: Dtype = 'fp16';
/**
 * Weights the build scripts use for the stored vectors (content items and
 * jobs): onnx/model.onnx, full precision, never deployed (.gitignore).
 */
export const BUILD_DTYPE: Dtype = 'fp32';

/** onnxruntime-web's WASM build, copied to public/ort-embed/ by scripts/copy-ort-embed.mjs. */
export const ORT_WASM = {
  mjs: '/ort-embed/ort-wasm-simd-threaded.asyncify.mjs',
  wasm: '/ort-embed/ort-wasm-simd-threaded.asyncify.wasm',
} as const;
