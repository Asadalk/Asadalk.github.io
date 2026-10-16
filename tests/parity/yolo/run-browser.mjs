// Runs every test photo through the REAL demo page (file input → worker →
// onnxruntime-web) in Chrome and saves the boxes it draws.
// Usage: node run-browser.mjs <images_dir> <out.json> [wasm|webgpu] [port]
import { chromium } from '@playwright/test';
import { spawn } from 'node:child_process';
import { readdirSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';

const [dir, outPath, backend = 'auto', port = '4340'] = process.argv.slice(2);
const server = spawn('npx', ['astro', 'preview', '--port', port, '--ignore-lock'], { stdio: 'ignore' });
const base = `http://localhost:${port}/`;
for (let i = 0; i < 60; i++) {
  try { if ((await fetch(base)).ok) break; } catch {}
  await new Promise((r) => setTimeout(r, 500));
}

const browser = await chromium.launch({
  channel: 'chrome',
  args: backend === 'webgpu' ? ['--enable-unsafe-webgpu', '--enable-features=Vulkan'] : [],
});
const page = await browser.newPage();
await page.goto(base + (backend === 'wasm' ? '?ort=wasm' : ''));
const out = { backend, results: {} };
for (const f of readdirSync(dir).filter((f) => f.endsWith('.jpg')).sort()) {
  await page.evaluate(() => delete document.querySelector('[data-stage]').dataset.result);
  await page.locator('[data-file]').first().setInputFiles(join(dir, f));
  await page.waitForFunction(() => document.querySelector('[data-stage]').dataset.result, null, { timeout: 180000 });
  const r = JSON.parse(await page.locator('[data-stage]').getAttribute('data-result'));
  out.results[basename(f, '.jpg')] = r;
  console.log(f, r.backend, r.detections.length, 'boxes', Math.round(r.timings.inference), 'ms inference');
}
writeFileSync(outPath, JSON.stringify(out));
await browser.close();
server.kill();
