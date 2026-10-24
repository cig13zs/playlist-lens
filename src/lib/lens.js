// Pure logic for Playlist Lens: no DOM and no chrome.* calls.
// Loaded as a content script, by popup/options, and by Node unit tests.
(function (root) {
  'use strict';

  const DAY_MS = 864e5;
  const KOFI_URL = 'https://ko-fi.com/jju1s';
  const STORE_URL = 'https://chromewebstore.google.com/detail/olpginhinkaacjcfncphknhnmignoimo/reviews';

  const DEFAULTS = Object.freeze({
    budgetMinutes: '',
    hideWatched: true,
    sortChoice: 'default', // 'default' | 'shortest' | 'longest'
    useCount: 0,
    firstUseDate: null,
    seenCards: [], // ['kofi', 'rating']
  });

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

  function parseCount(str) {
    if (typeof str !== 'string' && typeof str !== 'number') return null;
    const s = String(str).replace(/,/g, '').trim();
    // Match first sequence of digits
    const m = s.match(/\d+/);
    return m ? parseInt(m[0], 10) : null;
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

  // True when the title has every included word and none of the excluded ones. A blank query
  // matches everything.
  function matchesQuery(title, query) {
    const q = typeof query === 'string' ? parseQuery(query) : query;
    if (!q || (!q.include.length && !q.exclude.length)) return true;
    const t = foldText(title);
    return q.include.every(w => t.includes(w)) && !q.exclude.some(w => t.includes(w));
  }

  // Shortest first, include while running total fits budgetSec.
  // One video longer than the budget is excluded, not truncated.
  function pickForBudget(videos, budgetSec) {
    if (budgetSec === null || budgetSec === undefined || budgetSec === '') {
      return null; // No budget filter
    }
    const bSec = Number(budgetSec);
    if (isNaN(bSec) || bSec <= 0) {
      return { pickedIds: new Set(), totalSec: 0, count: 0 };
    }

    // Filter to videos that have a readable length and are not already 0 remaining
    const candidates = videos
      .filter(v => {
        const eff = v.remainingSec !== null && v.remainingSec !== undefined ? v.remainingSec : v.durationSec;
        return eff !== null && eff !== undefined && eff > 0 && eff <= bSec;
      })
      .slice()
      .sort((a, b) => {
        const durA = a.remainingSec !== null && a.remainingSec !== undefined ? a.remainingSec : a.durationSec;
        const durB = b.remainingSec !== null && b.remainingSec !== undefined ? b.remainingSec : b.durationSec;
        return durA - durB;
      });

    const pickedIds = new Set();
    let totalSec = 0;

    for (const v of candidates) {
      const dur = v.remainingSec !== null && v.remainingSec !== undefined ? v.remainingSec : v.durationSec;
      if (totalSec + dur <= bSec) {
        pickedIds.add(v.id);
        totalSec += dur;
      }
    }

    return { pickedIds, totalSec, count: pickedIds.size };
  }

  // Applies filters and sorts to the list of videos
  function evaluatePlaylist(videos, options = {}) {
    const {
      budgetMinutes = '',
      hideWatched = true,
      sortChoice = 'default', // 'default' | 'shortest' | 'longest'
      query = '',
    } = options;

    const parsedQuery = parseQuery(query);
    const queryActive = parsedQuery.include.length > 0 || parsedQuery.exclude.length > 0;

    const budgetSec = budgetMinutes !== '' && !isNaN(Number(budgetMinutes))
      ? Math.max(0, Math.floor(Number(budgetMinutes) * 60))
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

      if (durationSec === null) {
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
        durationSec,
        watchedPct,
        isWatched: watched,
        remainingSec: remSec,
        matchesQuery: matchesQuery(v.title, parsedQuery),
      };
    });

    // The budget only picks from videos that match the title filter.
    const budgetResult = budgetSec !== null
      ? pickForBudget(enriched.filter(v => v.matchesQuery), budgetSec)
      : null;
    // Matches still on screen before the budget, so hidden watched videos aren't counted.
    const matchCount = queryActive
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

    // Determine sort ordering
    // When budget filter is active: budget videos are shortest first.
    // Otherwise follow sortChoice.
    // Videos without length go last and keep relative original order.
    const effectiveSort = budgetResult !== null ? 'shortest' : sortChoice;

    const sorted = evaluated.slice().sort((a, b) => {
      if (effectiveSort === 'shortest' || effectiveSort === 'longest') {
        const aNoLen = a.durationSec === null;
        const bNoLen = b.durationSec === null;
        if (aNoLen && !bNoLen) return 1;
        if (!aNoLen && bNoLen) return -1;
        if (aNoLen && bNoLen) return a.originalIndex - b.originalIndex;

        const durA = a.remainingSec !== null ? a.remainingSec : a.durationSec;
        const durB = b.remainingSec !== null ? b.remainingSec : b.durationSec;

        if (durA !== durB) {
          return effectiveSort === 'shortest' ? durA - durB : durB - durA;
        }
      }
      return a.originalIndex - b.originalIndex;
    });

    // Assign CSS order (1-indexed)
    sorted.forEach((v, idx) => {
      v.cssOrder = idx + 1;
    });

    // Map back to original list order so callers can update DOM rows directly
    const byOriginalIndex = new Array(evaluated.length);
    for (const v of sorted) {
      byOriginalIndex[v.originalIndex] = v;
    }

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
        queryActive,
        matchCount,
      },
    };
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
    DEFAULTS,
    parseDuration,
    parseCount,
    parseLoadedAndTotal,
    parseWatchedPct,
    isWatched,
    remaining,
    formatRuntime,
    formatDurationBadge,
    parseQuery,
    matchesQuery,
    pickForBudget,
    evaluatePlaylist,
    nextCard,
  };

  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.PlaylistLensLib = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
