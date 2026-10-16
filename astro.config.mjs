// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

/**
 * onnxruntime-web contains `new URL("ort-wasm-….wasm", import.meta.url)` as a
 * fallback, which makes Vite copy a 27 MB file into _astro/. The embedding
 * worker always sets the WASM path to /ort-embed/ (scripts/copy-ort-embed.mjs),
 * so point the fallback there too and keep Vite from emitting a duplicate.
 * @returns {import('vite').Plugin}
 */
const ortWasmFromPublic = () => ({
  name: 'ort-wasm-from-public',
  enforce: 'pre',
  transform(code, id) {
    if (!id.includes('onnxruntime-web')) return null;
    const out = code.replace(/new URL\(\s*"(ort-wasm[^"]*\.wasm)"\s*,\s*import\.meta\.url\s*\)/g, 'new URL("/ort-embed/$1",self.location.href)');
    return out === code ? null : { code: out, map: null };
  },
});

// Static output: every page renders at build time and works without JavaScript.
export default defineConfig({
  site: 'https://asadalk.github.io',
  output: 'static',
  trailingSlash: 'ignore',
  integrations: [sitemap()],
  vite: {
    plugins: [ortWasmFromPublic()],
    // The embedding worker loads transformers.js with a dynamic import, which
    // needs an ES-module worker (Vite's default IIFE format can't code-split).
    worker: { format: 'es', plugins: () => [ortWasmFromPublic()] },
  },
});
