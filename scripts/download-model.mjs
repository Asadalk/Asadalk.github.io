// Downloads the sentence-embedding model once, so the site can serve it
// itself. Visitors never contact Hugging Face; only this script does.
//
//   node scripts/download-model.mjs          # what the site and `npm run embed` need
//   node scripts/download-model.mjs --all    # also the 8-bit variant (parity comparison)
//
// Committed and deployed: tokenizer files + onnx/model_fp16.onnx (browser).
// Git-ignored, never deployed: onnx/model.onnx (fp32, build-time vectors and
// parity) and onnx/model_quantized.onnx.
//
// The revision is pinned and every file is checked against its SHA-256, so a
// re-download always yields the exact bytes the parity test was run with.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = 'Xenova/all-MiniLM-L6-v2';
const REVISION = '751bff37182d3f1213fa05d7196b954e230abad9';
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'public/models/all-MiniLM-L6-v2');

/** path → sha256 at the pinned revision. */
const FILES = {
  'config.json': '7135149f7cffa1a573466c6e4d8423ed73b62fd2332c575bf738a0d033f70df7',
  'tokenizer.json': 'da0e79933b9ed51798a3ae27893d3c5fa4a201126cef75586296df9b4d2c62a0',
  'tokenizer_config.json': '9261e7d79b44c8195c1cada2b453e55b00aeb81e907a6664974b4d7776172ab3',
  'special_tokens_map.json': 'b6d346be366a7d1d48332dbc9fdf3bf8960b5d879522b7799ddba59e76237ee3',
  'onnx/model_fp16.onnx': '2cdb5e58291813b6d6e248ed69010100246821a367fa17b1b81ae9483744533d',
  'onnx/model.onnx': '759c3cd2b7fe7e93933ad23c4c9181b7396442a2ed746ec7c1d46192c469c46e',
};
const EXTRA = {
  'onnx/model_quantized.onnx': 'afdb6f1a0e45b715d0bb9b11772f032c399babd23bfc31fed1c170afc848bdb1',
};

const wanted = process.argv.includes('--all') ? { ...FILES, ...EXTRA } : FILES;
const sha = (buf) => createHash('sha256').update(buf).digest('hex');

for (const [file, expected] of Object.entries(wanted)) {
  const dest = join(outDir, file);
  try {
    const existing = await readFile(dest);
    if (sha(existing) === expected) {
      console.log(`ok    ${file}`);
      continue;
    }
  } catch {}
  const url = `https://huggingface.co/${REPO}/resolve/${REVISION}/${file}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const got = sha(buf);
  if (got !== expected) throw new Error(`${file}: sha256 ${got}, expected ${expected}`);
  await mkdir(dirname(dest), { recursive: true });
  await writeFile(dest, buf);
  console.log(`saved ${file} (${(buf.length / 1e6).toFixed(1)} MB, sha256 ${got})`);
}
