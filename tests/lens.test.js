const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../src/lib/lens.js');

test('parseDuration parses standard colon-separated durations correctly', () => {
  assert.equal(L.parseDuration('0:59'), 59);
  assert.equal(L.parseDuration('59:59'), 3599);
  assert.equal(L.parseDuration('1:00:00'), 3600);
  assert.equal(L.parseDuration('1:02:03'), 3723);
  assert.equal(L.parseDuration('12:34:56'), 45296);
  assert.equal(L.parseDuration('5'), 5);
  assert.equal(L.parseDuration(' 03:15 '), 195);
});

test('parseDuration returns null for invalid, non-duration, or out-of-scope strings', () => {
  assert.equal(L.parseDuration(''), null);
  assert.equal(L.parseDuration('   '), null);
  assert.equal(L.parseDuration(null), null);
  assert.equal(L.parseDuration(undefined), null);
  assert.equal(L.parseDuration('LIVE'), null);
  assert.equal(L.parseDuration('SHORTS'), null);
  assert.equal(L.parseDuration('Premiere'), null);
  assert.equal(L.parseDuration('Upcoming'), null);
  assert.equal(L.parseDuration('3 without a length'), null);
  assert.equal(L.parseDuration('invalid:time:format'), null);

  // Localized non-ASCII digits are explicitly out of scope per BUILD-PROMPT.md
  // (e.g. Arabic digits '١:٠٢:٠٣', Devanagari '१:०२:०३')
  assert.equal(L.parseDuration('١:٠٢:٠٣'), null);
  assert.equal(L.parseDuration('१:०२:०३'), null);
});

test('parseCount parses counts and playlist header strings', () => {
  assert.equal(L.parseCount('312 videos'), 312);
  assert.equal(L.parseCount('1,234 videos'), 1234);
  assert.equal(L.parseCount('42'), 42);
  assert.equal(L.parseCount('No videos'), null);
  assert.equal(L.parseCount(''), null);
});

test('parseLoadedAndTotal parses progress ratios', () => {
  assert.deepEqual(L.parseLoadedAndTotal('100 of 312'), { loaded: 100, total: 312 });
  assert.deepEqual(L.parseLoadedAndTotal('Loaded 100 of 312'), { loaded: 100, total: 312 });
  assert.deepEqual(L.parseLoadedAndTotal('50 / 200 videos'), { loaded: 50, total: 200 });
  assert.deepEqual(L.parseLoadedAndTotal('312 videos'), { loaded: 312, total: 312 });
  assert.equal(L.parseLoadedAndTotal('none'), null);
});

test('parseWatchedPct and isWatched handle width styles and percentages', () => {
  assert.equal(L.parseWatchedPct('width: 50%;'), 50);
  assert.equal(L.parseWatchedPct('width: 90%;'), 90);
  assert.equal(L.parseWatchedPct('width: 95.5%;'), 95.5);
  assert.equal(L.parseWatchedPct('0%'), 0);
  assert.equal(L.parseWatchedPct(null), 0);
  assert.equal(L.parseWatchedPct(undefined), 0);
  assert.equal(L.parseWatchedPct(75), 75);

  assert.equal(L.isWatched(89.9), false);
  assert.equal(L.isWatched(90), true);
  assert.equal(L.isWatched(95), true);
  assert.equal(L.isWatched(100), true);
  assert.equal(L.isWatched(0), false);
  assert.equal(L.isWatched(null), false);
});

test('remaining calculates unwatched remaining time accurately', () => {
  // 600s video (10m)
  assert.equal(L.remaining(600, 0), 600);
  assert.equal(L.remaining(600, null), 600);
  assert.equal(L.remaining(600, 50), 300); // 50% watched -> 5m left
  assert.equal(L.remaining(600, 90), 0);   // >= 90% is watched
  assert.equal(L.remaining(600, 95), 0);
  assert.equal(L.remaining(600, 100), 0);
  assert.equal(L.remaining(null, 50), null);
});

test('formatRuntime formats hours, minutes, and seconds per spec', () => {
  assert.equal(L.formatRuntime(0), '0 m');
  assert.equal(L.formatRuntime(45), '45 s');
  assert.equal(L.formatRuntime(300), '5 m');
  assert.equal(L.formatRuntime(312), '5 m 12 s');
  assert.equal(L.formatRuntime(3600), '1 h 00 m');
  assert.equal(L.formatRuntime(3723), '1 h 02 m');
  assert.equal(L.formatRuntime(111900), '31 h 05 m'); // 31 * 3600 + 5 * 60
  assert.equal(L.formatRuntime(67200), '18 h 40 m');  // 18 * 3600 + 40 * 60
});

