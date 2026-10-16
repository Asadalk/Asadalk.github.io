// Copies onnxruntime-web's WASM runtime into public/ort/ so the YOLO demo
// never loads code from a CDN. Runs before dev and build.
import { cpSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const src = 'node_modules/onnxruntime-web/dist';
const dest = 'public/ort';
mkdirSync(dest, { recursive: true });
// jsep = WebGPU/JSEP build, asyncify = newer WebGPU build, plain = WASM-only.
const wanted = /^ort-wasm-simd-threaded(\.jsep|\.asyncify)?\.(mjs|wasm)$/;
for (const f of readdirSync(src).filter((f) => wanted.test(f))) cpSync(join(src, f), join(dest, f));
console.log('copied onnxruntime-web runtime to', dest);
