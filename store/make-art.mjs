// Renders the toolbar icons and the 440x280 promo tile from inline SVG/HTML with Playwright.
// Re-run only when the mark changes: node store/make-art.mjs
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const iconsDir = path.join(root, 'src', 'icons');
const storeDir = path.join(root, 'store');
fs.mkdirSync(iconsDir, { recursive: true });
fs.mkdirSync(storeDir, { recursive: true });

const RED = '#c00';

// A circular lens / stopwatch containing playlist bars: the Playlist Lens mark
const mark = (size, rounded = true) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 128 128">
  ${rounded ? `<rect width="128" height="128" rx="28" fill="${RED}"/>` : ''}
  <!-- Outer lens / clock ring -->
  <circle cx="64" cy="64" r="46" fill="none" stroke="#ffffff" stroke-width="8"/>
  <!-- Clock hand at top -->
  <line x1="64" y1="28" x2="64" y2="40" stroke="#ffffff" stroke-width="8" stroke-linecap="round"/>
  <!-- Playlist bars inside the lens -->
  <line x1="42" y1="52" x2="86" y2="52" stroke="#ffffff" stroke-width="7" stroke-linecap="round"/>
  <line x1="42" y1="64" x2="74" y2="64" stroke="#ffffff" stroke-width="7" stroke-linecap="round"/>
  <line x1="42" y1="76" x2="62" y2="76" stroke="#ffffff" stroke-width="7" stroke-linecap="round"/>
  <!-- Small stopwatch top knob -->
  <rect x="58" y="10" width="12" height="8" rx="2" fill="#ffffff"/>
</svg>`;

async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage();

  // Generate toolbar and store icons
  for (const size of [16, 32, 48, 128]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<body style="margin:0;overflow:hidden;background:transparent">${mark(size)}</body>`);
    const outPath = path.join(iconsDir, `icon${size}.png`);
    await page.screenshot({ path: outPath, omitBackground: true });
  }

  // Generate 440x280 promo tile
  await page.setViewportSize({ width: 440, height: 280 });
  await page.setContent(`<body style="margin:0;width:440px;height:280px;background:#0f0f0f;color:#fff;
    font-family:'Roboto',-apple-system,BlinkMacSystemFont,sans-serif;display:flex;align-items:center;gap:26px;padding:0 34px;box-sizing:border-box">
    <div style="flex:none;width:112px;height:112px;border-radius:26px;background:${RED};display:grid;place-items:center">
      ${mark(96, false)}
    </div>
    <div>
      <div style="font-size:30px;font-weight:700;line-height:1.15;letter-spacing:-0.5px">Playlist Lens</div>
      <div style="font-size:15px;line-height:1.45;margin-top:10px;color:#aaa">
        Fit videos into the time you have.<br>
        Sort playlists by duration.<br>
        Hide watched, see honest totals.
      </div>
    </div>
  </body>`);
  await page.screenshot({ path: path.join(storeDir, 'promo-440x280.png') });

  await browser.close();
  console.log('Successfully wrote src/icons/icon{16,32,48,128}.png and store/promo-440x280.png');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