test('formatDurationBadge formats compact timestamp badge', () => {
  assert.equal(L.formatDurationBadge(45), '0:45');
  assert.equal(L.formatDurationBadge(312), '5:12');
  assert.equal(L.formatDurationBadge(3723), '1:02:03');
  assert.equal(L.formatDurationBadge(null), '');
});

test('pickForBudget selects shortest videos that fit within budget', () => {
  const videos = [
    { id: 'v1', durationSec: 600, remainingSec: 600 },  // 10 min
    { id: 'v2', durationSec: 1800, remainingSec: 1800 },// 30 min
    { id: 'v3', durationSec: 300, remainingSec: 300 },  // 5 min
    { id: 'v4', durationSec: 900, remainingSec: 900 },  // 15 min
    { id: 'v5', durationSec: null, remainingSec: null }, // no length
  ];

  // Budget of 0 min
  const zero = L.pickForBudget(videos, 0);
  assert.equal(zero.count, 0);
  assert.equal(zero.totalSec, 0);

  // Budget smaller than every video (e.g. 2 min = 120s)
  const tooSmall = L.pickForBudget(videos, 120);
  assert.equal(tooSmall.count, 0);
  assert.equal(tooSmall.totalSec, 0);

  // Budget of 20 min = 1200s:
  // Shortest candidates: v3 (300s), v1 (600s) -> total 900s. Next is v4 (900s), 900+900=1800 > 1200 -> excludes v4
  const res20 = L.pickForBudget(videos, 1200);
  assert.equal(res20.count, 2);
  assert.equal(res20.totalSec, 900);
  assert.ok(res20.pickedIds.has('v3'));
  assert.ok(res20.pickedIds.has('v1'));
  assert.ok(!res20.pickedIds.has('v4'));
  assert.ok(!res20.pickedIds.has('v2'));
  assert.ok(!res20.pickedIds.has('v5'));

  // Budget of 30 min = 1800s:
  // Shortest candidates: v3 (300s), v1 (600s), v4 (900s) -> 300 + 600 + 900 = 1800s exactly (3 videos)
  const res30 = L.pickForBudget(videos, 1800);
  assert.equal(res30.count, 3);
  assert.equal(res30.totalSec, 1800);
  assert.ok(res30.pickedIds.has('v3'));
  assert.ok(res30.pickedIds.has('v1'));
  assert.ok(res30.pickedIds.has('v4'));
  assert.ok(!res30.pickedIds.has('v2'));

  // Empty budget = no filter
  assert.equal(L.pickForBudget(videos, ''), null);
  assert.equal(L.pickForBudget(videos, null), null);
});

