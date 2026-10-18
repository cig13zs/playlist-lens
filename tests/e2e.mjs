// End-to-end test for Playlist Lens.
// Loads the unpacked Chrome extension, exercises features across synthetic and real fixtures,
// tests the live YouTube site, and captures store and test screenshots.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
await import('../build.mjs'); // Ensure dist/ is fresh

const EXT = path.join(root, 'dist', 'chrome');
const screenshotsDir = path.join(root, 'tests', 'screenshots');
const storeDir = path.join(root, 'store');
fs.mkdirSync(screenshotsDir, { recursive: true });
fs.mkdirSync(storeDir, { recursive: true });

const syntheticHtml = fs.readFileSync(path.join(root, 'tests', 'fixtures', 'playlist-synthetic.html'), 'utf8');
const under100Html = fs.readFileSync(path.join(root, 'tests', 'fixtures', 'playlist-under-100.html'), 'utf8');
const over100Html = fs.readFileSync(path.join(root, 'tests', 'fixtures', 'playlist-over-100.html'), 'utf8');

const extensionErrors = [];
let passed = 0;
let failed = 0;

async function step(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}\n     ${String(e.message).split('\n').slice(0, 4).join('\n     ')}`);
  }
}

// Browser launcher with channel fallback
async function launchBrowser(options = {}) {
  const args = [
    `--disable-extensions-except=${EXT}`,
    `--load-extension=${EXT}`,
    ...(options.args || []),
  ];

  let channel = process.env.PLAYLIST_LENS_CHANNEL || 'msedge';
  let context;
  try {
    context = await chromium.launchPersistentContext('', {
      channel,
      args,
      viewport: { width: 1280, height: 800 },
      ...options,
    });
  } catch (err) {
    channel = 'chrome';
    context = await chromium.launchPersistentContext('', {
      channel,
      args,
      viewport: { width: 1280, height: 800 },
      ...options,
    });
  }

  context.setDefaultTimeout(10000);
  context.setDefaultNavigationTimeout(25000);

  const page = context.pages()[0] || await context.newPage();
  const cdp = await context.newCDPSession(page);

  let extId = null;
  const extContextIds = new Set();

  cdp.on('Runtime.executionContextCreated', ({ context: c }) => {
    if (c.origin.startsWith('chrome-extension://')) {
      extId = new URL(c.origin).host;
      extContextIds.add(c.id);
    }
  });

  cdp.on('Runtime.exceptionThrown', ({ exceptionDetails: d }) => {
    const desc = d.exception?.description || d.text || '';
    const isExtension =
      extContextIds.has(d.executionContextId) ||
      (d.url || '').startsWith('chrome-extension://') ||
      desc.includes('chrome-extension://') ||
      desc.includes('PlaylistLens');

    if (isExtension) {
      extensionErrors.push(`Extension exception on ${page.url()}: ${desc}`);
    }
  });

  cdp.on('Runtime.consoleAPICalled', e => {
    if (e.type === 'error' || e.type === 'assert') {
      const msg = e.args.map(a => a.value ?? a.description).join(' ');
      if (extContextIds.has(e.executionContextId) || msg.includes('[Playlist Lens]')) {
        extensionErrors.push(`Extension console.${e.type} on ${page.url()}: ${msg}`);
      }
    }
  });

  await cdp.send('Runtime.enable');
  return { context, page, getExtId: () => extId };
}

async function main() {
  console.log('Starting Playlist Lens e2e tests...\n');

  const { context, page, getExtId } = await launchBrowser();

  // Intercept synthetic fixture
  await context.route('https://www.youtube.com/playlist?list=WL', route => {
    return route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: syntheticHtml,
    });
  });

  // Intercept under-100 fixture
  await context.route('https://www.youtube.com/playlist?list=PL_UNDER_100', route => {
    return route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: under100Html,
    });
  });

  // Intercept over-100 fixture
  await context.route('https://www.youtube.com/playlist?list=PL_OVER_100', route => {
    return route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: over100Html,
    });
  });

async function verify30MinBudgetAndReset(page, fixtureName, onBudgetApplied = null) {
  const input = page.locator('#pl-budget-input');
  await input.fill('30');
  await page.waitForTimeout(500);

  const bar = page.locator('#playlist-lens-bar');
  await bar.waitFor({ state: 'visible', timeout: 5000 });

  const summary = await page.locator('#pl-budget-summary').textContent();
  const match = summary.match(/(\d+)\s+video.*fit in\s+30\s+min/i);
  assert.ok(match, `[${fixtureName}] Summary must indicate fit count: "${summary}"`);
  const fitCount = parseInt(match[1], 10);
  assert.ok(fitCount > 0, `[${fixtureName}] Expected at least 1 fitting video, got ${fitCount}`);

  if (onBudgetApplied) {
    await onBudgetApplied();
  }

  // Retrieve geometry and durations of all visible rows and the bar in the same evaluation
  const layout = await page.evaluate(() => {
    const barEl = document.getElementById('playlist-lens-bar');
    const barRect = barEl.getBoundingClientRect();

    const Selectors = {
      ROW: 'ytd-playlist-video-renderer, yt-lockup-view-model',
      CONTAINER: 'ytd-playlist-video-list-renderer #contents, ytd-section-list-renderer #contents, yt-section-list-renderer #contents, #contents',
      TIME_BADGE: 'ytd-thumbnail-overlay-time-status-renderer, .ytd-thumbnail-overlay-time-status-renderer, badge-shape, .ytBadgeShapeText, yt-thumbnail-badge-view-model, .time-badge',
    };

    const container = document.querySelector(Selectors.CONTAINER);
    const rows = Array.from(document.querySelectorAll(Selectors.ROW));

    const visibleRows = [];
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      let curr = row;
      let isHidden = false;
      while (curr && curr !== document.body) {
        if (curr.classList.contains('playlist-lens-hidden') || window.getComputedStyle(curr).display === 'none') {
          isHidden = true;
          break;
        }
        curr = curr.parentElement;
      }
      if (!isHidden) {
        let itemEl = row;
        while (itemEl && itemEl.parentElement && itemEl.parentElement !== container) {
          itemEl = itemEl.parentElement;
        }
        const targetEl = (itemEl && itemEl.parentElement === container) ? itemEl : row;
        const rect = targetEl.getBoundingClientRect();
        if (rect.height > 0 && rect.width > 0) {
          const remBadge = row.querySelector('.playlist-lens-remaining-badge');
          const timeBadge = row.querySelector(Selectors.TIME_BADGE);
          const rawText = remBadge ? remBadge.textContent.trim() : (timeBadge ? timeBadge.textContent.trim() : '');
          visibleRows.push({
            originalIndex: i,
            top: rect.top,
            bottom: rect.bottom,
            height: rect.height,
            durText: rawText,
          });
        }
      }
    }

    visibleRows.sort((a, b) => a.top - b.top);
    return {
      barBottom: barRect.bottom,
      totalRowsCount: rows.length,
      visibleRows,
    };
  });

  // (a) the number of visible rows equals the "N videos fit" number
  assert.equal(
    layout.visibleRows.length,
    fitCount,
    `[${fixtureName}] (a) visible row count (${layout.visibleRows.length}) must equal fit count (${fitCount})`
  );

  // (b) the visible rows' durations are ascending and sum to 30 min or less
  let sumSec = 0;
  let prevSec = -1;
  for (let i = 0; i < layout.visibleRows.length; i++) {
    const r = layout.visibleRows[i];
    const cleaned = r.durText.replace(/[^\d:]/g, '');
    const parts = cleaned.split(':').map(Number);
    let sec = 0;
    if (parts.length === 3) sec = parts[0] * 3600 + parts[1] * 60 + parts[2];
    else if (parts.length === 2) sec = parts[0] * 60 + parts[1];
    else sec = parts[0] || 0;

    assert.ok(
      sec >= prevSec,
      `[${fixtureName}] (b) Durations must be ascending: row ${i} (${sec}s) >= prev (${prevSec}s)`
    );
    prevSec = sec;
    sumSec += sec;
  }
  assert.ok(
    sumSec <= 30 * 60,
    `[${fixtureName}] (b) Durations sum (${sumSec}s) must be <= 1800s (30 min)`
  );

  // (c) the first visible row's top is within 40px of the bar's bottom
  const firstRowTop = layout.visibleRows[0].top;
  const diffFirst = Math.abs(firstRowTop - layout.barBottom);
  assert.ok(
    diffFirst <= 40,
    `[${fixtureName}] (c) First visible row top (${firstRowTop}) must be within 40px of bar bottom (${layout.barBottom}), diff: ${diffFirst}px`
  );

  // (d) each next visible row starts within 40px of the previous row's bottom
  for (let i = 1; i < layout.visibleRows.length; i++) {
    const prevBottom = layout.visibleRows[i - 1].bottom;
    const currTop = layout.visibleRows[i].top;
    const gap = Math.abs(currTop - prevBottom);
    assert.ok(
      gap <= 40,
      `[${fixtureName}] (d) Row ${i} top (${currTop}) must start within 40px of row ${i - 1} bottom (${prevBottom}), gap: ${gap}px`
    );
  }

  // Reset must restore the original order and no hidden rows
  await page.locator('#pl-reset').click();
  await page.waitForTimeout(300);

  const resetState = await page.evaluate(() => {
    const Selectors = {
      ROW: 'ytd-playlist-video-renderer, yt-lockup-view-model',
      CONTAINER: 'ytd-playlist-video-list-renderer #contents, ytd-section-list-renderer #contents, yt-section-list-renderer #contents, #contents',
    };
    const container = document.querySelector(Selectors.CONTAINER);
    const rows = Array.from(document.querySelectorAll(Selectors.ROW));
    let hiddenCount = 0;
    for (const r of rows) {
      if (r.classList.contains('playlist-lens-hidden') || window.getComputedStyle(r).display === 'none') {
        hiddenCount++;
      }
    }
    let directHiddenCount = 0;
    if (container) {
      for (const c of container.children) {
        if (c.classList.contains('playlist-lens-hidden') || window.getComputedStyle(c).display === 'none') {
          directHiddenCount++;
        }
      }
    }
    const containerActive = container?.classList.contains('playlist-lens-container-active');
    return {
      totalRows: rows.length,
      hiddenCount,
      directHiddenCount,
      containerActive,
    };
  });

  assert.equal(resetState.hiddenCount, 0, `[${fixtureName}] Reset must restore 0 hidden rows, found ${resetState.hiddenCount}`);
  assert.equal(resetState.directHiddenCount, 0, `[${fixtureName}] Reset must restore 0 direct hidden rows, found ${resetState.directHiddenCount}`);
  assert.equal(resetState.containerActive, false, `[${fixtureName}] Reset must remove container active class`);
}

  // Step 1: Synthetic fixture default view
  await step('synthetic fixture: bar renders, calculates unwatched, hides watched video', async () => {
    await page.goto('https://www.youtube.com/playlist?list=WL');
    await page.locator('#playlist-lens-bar').waitFor();

    const header = await page.locator('#pl-runtime-header').textContent();
    assert.match(header, /8 videos/);
    assert.match(header, /2 h 25 m total/);
    assert.match(header, /1 h 50 m unwatched/);
    assert.match(header, /1 without a length/);

    // Watched video 2 (95%) must be hidden by default
    const row2 = page.locator('ytd-playlist-video-renderer[data-id="vid-2"]');
    await assert.rejects(async () => {
      await row2.waitFor({ state: 'visible', timeout: 500 });
    });

    // Partially watched video 3 (50%) must show remaining badge
    const badge3 = page.locator('ytd-playlist-video-renderer[data-id="vid-3"] .playlist-lens-remaining-badge');
    assert.equal(await badge3.textContent(), '15:00 left');

    await page.screenshot({ path: path.join(screenshotsDir, '1-synthetic-default-dark.png') });
  });

  // Step 2: Time budget filter
  await step('time budget: 30 min budget picks shortest fitting videos, excludes longer', async () => {
    const input = page.locator('#pl-budget-input');
    await input.fill('30');

    // Wait for view update
    await page.waitForTimeout(300);

    const summary = await page.locator('#pl-budget-summary').textContent();
    assert.match(summary, /3 videos fit in 30 min/);
    assert.match(summary, /30 m/);

    // Visible videos: vid-4 (5m), vid-1 (10m), vid-3 (15m remaining)
    const visible4 = await page.locator('ytd-playlist-video-renderer[data-id="vid-4"]').isVisible();
    const visible1 = await page.locator('ytd-playlist-video-renderer[data-id="vid-1"]').isVisible();
    const visible3 = await page.locator('ytd-playlist-video-renderer[data-id="vid-3"]').isVisible();
    const visible5 = await page.locator('ytd-playlist-video-renderer[data-id="vid-5"]').isVisible();
    const visible7 = await page.locator('ytd-playlist-video-renderer[data-id="vid-7"]').isVisible();
    const visible8 = await page.locator('ytd-playlist-video-renderer[data-id="vid-8"]').isVisible();

    assert.ok(visible4, 'vid-4 (5m) should fit');
    assert.ok(visible1, 'vid-1 (10m) should fit');
    assert.ok(visible3, 'vid-3 (15m remaining) should fit');
    assert.ok(!visible5, 'vid-5 (15m) would exceed 30m total and must be excluded');
    assert.ok(!visible7, 'vid-7 (25m) would exceed 30m total and must be excluded');
    assert.ok(!visible8, 'vid-8 (40m) would exceed 30m total and must be excluded');

    // Drag handle disabled during budget/sort
    const container = page.locator('#contents');
    const hasDisabledClass = await container.evaluate(el => el.classList.contains('playlist-lens-reorder-disabled'));
    assert.ok(hasDisabledClass, 'container should have playlist-lens-reorder-disabled');

    // Capture primary store screenshot (30 min budget with visible running total per BUILD-PROMPT.md)
    await page.screenshot({ path: path.join(storeDir, '1-watch-later-30min-budget.png') });

    // Switch to light theme and capture screenshot
    await page.evaluate(() => document.documentElement.removeAttribute('dark'));
    await page.screenshot({ path: path.join(screenshotsDir, '2-synthetic-30min-budget-light.png') });
    await page.evaluate(() => document.documentElement.setAttribute('dark', ''));
  });

  // Step 3: Sort chips
  await step('sort chips: Shortest first orders videos ascending, Longest orders descending', async () => {
    // Clear budget
    await page.locator('#pl-budget-input').fill('');
    await page.waitForTimeout(200);

    // Click Shortest chip
    await page.locator('.playlist-lens-chip[data-sort="shortest"]').click();
    await page.waitForTimeout(200);

    const order4 = await page.locator('ytd-playlist-video-renderer[data-id="vid-4"]').evaluate(el => el.style.order);
    const order1 = await page.locator('ytd-playlist-video-renderer[data-id="vid-1"]').evaluate(el => el.style.order);
    const order3 = await page.locator('ytd-playlist-video-renderer[data-id="vid-3"]').evaluate(el => el.style.order);
    const order6 = await page.locator('ytd-playlist-video-renderer[data-id="vid-6"]').evaluate(el => el.style.order);

    assert.ok(Number(order4) < Number(order1), '5m must precede 10m');
    assert.ok(Number(order1) < Number(order3), '10m must precede 15m remaining');
    assert.ok(Number(order3) < Number(order6), 'videos without length must go last');

    await page.screenshot({ path: path.join(storeDir, '2-shortest-first-sort.png') });
  });

  // Step 4: Hide watched toggle
  await step('hide watched toggle: reveals watched videos when unchecked', async () => {
    const toggle = page.locator('#pl-hide-watched');
    await toggle.uncheck();
    await page.waitForTimeout(200);

    const row2Visible = await page.locator('ytd-playlist-video-renderer[data-id="vid-2"]').isVisible();
    assert.ok(row2Visible, 'watched video vid-2 should be visible when hide watched is unchecked');

    await page.screenshot({ path: path.join(storeDir, '3-hide-watched-toggle.png') });

    await toggle.check();
    await page.waitForTimeout(200);
  });

  // Step 5: Reset action
  await step('reset button: restores native DOM order and clears filters', async () => {
    await page.locator('#pl-reset').click();
    await page.waitForTimeout(200);

    const budgetVal = await page.locator('#pl-budget-input').inputValue();
    assert.equal(budgetVal, '');

    const isDefaultActive = await page.locator('.playlist-lens-chip[data-sort="default"]').evaluate(el => el.classList.contains('is-active'));
    assert.ok(isDefaultActive, 'Default chip should be active');

    const container = page.locator('#contents');
    const hasDisabledClass = await container.evaluate(el => el.classList.contains('playlist-lens-reorder-disabled'));
    assert.ok(!hasDisabledClass, 'reorder disabled class should be removed on reset');

    await page.screenshot({ path: path.join(screenshotsDir, '3-synthetic-reset.png') });
  });

  // Step 6: Under-100 real fixture (80 videos)
  await step('under-100 fixture: correctly reads full 80-video playlist and verifies 30 min budget layout', async () => {
    await page.goto('https://www.youtube.com/playlist?list=PL_UNDER_100');
    await page.locator('#playlist-lens-bar').waitFor();

    const header = await page.locator('#pl-runtime-header').textContent();
    assert.match(header, /80 videos/);

    const comp = await page.locator('#pl-completeness').textContent();
    assert.match(comp, /Loaded 80/);

    await verify30MinBudgetAndReset(page, 'under-100 fixture');
    await page.screenshot({ path: path.join(screenshotsDir, '4-under100-fixture.png') });
  });

  // Step 7: Over-100 real fixture (182 videos)
  await step('over-100 fixture: displays honest completeness and verifies 30 min budget layout', async () => {
    await page.goto('https://www.youtube.com/playlist?list=PL_OVER_100');
    await page.locator('#playlist-lens-bar').waitFor();

    const comp = await page.locator('#pl-completeness').textContent();
    assert.match(comp, /182/);

    await verify30MinBudgetAndReset(page, 'over-100 fixture');
    await page.screenshot({ path: path.join(screenshotsDir, '5-over100-fixture.png') });
  });

  // Step 8: Live YouTube playlist
  await step('live YouTube playlist: loads public playlist, verifies bar and 30 min budget layout', async () => {
    // Live playlist with consent cookies
    await context.addCookies([
      { name: 'CONSENT', value: 'PENDING+999', domain: '.youtube.com', path: '/' },
      { name: 'SOCS', value: 'CAESEwgDEgk2ODE4MTM5MDUaAmVuIAEaBgiA_L20Bg', domain: '.youtube.com', path: '/' },
    ]);

    await page.goto('https://www.youtube.com/playlist?list=PLZPZq0r_RZOO1zkgO4bIdfuLpizCeHYKv', {
      waitUntil: 'domcontentloaded',
      timeout: 25000,
    });

    const bar = page.locator('#playlist-lens-bar');
    await bar.waitFor({ timeout: 15000 });

    const header = await page.locator('#pl-runtime-header').textContent();
    assert.match(header, /video/i);

    // Verify 30-min budget layout and retake 6-live-playlist.png while budget is active
    await verify30MinBudgetAndReset(page, 'live playlist', async () => {
      await page.screenshot({ path: path.join(screenshotsDir, '6-live-playlist.png') });
    });
  });

  // Step 9: Live YouTube playlist (150 to 600 videos) exercising "Load all"
  await step('live YouTube playlist (150-600 videos): exercises Load all, verifies completeness, top scroll, and 30 min budget layout', async () => {
    // Public playlist: Coding Challenges by The Coding Train (246 videos)
    // URL: https://www.youtube.com/playlist?list=PLRqwX-V7Uu6ZiZxtDDRCi6uhfTH4FilpH
    await page.goto('https://www.youtube.com/playlist?list=PLRqwX-V7Uu6ZiZxtDDRCi6uhfTH4FilpH', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    const bar = page.locator('#playlist-lens-bar');
    await bar.waitFor({ timeout: 20000 });

    // Set 30 min budget to exercise the "based on" partial note on initial batch
    const input = page.locator('#pl-budget-input');
    await input.fill('30');
    await page.waitForTimeout(500);

    // Assert initial completeness text has "Loaded 100 of N" (or first batch) with "based on" note
    const initialComp = await page.locator('#pl-completeness').textContent();
    assert.match(initialComp, /Loaded \d+ of \d+/i);
    assert.ok(initialComp.includes('based on'), `Initial completeness must contain "based on" note: "${initialComp}"`);

    const totalMatch = initialComp.match(/Loaded \d+ of (\d+)/i);
    assert.ok(totalMatch, `Must extract total count from: "${initialComp}"`);
    const headerTotal = parseInt(totalMatch[1], 10);
    assert.ok(headerTotal >= 150 && headerTotal <= 600, `Header total must be between 150 and 600, got: ${headerTotal}`);

    // Press Load all
    const loadAllBtn = page.locator('#pl-load-all');
    assert.ok(await loadAllBtn.isVisible(), 'Load all button must be visible for partial playlist');
    await loadAllBtn.click();

    // Wait until Load all stops
    await page.waitForFunction(() => {
      const btn = document.getElementById('pl-load-all');
      return !btn || btn.style.display === 'none';
    }, { timeout: 45000 });

    // Assert loaded count equals N (or 2,000 cap)
    const finalRowCount = await page.locator('ytd-playlist-video-renderer, yt-lockup-view-model').count();
    assert.equal(finalRowCount, Math.min(headerTotal, 2000), `Loaded row count (${finalRowCount}) must equal header total (${headerTotal})`);

    // Assert "based on" note is gone
    const finalComp = await page.locator('#pl-completeness').textContent();
    assert.ok(!finalComp.includes('based on'), `"based on" note must be gone after loading all, got: "${finalComp}"`);
    assert.match(finalComp, new RegExp(`Loaded ${finalRowCount} of ${headerTotal}`));

    // Assert page is scrolled back to top
    const scrollY = await page.evaluate(() => window.scrollY);
    assert.equal(scrollY, 0, `Page must be scrolled back to top (scrollY = 0), got: ${scrollY}`);

    // Save screenshot 8-live-load-all.png
    await page.screenshot({ path: path.join(screenshotsDir, '8-live-load-all.png') });

    // Assert 30 min budget still passes existing layout assertions (visible count equals "N fit", ascending, gaps 40px or less)
    const summary = await page.locator('#pl-budget-summary').textContent();
    const match = summary.match(/(\d+)\s+video.*fit in\s+30\s+min/i);
    assert.ok(match, `Summary must indicate fit count: "${summary}"`);
    const fitCount = parseInt(match[1], 10);
    assert.ok(fitCount > 0, `Expected at least 1 fitting video, got ${fitCount}`);

    const layout = await page.evaluate(() => {
      const barEl = document.getElementById('playlist-lens-bar');
      const barRect = barEl.getBoundingClientRect();

      const Selectors = {
        ROW: 'ytd-playlist-video-renderer, yt-lockup-view-model',
        CONTAINER: 'ytd-playlist-video-list-renderer #contents, ytd-section-list-renderer #contents, yt-section-list-renderer #contents, #contents',
        TIME_BADGE: 'ytd-thumbnail-overlay-time-status-renderer, .ytd-thumbnail-overlay-time-status-renderer, badge-shape, .ytBadgeShapeText, yt-thumbnail-badge-view-model, .time-badge',
      };

      const container = document.querySelector(Selectors.CONTAINER);
      const rows = Array.from(document.querySelectorAll(Selectors.ROW));

      const visibleRows = [];
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        let curr = row;
        let isHidden = false;
        while (curr && curr !== document.body) {
          if (curr.classList.contains('playlist-lens-hidden') || window.getComputedStyle(curr).display === 'none') {
            isHidden = true;
            break;
          }
          curr = curr.parentElement;
        }
        if (!isHidden) {
          let itemEl = row;
          while (itemEl && itemEl.parentElement && itemEl.parentElement !== container) {
            itemEl = itemEl.parentElement;
          }
          const targetEl = (itemEl && itemEl.parentElement === container) ? itemEl : row;
          const rect = targetEl.getBoundingClientRect();
          if (rect.height > 0 && rect.width > 0) {
            const remBadge = row.querySelector('.playlist-lens-remaining-badge');
            const timeBadge = row.querySelector(Selectors.TIME_BADGE);
            const rawText = remBadge ? remBadge.textContent.trim() : (timeBadge ? timeBadge.textContent.trim() : '');
            visibleRows.push({
              originalIndex: i,
              top: rect.top,
              bottom: rect.bottom,
              height: rect.height,
              durText: rawText,
            });
          }
        }
      }

      visibleRows.sort((a, b) => a.top - b.top);
      return {
        barBottom: barRect.bottom,
        totalRowsCount: rows.length,
        visibleRows,
      };
    });

    // (a) visible count equals "N fit"
    assert.equal(layout.visibleRows.length, fitCount, `(a) visible count (${layout.visibleRows.length}) must equal fit count (${fitCount})`);

    // (b) ascending and sum <= 30 min
    let sumSec = 0;
    let prevSec = -1;
    for (let i = 0; i < layout.visibleRows.length; i++) {
      const r = layout.visibleRows[i];
      const cleaned = r.durText.replace(/[^\d:]/g, '');
      const parts = cleaned.split(':').map(Number);
      let sec = 0;
      if (parts.length === 3) sec = parts[0] * 3600 + parts[1] * 60 + parts[2];
      else if (parts.length === 2) sec = parts[0] * 60 + parts[1];
      else sec = parts[0] || 0;

      assert.ok(sec >= prevSec, `(b) Durations must be ascending: row ${i} (${sec}s) >= prev (${prevSec}s)`);
      prevSec = sec;
      sumSec += sec;
    }
    assert.ok(sumSec <= 30 * 60, `(b) Durations sum (${sumSec}s) must be <= 1800s (30 min)`);

    // (c) first row top within 40px of bar bottom
    const firstRowTop = layout.visibleRows[0].top;
    const diffFirst = Math.abs(firstRowTop - layout.barBottom);
    assert.ok(diffFirst <= 40, `(c) First visible row top (${firstRowTop}) within 40px of bar bottom (${layout.barBottom}), diff: ${diffFirst}px`);

    // (d) each next visible row starts within 40px of previous row's bottom
    for (let i = 1; i < layout.visibleRows.length; i++) {
      const prevBottom = layout.visibleRows[i - 1].bottom;
      const currTop = layout.visibleRows[i].top;
      const gap = Math.abs(currTop - prevBottom);
      assert.ok(gap <= 40, `(d) Row ${i} top (${currTop}) starts within 40px of row ${i - 1} bottom (${prevBottom}), gap: ${gap}px`);
    }

    // Reset button restores page
    await page.locator('#pl-reset').click();
    await page.waitForTimeout(300);
  });

  // Step 10: Options page
  await step('options page: opens, shows defaults and Ko-fi link', async () => {
    const extId = getExtId();
    assert.ok(extId, 'extId must be captured from content script context');
    const optPage = await context.newPage();
    const optionsUrl = `chrome-extension://${extId}/options.html`;
    await optPage.goto(optionsUrl);
    await optPage.locator('h1').waitFor();
    assert.equal(await optPage.locator('h1').textContent(), 'Playlist Lens Settings');
    assert.ok(await optPage.locator('a[href*="ko-fi.com/jju1s"]').isVisible());
    await optPage.screenshot({ path: path.join(storeDir, '4-options-page.png') });
    await optPage.close();
  });

  // Step 10: Popup page
  await step('popup page: renders status and links cleanly', async () => {
    const extId = getExtId();
    assert.ok(extId, 'extId must be captured');
    const popupPage = await context.newPage();
    await popupPage.goto(`chrome-extension://${extId}/popup.html`);
    await popupPage.locator('.title').waitFor();
    assert.equal(await popupPage.locator('.title').textContent(), 'Playlist Lens');
    await popupPage.screenshot({ path: path.join(screenshotsDir, '7-popup.png') });
    await popupPage.close();
  });

  // Step 11: Error check
  await step('no exceptions or console errors from the extension', async () => {
    if (extensionErrors.length > 0) {
      console.log('Logged extension errors:', extensionErrors);
    }
    assert.equal(extensionErrors.length, 0, `Expected 0 extension errors, got ${extensionErrors.length}:\n${extensionErrors.join('\n')}`);
  });

  await context.close();

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch(err => {
  console.error('Fatal e2e error:', err);
  process.exit(1);
});
