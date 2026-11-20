// Renders toolbar icons and the 440×280 Chrome Web Store tile.
// Re-run when the mark changes: node store/make-art.mjs
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const iconsDir = path.join(root, 'src', 'icons');
const storeDir = path.join(root, 'store');
fs.mkdirSync(iconsDir, { recursive: true });
fs.mkdirSync(storeDir, { recursive: true });

const mark = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 128 128">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#2a2418"/>
      <stop offset="1" stop-color="#14110c"/>
    </linearGradient>
  </defs>
  <rect width="128" height="128" rx="28" fill="url(#g)"/>
  <circle cx="64" cy="64" r="40" fill="none" stroke="#f0c14b" stroke-width="7"/>
  <rect x="38" y="46" width="52" height="8" rx="4" fill="#ffe7a3"/>
  <rect x="46" y="60" width="36" height="8" rx="4" fill="#f0c14b"/>
  <rect x="54" y="74" width="20" height="8" rx="4" fill="#c48a1a"/>
</svg>`;

async function main() {
  const browser = await chromium.launch({
    channel: process.env.PLAYLIST_LENS_CHANNEL || 'chromium',
    headless: true,
  });
  const page = await browser.newPage();

  for (const size of [16, 32, 48, 128]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<body style="margin:0;overflow:hidden;background:transparent">${mark(size)}</body>`);
    await page.screenshot({
      path: path.join(iconsDir, `icon${size}.png`),
      omitBackground: true,
    });
  }

  await page.setViewportSize({ width: 440, height: 280 });
  await page.setContent(`<!DOCTYPE html><body style="margin:0;width:440px;height:280px;overflow:hidden;
    background:radial-gradient(280px 180px at 18% 20%, rgba(240,193,75,.28), transparent 60%), linear-gradient(160deg,#1c1812,#0e0c09);
    color:#f6f1e6;font-family:Roboto,system-ui,sans-serif;display:flex;align-items:center;gap:22px;padding:0 28px;box-sizing:border-box">
    <img width="104" height="104" src="${`data:image/svg+xml,${encodeURIComponent(mark(104))}`}" alt="">
    <div>
      <div style="font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:#f0c14b;font-weight:700">For YouTube</div>
      <div style="font-size:28px;font-weight:700;letter-spacing:-.03em;line-height:1.1;margin-top:6px">Fit the Queue</div>
      <div style="font-size:14px;line-height:1.45;margin-top:10px;color:#c8bfb0">YouTube playlist time, sort, and a study plan.</div>
    </div>
  </body>`);
  await page.screenshot({ path: path.join(storeDir, 'promo-440x280.png') });

  await browser.close();
  console.log('Wrote icons and store/promo-440x280.png');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
