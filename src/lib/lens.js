// Pure logic for Fit the Queue (Playlist Lens through v1.2).
// No DOM and no chrome.* calls. Loaded as a content script, by popup/options, and by Node tests.
(function (root) {
  'use strict';

  const DAY_MS = 864e5;
  const KOFI_URL = 'https://ko-fi.com/jju1s';
  const STORE_URL = 'https://chromewebstore.google.com/detail/olpginhinkaacjcfncphknhnmignoimo/reviews';
  const SETTINGS_VERSION = 2;
  const PROGRESS_LIMIT = 30;

  const SORT_CHOICES = Object.freeze([
    'default',
    'shortest',
    'longest',
    'newest',
    'oldest',
    'mostViews',
    'leastViews',
    'channel',
  ]);
  const FILL_MODES = Object.freeze(['most', 'fill']);
  const DURATION_BANDS = Object.freeze(['any', 'under10', 'mid', 'over30']);

  const DEFAULTS = Object.freeze({
    budgetMinutes: '',
    hideWatched: true,
    sortChoice: 'default',
    speed: 1,
    fillMode: 'most', // 'most' = pack the most videos (v1). 'fill' = pack the most minutes.
    showSpeedBoard: true,
    studyDays: 5,
    studyMinutes: 45,
    rememberProgress: true,
    settingsVersion: SETTINGS_VERSION,
    useCount: 0,
    firstUseDate: null,
    seenCards: [], // ['kofi', 'rating']
    dismissedFirstRunHint: false,
  });

  const ALLOWED_CARDS = new Set(['kofi', 'rating']);

  function clampInt(value, min, max, fallback) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
  }

  // v1 objects used the same keys. A couple of early aliases are accepted so a
  // hand-edited or older blob still opens. Unknown keys are dropped by sanitize.
  function migrateSettings(raw) {
    const input = raw && typeof raw === 'object' ? { ...raw } : {};
    if (input.speed == null && input.playbackSpeed != null) input.speed = input.playbackSpeed;
    if (input.sortChoice == null && input.sort != null) {
      const legacy = { short: 'shortest', long: 'longest', new: 'newest', old: 'oldest' };
      input.sortChoice = legacy[input.sort] || input.sort;
    }
    return input;
  }

  // Strip untrusted storage values before they touch UI or logic.
  function sanitizeSettings(raw) {
    const input = migrateSettings(raw);
    const sortChoice = SORT_CHOICES.includes(input.sortChoice) ? input.sortChoice : DEFAULTS.sortChoice;
    const fillMode = FILL_MODES.includes(input.fillMode) ? input.fillMode : DEFAULTS.fillMode;

    let budgetMinutes = '';
    if (input.budgetMinutes !== undefined && input.budgetMinutes !== null && input.budgetMinutes !== '') {
      const digits = String(input.budgetMinutes).trim().replace(/\D/g, '').slice(0, 4);
      if (digits) {
        const n = Number(digits);
        if (Number.isFinite(n) && n >= 1 && n <= 9999) {
          budgetMinutes = String(n);
        }
      }
    }

    const hideWatched = input.hideWatched === false ? false : DEFAULTS.hideWatched;

    let useCount = Number(input.useCount);
    if (!Number.isFinite(useCount) || useCount < 0) useCount = 0;
    useCount = Math.min(Math.floor(useCount), 1_000_000);

    let firstUseDate = input.firstUseDate;
    if (firstUseDate !== null && firstUseDate !== undefined) {
      firstUseDate = Number(firstUseDate);
      if (!Number.isFinite(firstUseDate) || firstUseDate < 0) firstUseDate = null;
    } else {
      firstUseDate = null;
    }

    const seenCards = Array.isArray(input.seenCards)
      ? [...new Set(input.seenCards.filter(c => typeof c === 'string' && ALLOWED_CARDS.has(c)))]
      : [];

    return {
      budgetMinutes,
      hideWatched,
      sortChoice,
      speed: normalizeSpeed(input.speed),
      fillMode,
      showSpeedBoard: input.showSpeedBoard === false ? false : DEFAULTS.showSpeedBoard,
      studyDays: clampInt(input.studyDays, 1, 60, DEFAULTS.studyDays),
      studyMinutes: clampInt(input.studyMinutes, 1, 600, DEFAULTS.studyMinutes),
      rememberProgress: input.rememberProgress === false ? false : DEFAULTS.rememberProgress,
      settingsVersion: SETTINGS_VERSION,
      useCount,
      firstUseDate,
      seenCards,
      dismissedForever: input.dismissedForever === true,
      dismissedFirstRunHint: input.dismissedFirstRunHint === true,
    };
  }

  // Playback speeds offered in the bar, matching YouTube's common steps up to 2x.
  const SPEEDS = Object.freeze([1, 1.25, 1.5, 1.75, 2]);
  // Speeds shown together so a course's remaining time is comparable at a glance.
  const SPEED_BOARD = Object.freeze([1, 1.25, 1.5, 2]);

  function normalizeSpeed(value) {
    const n = Number(value);
    return SPEEDS.includes(n) ? n : 1;
  }

  // Seconds of real time a stretch of video takes at a playback speed.
  function atSpeed(sec, speed) {
    if (sec === null || sec === undefined) return null;
    return Math.round(sec / normalizeSpeed(speed));
  }

  function watchTimesAtSpeeds(sec) {
    return SPEED_BOARD.map(speed => ({
      speed,
      label: formatSpeed(speed),
      watchSec: sec === null || sec === undefined ? null : atSpeed(sec, speed),
    }));
  }

  // "1.5x", "2x"
  function formatSpeed(speed) {
    return `${normalizeSpeed(speed)}x`;
  }

  // Localized digits (Arabic, Bengali, Devanagari, etc.) are out of scope.
  // Standard ASCII digits 0-9 with colon separation are expected from YouTube time badges.
  function parseDuration(str) {
    if (typeof str !== 'string') return null;
    const clean = str.trim();
    if (!clean) return null;

    // Check for non-duration labels (e.g. LIVE, SHORTS, Premiere, Upcoming)
    if (/^(live|shorts|premiere|upcoming)$/i.test(clean)) return null;

    // Colon format: "H:M:S", "M:S", or "S"
    const parts = clean.split(':').map(p => p.trim());
    if (parts.some(p => !/^\d+$/.test(p))) return null;

    if (parts.length === 3) {
      const [h, m, s] = parts.map(Number);
      if (m >= 60 || s >= 60) return null;
      return h * 3600 + m * 60 + s;
    }
    if (parts.length === 2) {
      const [m, s] = parts.map(Number);
      if (s >= 60) return null;
      return m * 60 + s;
    }
    if (parts.length === 1) {
      return Number(parts[0]);
    }
    return null;
  }

  // "1 hour, 2 minutes, 3 seconds" and thumbnail aria-labels that bury a duration in a title.
  function parseAriaDuration(str) {
    if (typeof str !== 'string') return null;
    const s = str.trim().toLowerCase();
    if (!s) return null;
    const h = s.match(/(\d+)\s*hours?/);
    const m = s.match(/(\d+)\s*minutes?/);
    const sec = s.match(/(\d+)\s*seconds?/);
    if (h || m || sec) {
      return (h ? Number(h[1]) : 0) * 3600 + (m ? Number(m[1]) : 0) * 60 + (sec ? Number(sec[1]) : 0);
    }
    const colon = s.match(/(\d{1,2}:\d{2}:\d{2}|\d{1,3}:\d{2})/);
    return colon ? parseDuration(colon[1]) : null;
  }

  function parseCount(str) {
    if (typeof str !== 'string' && typeof str !== 'number') return null;
    const s = String(str).replace(/,/g, '').trim();
    // Match first sequence of digits
    const m = s.match(/\d+/);
    return m ? parseInt(m[0], 10) : null;
  }

  // "1.2M views", "3,200 views", "No views". Null when the string is not a count.
  function parseViewCount(str) {
    if (str === null || str === undefined) return null;
    const s = String(str).replace(/,/g, '').trim().toLowerCase();
    if (!s) return null;
    if (/^no views\b/.test(s)) return 0;
    const m = s.match(/(\d+(?:\.\d+)?)\s*([kmb])?/i);
    if (!m) return null;
    if (!/view/.test(s) && !/^\d+(?:\.\d+)?\s*[kmb]?$/.test(s)) return null;
    let n = parseFloat(m[1]);
    const suf = (m[2] || '').toLowerCase();
    if (suf === 'k') n *= 1e3;
    else if (suf === 'm') n *= 1e6;
    else if (suf === 'b') n *= 1e9;
    if (!Number.isFinite(n)) return null;
    return Math.round(n);
  }

  const AGE_UNITS = {
    second: 1 / 86400,
    minute: 1 / 1440,
    hour: 1 / 24,
    day: 1,
    week: 7,
    month: 30.44,
    year: 365.25,
  };
  const MONTH_INDEX = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };

  // Age in days (smaller = newer). Relative phrases use approximate month/year lengths.
  function parseAgeDays(str, now = Date.now()) {
    if (typeof str !== 'string') return null;
    const s = str.trim().toLowerCase();
    if (!s) return null;
    if (/^(just now|today)\b/.test(s)) return 0;
    if (/^yesterday\b/.test(s)) return 1;
    const rel = s.match(/(\d+(?:\.\d+)?)\s*(second|minute|hour|day|week|month|year)s?\s+ago/);
    if (rel) return parseFloat(rel[1]) * AGE_UNITS[rel[2]];
    const iso = s.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (iso) {
      const t = Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
      if (!Number.isFinite(t)) return null;
      return Math.max(0, (now - t) / DAY_MS);
    }
    const named = s.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2}),?\s+(\d{4})/);
    if (named) {
      const t = Date.UTC(Number(named[3]), MONTH_INDEX[named[1]], Number(named[2]));
      if (!Number.isFinite(t)) return null;
      return Math.max(0, (now - t) / DAY_MS);
    }
    return null;
  }

  // "Channel • 1.2M views • 3 years ago" or the separate metadata chips YouTube swaps in.
  function parseMetaLine(str, now = Date.now()) {
    const empty = { channel: '', views: null, ageDays: null, ageLabel: '' };
    if (typeof str !== 'string' || !str.trim()) return empty;
    const parts = str.split(/\s*[•·|]\s*/).map(p => p.trim()).filter(Boolean);
    let views = null;
    let ageDays = null;
    let ageLabel = '';
    const leftover = [];
    for (const part of parts) {
      const age = parseAgeDays(part, now);
      if (age !== null) {
        ageDays = age;
        ageLabel = part;
        continue;
      }
      const count = parseViewCount(part);
      if (count !== null && (/view/i.test(part) || /^\d/.test(part))) {
        views = count;
        continue;
      }
      leftover.push(part);
    }
    return { channel: leftover.join(' • '), views, ageDays, ageLabel };
  }

  // Turn the strings a row reader collected into one video record. Badge text wins over aria,
  // so a title that happens to contain "10:00" cannot override the thumbnail length.
  function interpretRow(raw, now = Date.now()) {
    const input = raw && typeof raw === 'object' ? raw : {};
    const title = typeof input.title === 'string' ? input.title.replace(/\s+/g, ' ').trim() : '';
    let durationSec = parseDuration(typeof input.badgeText === 'string' ? input.badgeText : '');
    let durationText = durationSec !== null ? String(input.badgeText).trim() : null;
    if (durationSec === null && Array.isArray(input.ariaLabels)) {
      for (const label of input.ariaLabels) {
        const sec = parseAriaDuration(label);
        if (sec !== null) {
          durationSec = sec;
          durationText = formatDurationBadge(sec);
          break;
        }
      }
    }
    const meta = parseMetaLine(input.metaText || '', now);
    const channel = String(input.channel || meta.channel || '').replace(/\s+/g, ' ').trim();
    const views = input.views != null && input.views !== '' ? parseViewCount(String(input.views)) : meta.views;
    const ageDays = input.ageText ? parseAgeDays(input.ageText, now) : meta.ageDays;
    return {
      title,
      durationSec,
      durationText,
      channel,
      views,
      ageDays,
      ageLabel: input.ageText || meta.ageLabel || '',
      watchedPct: parseWatchedPct(input.watchedPct),
    };
  }

  // Honest signal when YouTube's markup no longer exposes titles or lengths.
  function readHealth(videos) {
    const list = Array.isArray(videos) ? videos : [];
    const n = list.length;
    if (!n) return { ok: false, level: 'empty', message: '' };
    let withLen = 0;
    let withTitle = 0;
    for (const v of list) {
      if (v && v.durationSec != null) withLen += 1;
      if (v && v.title && !/^Video \d+$/.test(v.title)) withTitle += 1;
    }
    if (withTitle === 0) {
      return {
        ok: false,
        level: 'titles',
        message: 'Could not read video titles. YouTube’s layout may have changed, so sorting and export are limited.',
        withLen,
        withTitle,
      };
    }
    if (withLen / n < 0.5) {
      return {
        ok: false,
        level: 'lengths',
        message: `Read ${withTitle} titles but only ${withLen} of ${n} lengths. Totals leave out the rest — YouTube’s layout may have changed.`,
        withLen,
        withTitle,
      };
    }
    return { ok: true, level: 'ok', message: '', withLen, withTitle };
  }

  function parseLoadedAndTotal(str) {
    if (typeof str !== 'string') return null;
    const clean = str.replace(/,/g, '');
    const m = clean.match(/(\d+)\s+(?:of|\/)\s+(\d+)/i);
    if (m) {
      return { loaded: parseInt(m[1], 10), total: parseInt(m[2], 10) };
    }
    const single = clean.match(/(\d+)/);
    if (single) {
      return { loaded: parseInt(single[1], 10), total: parseInt(single[1], 10) };
    }
    return null;
  }

  function parseWatchedPct(val) {
    if (val === null || val === undefined) return 0;
    if (typeof val === 'number') {
      return Math.min(100, Math.max(0, val));
    }
    const str = String(val);
    const m = str.match(/width:\s*([\d.]+)%/i) || str.match(/([\d.]+)%/);
    if (m) {
      const num = parseFloat(m[1]);
      return isNaN(num) ? 0 : Math.min(100, Math.max(0, num));
    }
    const parsed = parseFloat(str);
    return isNaN(parsed) ? 0 : Math.min(100, Math.max(0, parsed));
  }

  function isWatched(watchedPct) {
    return watchedPct !== null && watchedPct !== undefined && watchedPct >= 90;
  }

  function isWatchLaterRemoveLabel(text) {
    if (typeof text !== 'string') return false;
    const t = text.replace(/\s+/g, ' ').trim().toLowerCase();
    return t === 'remove from watch later';
  }

  function isWatchLaterList(listId) {
    return listId === 'WL';
  }

  function remaining(durationSec, watchedPct) {
    if (durationSec === null || durationSec === undefined) return null;
    if (typeof durationSec !== 'number' || durationSec < 0) return null;
    const pct = parseWatchedPct(watchedPct);
    if (pct >= 90) return 0;
    if (pct <= 0) return durationSec;
    return Math.max(0, Math.round(durationSec * (1 - pct / 100)));
  }

  // Runtime format: "31 h 05 m", "18 h 40 m", "5 m 12 s", or "0 m"
  function formatRuntime(sec) {
    if (sec === null || sec === undefined || sec <= 0) return '0 m';
    const s = Math.round(sec);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const remSec = s % 60;

    if (h > 0) {
      return `${h} h ${String(m).padStart(2, '0')} m`;
    }
    if (m > 0) {
      return remSec > 0 ? `${m} m ${String(remSec).padStart(2, '0')} s` : `${m} m`;
    }
    return `${remSec} s`;
  }

  // Format timestamp for badge: "1:02:03" or "5:12"
  function formatDurationBadge(sec) {
    if (sec === null || sec === undefined || sec < 0) return '';
    const s = Math.round(sec);
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const remSec = s % 60;

    if (h > 0) {
      return `${h}:${String(m).padStart(2, '0')}:${String(remSec).padStart(2, '0')}`;
    }
    return `${m}:${String(remSec).padStart(2, '0')}`;
  }

  // Lowercase and drop accents so "cafe" finds "Café".
  function foldText(str) {
    return String(str || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  }

  // "react hooks -shorts" -> { include: ['react', 'hooks'], exclude: ['shorts'] }. A quoted phrase
  // counts as one word. Bare dashes are ignored.
  function parseQuery(query) {
    const include = [];
    const exclude = [];
    const re = /(-?)"([^"]*)"|(\S+)/g;
    let m;
    while ((m = re.exec(foldText(query))) !== null) {
      let negate = m[1] === '-';
      let word = m[2] !== undefined ? m[2].trim() : m[3];
      if (m[3] !== undefined && word.startsWith('-')) {
        negate = true;
        word = word.slice(1);
      }
      if (!word || /^-+$/.test(word)) continue;
      (negate ? exclude : include).push(word);
    }
    return { include, exclude };
  }

  function queryActive(parsed) {
    return !!parsed && (parsed.include.length > 0 || parsed.exclude.length > 0);
  }

  // True when the title has every included word and none of the excluded ones. A blank query
  // matches everything.
  function matchesQuery(title, query) {
    const q = typeof query === 'string' ? parseQuery(query) : query;
    if (!queryActive(q)) return true;
    const t = foldText(title);
    return q.include.every(w => t.includes(w)) && !q.exclude.some(w => t.includes(w));
  }

  function passesDurationBand(sec, band) {
    if (!band || band === 'any') return true;
    if (sec === null || sec === undefined) return false;
    if (band === 'under10') return sec <= 600;
    if (band === 'mid') return sec > 600 && sec <= 1800;
    if (band === 'over30') return sec > 1800;
    return true;
  }

  function effectiveSeconds(v) {
    if (!v) return null;
    if (v.remainingSec !== null && v.remainingSec !== undefined) return v.remainingSec;
    return v.durationSec;
  }

  // Shortest first, include while running total fits budgetSec.
  // One video longer than the budget is excluded, not truncated.
  function pickForBudget(videos, budgetSec) {
    if (budgetSec === null || budgetSec === undefined || budgetSec === '') {
      return null; // No budget filter
    }
    const bSec = Number(budgetSec);
    if (isNaN(bSec) || bSec <= 0) {
      return { pickedIds: new Set(), totalSec: 0, count: 0, mode: 'most' };
    }

    // Filter to videos that have a readable length and are not already 0 remaining
    const candidates = videos
      .filter(v => {
        const eff = effectiveSeconds(v);
        return eff !== null && eff !== undefined && eff > 0 && eff <= bSec;
      })
      .slice()
      .sort((a, b) => effectiveSeconds(a) - effectiveSeconds(b));

    const pickedIds = new Set();
    let totalSec = 0;

    for (const v of candidates) {
      const dur = effectiveSeconds(v);
      if (totalSec + dur <= bSec) {
        pickedIds.add(v.id);
        totalSec += dur;
      }
    }

    return { pickedIds, totalSec, count: pickedIds.size, mode: 'most' };
  }

  // Pack as many minutes as possible into the budget (0/1 knapsack, value = length).
  // When two sets fill the same amount, the one with more videos wins.
  // Long playlists bucket the capacity so the table stays small, then a repair
  // pass uses the real second lengths so the result never exceeds the budget.
  function fillTime(videos, budgetSec) {
    const b = Number(budgetSec);
    if (!Number.isFinite(b) || b <= 0) {
      return { pickedIds: new Set(), totalSec: 0, count: 0, mode: 'fill' };
    }
    const items = [];
    const seen = new Set();
    for (const v of videos || []) {
      const w = effectiveSeconds(v);
      if (v && v.id != null && !seen.has(v.id) && typeof w === 'number' && w > 0 && w <= b) {
        seen.add(v.id);
        items.push({ id: v.id, w: Math.round(w) });
      }
    }
    if (!items.length) return { pickedIds: new Set(), totalSec: 0, count: 0, mode: 'fill' };
    const sum = items.reduce((s, it) => s + it.w, 0);
    if (sum <= b) {
      return { pickedIds: new Set(items.map(it => it.id)), totalSec: sum, count: items.length, mode: 'fill' };
    }

    let scale = 1;
    while (items.length * Math.floor(b / scale) > 250000 && scale < 60) {
      scale = scale < 10 ? 10 : 60;
    }
    while (items.length * Math.floor(b / scale) > 2_000_000 && scale < 3600) {
      scale += 60;
    }
    const cap = Math.max(0, Math.floor(b / scale));
    const countAt = new Int16Array(cap + 1);
    countAt.fill(-1);
    countAt[0] = 0;
    const prev = new Int32Array(cap + 1);
    prev.fill(-1);
    const which = new Int16Array(cap + 1);
    which.fill(-1);

    for (let i = 0; i < items.length; i++) {
      const w = Math.max(1, Math.round(items[i].w / scale));
      if (w > cap) continue;
      for (let s = cap - w; s >= 0; s--) {
        if (countAt[s] < 0) continue;
        const ns = s + w;
        const nc = countAt[s] + 1;
        if (nc > countAt[ns]) {
          countAt[ns] = nc;
          prev[ns] = s;
          which[ns] = i;
        }
      }
    }

    let best = 0;
    for (let s = cap; s >= 0; s--) {
      if (countAt[s] >= 0) {
        best = s;
        break;
      }
    }

    const picked = new Set();
    let guard = items.length + 1;
    let cursor = best;
    while (cursor > 0 && which[cursor] >= 0 && guard-- > 0) {
      const i = which[cursor];
      if (picked.has(items[i].id)) break;
      picked.add(items[i].id);
      const next = prev[cursor];
      if (next === cursor) break;
      cursor = next;
    }

    const totalOf = () => {
      let t = 0;
      for (const it of items) if (picked.has(it.id)) t += it.w;
      return t;
    };
    let total = totalOf();
    if (total > b) {
      const chosen = items.filter(it => picked.has(it.id)).sort((a, c) => c.w - a.w);
      for (const it of chosen) {
        if (total <= b) break;
        picked.delete(it.id);
        total -= it.w;
      }
    }
    const rest = items.filter(it => !picked.has(it.id)).sort((a, c) => a.w - c.w);
    for (const it of rest) {
      if (total + it.w <= b) {
        picked.add(it.id);
        total += it.w;
      }
    }
    return { pickedIds: picked, totalSec: total, count: picked.size, mode: 'fill' };
  }

  function compareSort(a, b, sort) {
    const byIndex = () => a.originalIndex - b.originalIndex;
    const nullsLast = (av, bv, direction) => {
      const aMissing = av === null || av === undefined || Number.isNaN(av);
      const bMissing = bv === null || bv === undefined || Number.isNaN(bv);
      if (aMissing && !bMissing) return 1;
      if (!aMissing && bMissing) return -1;
      if (aMissing && bMissing) return byIndex();
      if (av !== bv) return direction * (av < bv ? -1 : 1);
      return byIndex();
    };
    if (sort === 'shortest' || sort === 'longest') {
      const aNo = a.durationSec === null || a.durationSec === undefined;
      const bNo = b.durationSec === null || b.durationSec === undefined;
      const durA = aNo ? null : (a.remainingSec !== null && a.remainingSec !== undefined ? a.remainingSec : a.durationSec);
      const durB = bNo ? null : (b.remainingSec !== null && b.remainingSec !== undefined ? b.remainingSec : b.durationSec);
      return nullsLast(durA, durB, sort === 'shortest' ? 1 : -1);
    }
    if (sort === 'newest') return nullsLast(a.ageDays, b.ageDays, 1);
    if (sort === 'oldest') return nullsLast(a.ageDays, b.ageDays, -1);
    if (sort === 'mostViews') return nullsLast(a.views, b.views, -1);
    if (sort === 'leastViews') return nullsLast(a.views, b.views, 1);
    if (sort === 'channel') {
      const ac = foldText(a.channel || '');
      const bc = foldText(b.channel || '');
      if (!ac && bc) return 1;
      if (ac && !bc) return -1;
      const cmp = ac.localeCompare(bc);
      return cmp || byIndex();
    }
    return byIndex();
  }

  // Applies filters and sorts to the list of videos
  function evaluatePlaylist(videos, options = {}) {
    const {
      budgetMinutes = '',
      hideWatched = true,
      query = '',
      channel = '',
    } = options;
    const sortChoice = SORT_CHOICES.includes(options.sortChoice) ? options.sortChoice : 'default';
    const fillMode = FILL_MODES.includes(options.fillMode) ? options.fillMode : 'most';
    const durationBand = DURATION_BANDS.includes(options.durationBand) ? options.durationBand : 'any';
    const speed = normalizeSpeed(options.speed);

    const parsedQuery = parseQuery(query);
    const parsedChannel = parseQuery(channel);
    const titleActive = queryActive(parsedQuery);
    const channelFilterActive = queryActive(parsedChannel);
    const bandActive = durationBand !== 'any';

    // The budget is real minutes; at 1.5x, 30 minutes holds 45 minutes of video.
    const budgetSec = budgetMinutes !== '' && !isNaN(Number(budgetMinutes))
      ? Math.max(0, Math.floor(Number(budgetMinutes) * 60 * speed))
      : null;

    let totalSec = 0;
    let unwatchedSec = 0;
    let watchedCount = 0;
    let unwatchedCount = 0;
    let noLengthCount = 0;

    const enriched = videos.map((v, originalIndex) => {
      const durationSec = v.durationSec !== undefined ? v.durationSec : parseDuration(v.durationText);
      const watchedPct = parseWatchedPct(v.watchedPct);
      const watched = isWatched(watchedPct);
      const remSec = remaining(durationSec, watchedPct);
      const channelName = v.channel || '';
      const views = v.views === undefined ? null : v.views;
      const ageDays = v.ageDays === undefined ? null : v.ageDays;

      if (durationSec === null || durationSec === undefined) {
        noLengthCount++;
      } else {
        totalSec += durationSec;
        if (watched) {
          watchedCount++;
        } else {
          unwatchedCount++;
          unwatchedSec += remSec;
        }
      }

      return {
        ...v,
        originalIndex,
        durationSec: durationSec === undefined ? null : durationSec,
        watchedPct,
        isWatched: watched,
        remainingSec: remSec,
        channel: channelName,
        views: views === undefined ? null : views,
        ageDays: ageDays === undefined ? null : ageDays,
        matchesQuery: matchesQuery(v.title, parsedQuery),
        matchesChannel: matchesQuery(channelName, parsedChannel),
        matchesBand: passesDurationBand(remSec !== null && remSec !== undefined ? remSec : durationSec, durationBand),
      };
    });

    const eligible = v => v.matchesQuery && v.matchesChannel && v.matchesBand;
    // The budget only picks from videos that match the title, channel, and length filters.
    const budgetResult = budgetSec !== null
      ? (fillMode === 'fill' ? fillTime(enriched.filter(eligible), budgetSec) : pickForBudget(enriched.filter(eligible), budgetSec))
      : null;
    // Matches still on screen before the budget, so hidden watched videos aren't counted.
    const matchCount = titleActive
      ? enriched.filter(v => v.matchesQuery && !(hideWatched && v.isWatched)).length
      : null;

    // Determine visibility
    const evaluated = enriched.map(v => {
      let visible = true;
      let hiddenReason = null;

      if (hideWatched && v.isWatched) {
        visible = false;
        hiddenReason = 'watched';
      } else if (!v.matchesQuery) {
        visible = false;
        hiddenReason = 'query';
      } else if (!v.matchesChannel) {
        visible = false;
        hiddenReason = 'channel';
      } else if (!v.matchesBand) {
        visible = false;
        hiddenReason = 'length';
      } else if (budgetResult !== null) {
        if (!budgetResult.pickedIds.has(v.id)) {
          visible = false;
          hiddenReason = 'budget';
        }
      }

      return {
        ...v,
        visible,
        hiddenReason,
      };
    });

    // When the budget is packing the most videos, those rows are shortest first (v1).
    // Fill-the-time keeps the sort the viewer picked.
    const effectiveSort = budgetResult !== null && fillMode !== 'fill' ? 'shortest' : sortChoice;

    const sorted = evaluated.slice().sort((a, b) => compareSort(a, b, effectiveSort));

    // Assign CSS order (1-indexed)
    sorted.forEach((v, idx) => {
      v.cssOrder = idx + 1;
    });

    // Map back to original list order so callers can update DOM rows directly
    const byOriginalIndex = new Array(evaluated.length);
    for (const v of sorted) {
      byOriginalIndex[v.originalIndex] = v;
    }

    const graded = watchedCount + unwatchedCount;
    const progressPct = videos.length ? Math.round((watchedCount / videos.length) * 100) : 0;

    return {
      videos: byOriginalIndex,
      stats: {
        totalVideos: videos.length,
        totalSec,
        unwatchedSec,
        watchedCount,
        unwatchedCount,
        noLengthCount,
        budgetResult,
        fittedCount: budgetResult ? budgetResult.count : null,
        fittedSec: budgetResult ? budgetResult.totalSec : null,
        speed,
        fillMode,
        unwatchedWatchSec: atSpeed(unwatchedSec, speed),
        fittedWatchSec: budgetResult ? atSpeed(budgetResult.totalSec, speed) : null,
        speedBoard: watchTimesAtSpeeds(unwatchedSec),
        totalAtSpeeds: watchTimesAtSpeeds(totalSec),
        queryActive: titleActive,
        channelActive: channelFilterActive,
        bandActive,
        durationBand,
        matchCount,
        progressPct,
        gradedCount: graded,
      },
    };
  }

  function progressSnapshot(stats, meta, now = Date.now()) {
    const listId = meta && typeof meta.listId === 'string' ? meta.listId : '';
    if (!/^[\w-]{1,80}$/.test(listId) || !stats) return null;
    let title = meta.title ? String(meta.title).replace(/\s+/g, ' ').trim() : '';
    if (!title) title = 'Playlist';
    const total = clampInt(stats.totalVideos, 0, 100000, 0);
    const watched = clampInt(stats.watchedCount, 0, 100000, 0);
    return {
      listId,
      title: title.slice(0, 140),
      total,
      watched,
      unwatchedSec: clampInt(stats.unwatchedSec, 0, 1e9, 0),
      pct: total ? Math.round((watched / total) * 100) : 0,
      updatedAt: Number.isFinite(now) ? now : Date.now(),
    };
  }

  function sanitizeProgress(raw) {
    const input = raw && typeof raw === 'object' ? raw : {};
    const entries = [];
    for (const [key, val] of Object.entries(input)) {
      if (!val || typeof val !== 'object') continue;
      const listId = String(val.listId || key);
      if (!/^[\w-]{1,80}$/.test(listId)) continue;
      let title = String(val.title || 'Playlist').replace(/\s+/g, ' ').trim().slice(0, 140);
      if (!title) title = 'Playlist';
      entries.push({
        listId,
        title,
        total: clampInt(val.total, 0, 100000, 0),
        watched: clampInt(val.watched, 0, 100000, 0),
        unwatchedSec: clampInt(val.unwatchedSec, 0, 1e9, 0),
        pct: clampInt(val.pct, 0, 100, 0),
        updatedAt: Number.isFinite(Number(val.updatedAt)) ? Number(val.updatedAt) : 0,
      });
    }
    entries.sort((a, b) => b.updatedAt - a.updatedAt);
    const out = {};
    for (const entry of entries.slice(0, PROGRESS_LIMIT)) out[entry.listId] = entry;
    return out;
  }

  function mergeProgress(store, snapshot) {
    const base = sanitizeProgress(store);
    if (!snapshot || !snapshot.listId) return base;
    base[snapshot.listId] = snapshot;
    return sanitizeProgress(base);
  }

  function listRecentProgress(raw) {
    return Object.values(sanitizeProgress(raw)).sort((a, b) => b.updatedAt - a.updatedAt);
  }

  // Course order, skipping watched and zero-remaining rows. A video longer than one day
  // takes a day of its own and is marked overrun instead of being split in half.
  function planStudy(videos, options = {}) {
    const dayCount = clampInt(options.days, 1, 60, DEFAULTS.studyDays);
    const minutesPerDay = clampInt(options.minutesPerDay, 1, 600, DEFAULTS.studyMinutes);
    const speed = normalizeSpeed(options.speed);
    const perDaySec = Math.round(minutesPerDay * 60 * speed);
    const queue = (Array.isArray(videos) ? videos : []).filter(v => {
      if (!v || v.isWatched) return false;
      const rem = v.remainingSec !== null && v.remainingSec !== undefined ? v.remainingSec : v.durationSec;
      return typeof rem === 'number' && rem > 0;
    });
    const days = [];
    const overflow = [];
    let bucket = [];
    let bucketSec = 0;
    const flush = () => {
      if (!bucket.length) return;
      const totalSec = bucketSec;
      days.push({
        day: days.length + 1,
        videos: bucket,
        totalSec,
        watchSec: atSpeed(totalSec, speed),
        overrun: bucket.length === 1 && bucket[0].durationSec > perDaySec,
      });
      bucket = [];
      bucketSec = 0;
    };
    for (const v of queue) {
      const rem = Math.round(v.remainingSec !== null && v.remainingSec !== undefined ? v.remainingSec : v.durationSec);
      const item = { id: v.id, title: v.title || 'Untitled', durationSec: rem };
      if (days.length >= dayCount) {
        overflow.push(item);
        continue;
      }
      if (bucket.length && bucketSec + rem > perDaySec) flush();
      if (days.length >= dayCount) {
        overflow.push(item);
        continue;
      }
      bucket.push(item);
      bucketSec += rem;
      if (rem > perDaySec) flush();
    }
    if (days.length < dayCount) flush();
    return {
      days,
      overflow,
      perDaySec,
      minutesPerDay,
      dayCount,
      speed,
      scheduledCount: days.reduce((n, day) => n + day.videos.length, 0),
      overflowCount: overflow.length,
    };
  }

  function csvCell(value) {
    let s = value === null || value === undefined ? '' : String(value);
    if (/^[=+\-@]/.test(s)) s = `'${s}`;
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  }

  function videosToCsv(videos) {
    const header = ['position', 'id', 'title', 'channel', 'duration_sec', 'remaining_sec', 'watched_percent', 'views', 'age_days', 'url', 'visible'];
    const lines = [header.join(',')];
    (videos || []).forEach((v, i) => {
      const pos = v.originalIndex != null ? v.originalIndex + 1 : i + 1;
      const age = v.ageDays == null || Number.isNaN(v.ageDays) ? '' : Math.round(v.ageDays * 100) / 100;
      lines.push([
        pos,
        v.id ?? '',
        v.title ?? '',
        v.channel ?? '',
        v.durationSec ?? '',
        v.remainingSec ?? '',
        v.watchedPct ?? '',
        v.views ?? '',
        age,
        v.url || v.href || '',
        v.visible === false ? 'no' : 'yes',
      ].map(csvCell).join(','));
    });
    return `${lines.join('\n')}\n`;
  }

  function mdCell(value) {
    return String(value ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
  }

  function videosToMarkdown(videos, meta = {}) {
    const title = meta.title || 'Playlist';
    const lines = [`# ${title.replace(/\s+/g, ' ').trim() || 'Playlist'}`, ''];
    if (meta.summary) lines.push(meta.summary, '');
    const rows = (videos || []).filter(v => !meta.visibleOnly || v.visible !== false);
    if (!rows.length) {
      lines.push('No videos in this export.', '');
      return `${lines.join('\n')}\n`;
    }
    lines.push('| # | Video | Channel | Length | Left | Watched |', '| --- | --- | --- | --- | --- | --- |');
    for (const v of rows) {
      const pos = v.originalIndex != null ? v.originalIndex + 1 : '';
      lines.push(`| ${pos} | ${mdCell(v.title)} | ${mdCell(v.channel)} | ${v.durationSec == null ? '' : formatRuntime(v.durationSec)} | ${v.remainingSec == null ? '' : formatRuntime(v.remainingSec)} | ${v.watchedPct == null ? '' : `${Math.round(v.watchedPct)}%`} |`);
    }
    lines.push('');
    return `${lines.join('\n')}\n`;
  }

  function studyToMarkdown(plan, meta = {}) {
    const title = (meta.title || 'Playlist').replace(/\s+/g, ' ').trim() || 'Playlist';
    const lines = [`# Study plan: ${title}`, ''];
    if (!plan) return `${lines.join('\n')}\n`;
    lines.push(
      `${plan.minutesPerDay} min a day at ${formatSpeed(plan.speed)} (${formatRuntime(plan.perDaySec)} of video per day).`,
      '',
    );
    if (!plan.days.length) {
      lines.push('Nothing left to schedule.', '');
      return `${lines.join('\n')}\n`;
    }
    for (const day of plan.days) {
      const note = day.overrun ? ' (longer than one day)' : '';
      lines.push(`## Day ${day.day}${note} — ${formatRuntime(day.watchSec)} of watching`);
      for (const v of day.videos) {
        lines.push(`- [ ] ${String(v.title || 'Untitled').replace(/\s+/g, ' ').trim()} (${formatRuntime(v.durationSec)})`);
      }
      lines.push('');
    }
    if (plan.overflow && plan.overflow.length) {
      lines.push(`## Still to schedule (${plan.overflow.length})`);
      for (const v of plan.overflow) {
        lines.push(`- [ ] ${String(v.title || 'Untitled').replace(/\s+/g, ' ').trim()} (${formatRuntime(v.durationSec)})`);
      }
      lines.push('');
    }
    return `${lines.join('\n')}\n`;
  }

  // Support asks:
  // - Ko-fi card after 10th time budget or sort applied, once
  // - Rating card after 7 days of use, once
  // - Both dismissible forever
  function nextCard(stats, now = Date.now(), storeUrl = STORE_URL) {
    if (!stats) return null;
    if (stats.dismissedForever) return null;
    const seen = Array.isArray(stats.seenCards) ? stats.seenCards : [];

    // Milestone: 10 uses
    if ((stats.useCount || 0) >= 10 && !seen.includes('kofi')) {
      return 'kofi';
    }

    // Rating card after 7 days
    if (
      stats.firstUseDate &&
      now - stats.firstUseDate >= 7 * DAY_MS &&
      !seen.includes('rating') &&
      storeUrl &&
      /^https?:\/\//.test(storeUrl)
    ) {
      return 'rating';
    }

    return null;
  }

  const api = {
    DAY_MS,
    KOFI_URL,
    STORE_URL,
    SETTINGS_VERSION,
    PROGRESS_LIMIT,
    DEFAULTS,
    SORT_CHOICES,
    FILL_MODES,
    DURATION_BANDS,
    SPEEDS,
    SPEED_BOARD,
    normalizeSpeed,
    atSpeed,
    watchTimesAtSpeeds,
    formatSpeed,
    parseDuration,
    parseAriaDuration,
    parseCount,
    parseViewCount,
    parseAgeDays,
    parseMetaLine,
    interpretRow,
    readHealth,
    parseLoadedAndTotal,
    parseWatchedPct,
    isWatched,
    isWatchLaterRemoveLabel,
    isWatchLaterList,
    remaining,
    formatRuntime,
    formatDurationBadge,
    parseQuery,
    matchesQuery,
    passesDurationBand,
    pickForBudget,
    fillTime,
    evaluatePlaylist,
    progressSnapshot,
    sanitizeProgress,
    mergeProgress,
    listRecentProgress,
    planStudy,
    videosToCsv,
    videosToMarkdown,
    studyToMarkdown,
    nextCard,
    sanitizeSettings,
    migrateSettings,
  };

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.PlaylistLensLib = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
