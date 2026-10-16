// Copies the onnxruntime-web WASM runtime that transformers.js uses into
// public/ort-embed/, so the browser loads it from this site instead of a CDN.
// Runs before `dev` and `build`. public/ort/ belongs to the YOLO demo (Phase 3).
import { copyFile, mkdir, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ORT_WASM } from '../src/lib/embed-config.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// transformers.js may pin its own onnxruntime-web; prefer that nested copy.
const candidates = [
  join(root, 'node_modules/@huggingface/transformers/node_modules/onnxruntime-web'),
  join(root, 'node_modules/onnxruntime-web'),
];
const ortDir = candidates.find((d) => existsSync(join(d, 'package.json')));
if (!ortDir) throw new Error('onnxruntime-web not found; run npm ci');

const transformersPkg = JSON.parse(await readFile(join(root, 'node_modules/@huggingface/transformers/package.json'), 'utf8'));
const ortPkg = JSON.parse(await readFile(join(ortDir, 'package.json'), 'utf8'));
const wanted = transformersPkg.dependencies['onnxruntime-web'];
if (ortPkg.version !== wanted) throw new Error(`onnxruntime-web ${ortPkg.version} found, transformers.js wants ${wanted}`);

const outDir = join(root, 'public/ort-embed');
await mkdir(outDir, { recursive: true });
for (const url of Object.values(ORT_WASM)) {
  const name = basename(url);
  const src = join(ortDir, 'dist', name);
  const dest = join(outDir, name);
  const [a, b] = await Promise.all([stat(src), stat(dest).catch(() => null)]);
  if (b && b.size === a.size && b.mtimeMs >= a.mtimeMs) continue;
  await copyFile(src, dest);
  console.log(`copied ${name} (${(a.size / 1e6).toFixed(1)} MB) from onnxruntime-web ${ortPkg.version}`);
}