test('evaluatePlaylist handles budget, hideWatched, and sorting', () => {
  const sample = [
    { id: 'v1', durationText: '10:00', watchedPct: 0 },    // 600s, unwatched
    { id: 'v2', durationText: '20:00', watchedPct: 95 },   // 1200s, watched (95%)
    { id: 'v3', durationText: '30:00', watchedPct: 50 },   // 1800s, partially watched (50% -> 900s remaining)
    { id: 'v4', durationText: 'LIVE', watchedPct: 0 },     // no duration
    { id: 'v5', durationText: '05:00', watchedPct: 0 },    // 300s, unwatched
  ];

  // 1. Default settings (hideWatched = true, sort = 'default', no budget)
  const resDefault = L.evaluatePlaylist(sample, { hideWatched: true, sortChoice: 'default' });
  assert.equal(resDefault.stats.totalVideos, 5);
  assert.equal(resDefault.stats.watchedCount, 1);
  assert.equal(resDefault.stats.unwatchedCount, 3);
  assert.equal(resDefault.stats.noLengthCount, 1);
  // Unwatched remaining: v1 (600) + v3 remaining (900) + v5 (300) = 1800s
  assert.equal(resDefault.stats.unwatchedSec, 1800);
  // v2 is watched -> hidden
  assert.equal(resDefault.videos[1].visible, false);
  assert.equal(resDefault.videos[1].hiddenReason, 'watched');
  // v1, v3, v4, v5 are visible
  assert.equal(resDefault.videos[0].visible, true);
  assert.equal(resDefault.videos[2].visible, true);
  assert.equal(resDefault.videos[3].visible, true);
  assert.equal(resDefault.videos[4].visible, true);

  // 2. All-watched list
  const allWatched = [
    { id: 'w1', durationText: '10:00', watchedPct: 92 },
    { id: 'w2', durationText: '15:00', watchedPct: 100 },
  ];
  const resAllWatched = L.evaluatePlaylist(allWatched, { hideWatched: true });
  assert.equal(resAllWatched.stats.watchedCount, 2);
  assert.equal(resAllWatched.stats.unwatchedCount, 0);
  assert.equal(resAllWatched.stats.unwatchedSec, 0);
  assert.ok(resAllWatched.videos.every(v => !v.visible));

  // 3. Sort shortest first
  const resShortest = L.evaluatePlaylist(sample, { hideWatched: false, sortChoice: 'shortest' });
  // Sorting order:
  // Effective remaining times:
  // v5: 300s
  // v1: 600s
  // v3: 900s (remaining)
  // v2: 0s (watched)
  // v4: no length -> last
  // With hideWatched=false: v2(0s) < v5(300s) < v1(600s) < v3(900s) < v4(null)
  assert.equal(resShortest.videos[1].cssOrder, 1); // v2
  assert.equal(resShortest.videos[4].cssOrder, 2); // v5
  assert.equal(resShortest.videos[0].cssOrder, 3); // v1
  assert.equal(resShortest.videos[2].cssOrder, 4); // v3
  assert.equal(resShortest.videos[3].cssOrder, 5); // v4 (no length is last)

  // 4. Budget filter (e.g. 20 min = 1200s, hideWatched = true)
  // Eligible unwatched:
  // v5 (300s), v1 (600s), v3 (900s remaining).
  // Shortest first: v5(300s) + v1(600s) = 900s <= 1200s. Adding v3 would be 1800s > 1200s.
  // So v5 and v1 fit; v3 and v4 do not fit.
  const resBudget = L.evaluatePlaylist(sample, { hideWatched: true, budgetMinutes: '20' });
  assert.equal(resBudget.stats.fittedCount, 2);
  assert.equal(resBudget.stats.fittedSec, 900);
  assert.equal(resBudget.videos[4].visible, true); // v5
  assert.equal(resBudget.videos[0].visible, true); // v1
  assert.equal(resBudget.videos[2].visible, false); // v3 (budget)
  assert.equal(resBudget.videos[3].visible, false); // v4 (budget)
  assert.equal(resBudget.videos[1].visible, false); // v2 (watched)
});

test('nextCard manages Ko-fi and Rating support milestones per BUILD-STANDARDS', () => {
  const now = 1760000000000;
  const day = 864e5;

  // New user, 0 uses: no card
  assert.equal(L.nextCard({ useCount: 0, firstUseDate: now, seenCards: [] }, now, 'https://store.example/lens'), null);

  // 9 uses: no card
  assert.equal(L.nextCard({ useCount: 9, firstUseDate: now, seenCards: [] }, now, 'https://store.example/lens'), null);

  // 10th use: triggers kofi card
  assert.equal(L.nextCard({ useCount: 10, firstUseDate: now, seenCards: [] }, now, 'https://store.example/lens'), 'kofi');

  // After kofi is dismissed/seen: no card yet (until 7 days passed for rating)
  assert.equal(L.nextCard({ useCount: 15, firstUseDate: now, seenCards: ['kofi'] }, now + 3 * day, 'https://store.example/lens'), null);

  // After 7 days with valid store URL: triggers rating card
  assert.equal(L.nextCard({ useCount: 15, firstUseDate: now, seenCards: ['kofi'] }, now + 7 * day, 'https://store.example/lens'), 'rating');

  // If store URL is placeholder (STORE_URL), rating card is held
  assert.equal(L.nextCard({ useCount: 15, firstUseDate: now, seenCards: ['kofi'] }, now + 8 * day, 'STORE_URL'), null);

  // If both seen: no cards
  assert.equal(L.nextCard({ useCount: 20, firstUseDate: now, seenCards: ['kofi', 'rating'] }, now + 8 * day, 'https://store.example/lens'), null);

  // If dismissed forever: no cards
  assert.equal(L.nextCard({ useCount: 50, firstUseDate: now, dismissedForever: true, seenCards: [] }, now + 10 * day, 'https://store.example/lens'), null);
});
