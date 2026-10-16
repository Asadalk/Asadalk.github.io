import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
const dir = process.argv[2];
const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();
await page.goto('about:blank');
for (const name of ['kodak-fuji-shop', 'paharganj-main-bazaar']) {
  const b64 = readFileSync(`${dir}/../parity-images/${name}.jpg`).toString('base64');
  const ref = readFileSync(`${dir}/${name}.rgba`);
  for (const csc of ['default', 'none']) {
    const px = await page.evaluate(async ({ b64, csc }) => {
      const blob = await (await fetch('data:image/jpeg;base64,' + b64)).blob();
      const bm = await createImageBitmap(blob, { imageOrientation: 'from-image', colorSpaceConversion: csc });
      const c = new OffscreenCanvas(bm.width, bm.height); const ctx = c.getContext('2d');
      ctx.drawImage(bm, 0, 0); const d = ctx.getImageData(0, 0, bm.width, bm.height).data;
      return Array.from(d.subarray(0, 4 * 400000));
    }, { b64, csc });
    let max = 0, sum = 0;
    for (let i = 0; i < px.length; i++) { if (i % 4 === 3) continue; const d = Math.abs(px[i] - ref[i]); max = Math.max(max, d); sum += d; }
    console.log(name, 'colorSpaceConversion=' + csc, 'maxdiff', max, 'mean', (sum / (px.length * 0.75)).toFixed(3));
  }
}
await browser.close();
