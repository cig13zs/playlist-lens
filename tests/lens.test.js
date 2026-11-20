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

test('parseQuery splits words, quoted phrases and minus words', () => {
  assert.deepEqual(L.parseQuery(''), { include: [], exclude: [] });
  assert.deepEqual(L.parseQuery('  React   Hooks '), { include: ['react', 'hooks'], exclude: [] });
  assert.deepEqual(L.parseQuery('lecture -shorts'), { include: ['lecture'], exclude: ['shorts'] });
  assert.deepEqual(L.parseQuery('"full course" -"part 2"'), { include: ['full course'], exclude: ['part 2'] });
  assert.deepEqual(L.parseQuery('- -- ""'), { include: [], exclude: [] });
});

test('matchesQuery ignores case and accents and needs every word', () => {
  assert.equal(L.matchesQuery('Anything at all', ''), true);
  assert.equal(L.matchesQuery('Anything at all', '   '), true);
  assert.equal(L.matchesQuery('React Hooks in 10 minutes', 'hooks react'), true);
  assert.equal(L.matchesQuery('React Hooks in 10 minutes', 'react vue'), false);
  assert.equal(L.matchesQuery('Café au lait', 'CAFE'), true);
  assert.equal(L.matchesQuery('Lecture 3 #shorts', 'lecture -shorts'), false);
  assert.equal(L.matchesQuery('Lecture 3', 'lecture -shorts'), true);
  assert.equal(L.matchesQuery('A full course, part 2', '"full course" -"part 2"'), false);
  assert.equal(L.matchesQuery(null, 'x'), false);
});

test('evaluatePlaylist hides rows that miss the title filter and budgets only the matches', () => {
  const list = [
    { id: 'a', title: 'Intro to Rust', durationText: '5:00' },
    { id: 'b', title: 'Cooking pasta', durationText: '2:00' },
    { id: 'c', title: 'Rust ownership', durationText: '20:00' },
    { id: 'd', title: 'Rust traits', durationText: '9:00', watchedPct: 95 },
    { id: 'e', title: 'Rust macros', durationText: '12:00' },
  ];

  const res = L.evaluatePlaylist(list, { hideWatched: true, query: 'rust' });
  assert.equal(res.stats.queryActive, true);
  assert.equal(res.stats.matchCount, 3); // a, c, e; d is a watched match
  assert.equal(res.videos[1].visible, false);
  assert.equal(res.videos[1].hiddenReason, 'query');
  assert.equal(res.videos[3].hiddenReason, 'watched');
  assert.deepEqual(res.videos.filter(v => v.visible).map(v => v.id), ['a', 'c', 'e']);

  // 18 min budget: the 2 min pasta video would fit but doesn't match, so only a (5) + e (12) fit.
  const budget = L.evaluatePlaylist(list, { hideWatched: true, query: 'rust', budgetMinutes: '18' });
  assert.equal(budget.stats.fittedCount, 2);
  assert.equal(budget.stats.fittedSec, 17 * 60);
  assert.deepEqual(budget.videos.filter(v => v.visible).map(v => v.id), ['a', 'e']);

  const none = L.evaluatePlaylist(list, { hideWatched: true, query: '' });
  assert.equal(none.stats.queryActive, false);
  assert.equal(none.stats.matchCount, null);
  assert.equal(none.videos.filter(v => v.visible).length, 4);
});

test('normalizeSpeed, atSpeed and formatSpeed', () => {
  assert.equal(L.normalizeSpeed(1.5), 1.5);
  assert.equal(L.normalizeSpeed('1.25'), 1.25);
  assert.equal(L.normalizeSpeed(3), 1);
  assert.equal(L.normalizeSpeed('fast'), 1);
  assert.equal(L.normalizeSpeed(undefined), 1);
  assert.equal(L.atSpeed(3600, 2), 1800);
  assert.equal(L.atSpeed(600, 1.5), 400);
  assert.equal(L.atSpeed(100, 1.75), 57);
  assert.equal(L.atSpeed(null, 2), null);
  assert.equal(L.formatSpeed(1.75), '1.75x');
  assert.equal(L.formatSpeed(9), '1x');
});

test('sanitizeSettings rejects invalid stored values', () => {
  const cleaned = L.sanitizeSettings({
    sortChoice: 'evil',
    budgetMinutes: '12abc',
    hideWatched: false,
    speed: 99,
    useCount: -5,
    firstUseDate: 'nope',
    seenCards: ['kofi', 'bogus', 'rating', 'rating'],
    dismissedForever: 1,
    dismissedFirstRunHint: true,
  });
  assert.equal(cleaned.sortChoice, 'default');
  assert.equal(cleaned.budgetMinutes, '12');
  assert.equal(cleaned.hideWatched, false);
  assert.equal(cleaned.speed, 1);
  assert.equal(cleaned.useCount, 0);
  assert.equal(cleaned.firstUseDate, null);
  assert.deepEqual(cleaned.seenCards, ['kofi', 'rating']);
  assert.equal(cleaned.dismissedForever, false);
  assert.equal(cleaned.dismissedFirstRunHint, true);
  assert.equal(L.sanitizeSettings({ budgetMinutes: '99999' }).budgetMinutes, '9999');
});

test('evaluatePlaylist fits more video into the budget at higher speeds', () => {
  const list = [
    { id: 'a', title: 'a', durationText: '10:00' },
    { id: 'b', title: 'b', durationText: '12:00' },
    { id: 'c', title: 'c', durationText: '15:00' },
    { id: 'd', title: 'd', durationText: '20:00', watchedPct: 50 },
  ];

  // 1x, 30 min: a (10) + d (10 left) = 20; b would make 32.
  const normal = L.evaluatePlaylist(list, { budgetMinutes: '30' });
  assert.equal(normal.stats.speed, 1);
  assert.equal(normal.stats.fittedCount, 2);
  assert.equal(normal.stats.fittedWatchSec, 20 * 60);

  // 1.5x, 30 min holds 45 min of video: a + d + b = 32, adding c would be 47.
  const faster = L.evaluatePlaylist(list, { budgetMinutes: '30', speed: 1.5 });
  assert.equal(faster.stats.fittedCount, 3);
  assert.equal(faster.stats.fittedSec, 32 * 60);
  assert.equal(faster.stats.fittedWatchSec, 1280); // 21 m 20 s
  assert.deepEqual(faster.videos.filter(v => v.visible).map(v => v.id).sort(), ['a', 'b', 'd']);

  // 2x, 30 min holds 60 min: all four (47 min of video) fit in 23 m 30 s.
  const double = L.evaluatePlaylist(list, { budgetMinutes: '30', speed: 2 });
  assert.equal(double.stats.fittedCount, 4);
  assert.equal(double.stats.fittedWatchSec, 1410);

  // Totals: 47 min unwatched content, 23 m 30 s at 2x. Bad speeds fall back to 1x.
  assert.equal(double.stats.unwatchedSec, 47 * 60);
  assert.equal(double.stats.unwatchedWatchSec, 1410);
  assert.equal(L.evaluatePlaylist(list, { speed: 4 }).stats.unwatchedWatchSec, 47 * 60);
});

test('watchTimesAtSpeeds reports remaining time at 1x, 1.25x, 1.5x, and 2x', () => {
  const board = L.watchTimesAtSpeeds(7200);
  assert.deepEqual(board.map(row => row.speed), [1, 1.25, 1.5, 2]);
  assert.equal(board[0].watchSec, 7200);
  assert.equal(board[1].watchSec, 5760);
  assert.equal(board[2].watchSec, 4800);
  assert.equal(board[3].watchSec, 3600);
  assert.equal(L.watchTimesAtSpeeds(null)[0].watchSec, null);
});

test('migrateSettings keeps a v1 blob and fills v2 defaults', () => {
  const v1 = {
    budgetMinutes: '30',
    hideWatched: false,
    sortChoice: 'longest',
    speed: 1.5,
    useCount: 12,
    firstUseDate: 1700000000000,
    seenCards: ['kofi'],
    dismissedFirstRunHint: true,
  };
  const cleaned = L.sanitizeSettings(v1);
  assert.equal(cleaned.budgetMinutes, '30');
  assert.equal(cleaned.hideWatched, false);
  assert.equal(cleaned.sortChoice, 'longest');
  assert.equal(cleaned.speed, 1.5);
  assert.equal(cleaned.useCount, 12);
  assert.equal(cleaned.firstUseDate, 1700000000000);
  assert.deepEqual(cleaned.seenCards, ['kofi']);
  assert.equal(cleaned.fillMode, 'most');
  assert.equal(cleaned.showSpeedBoard, true);
  assert.equal(cleaned.rememberProgress, true);
  assert.equal(cleaned.studyDays, 5);
  assert.equal(cleaned.studyMinutes, 45);
  assert.equal(cleaned.settingsVersion, 2);
  assert.equal(L.sanitizeSettings({ sort: 'short' }).sortChoice, 'shortest');
  assert.equal(L.sanitizeSettings({ playbackSpeed: 2 }).speed, 2);
  assert.equal(L.sanitizeSettings({ fillMode: 'nope', studyDays: 0, studyMinutes: 9000 }).fillMode, 'most');
  assert.equal(L.sanitizeSettings({ studyDays: 0 }).studyDays, 1);
  assert.equal(L.sanitizeSettings({ studyMinutes: 9000 }).studyMinutes, 600);
  const original = { sort: 'long' };
  L.sanitizeSettings(original);
  assert.equal(original.sortChoice, undefined);
});

test('parseViewCount, parseAgeDays, and parseMetaLine read a YouTube byline', () => {
  assert.equal(L.parseViewCount('1.2M views'), 1200000);
  assert.equal(L.parseViewCount('3,200 views'), 3200);
  assert.equal(L.parseViewCount('10M views'), 10000000);
  assert.equal(L.parseViewCount('2.1M views'), 2100000);
  assert.equal(L.parseViewCount('No views'), 0);
  assert.equal(L.parseViewCount(''), null);
  assert.equal(L.parseViewCount('Computer Science Hub'), null);

  assert.equal(L.parseAgeDays('2 days ago'), 2);
  assert.equal(L.parseAgeDays('3 weeks ago'), 21);
  assert.equal(L.parseAgeDays('yesterday'), 1);
  assert.equal(L.parseAgeDays('2 years ago'), 730.5);
  const now = Date.UTC(2026, 0, 20);
  assert.equal(L.parseAgeDays('2026-01-18', now), 2);
  assert.ok(Math.abs(L.parseAgeDays('Jan 2, 2024', now) - (now - Date.UTC(2024, 0, 2)) / 864e5) < 0.001);

  const meta = L.parseMetaLine('Computer Science Hub • 120,000 views • 2 years ago');
  assert.equal(meta.channel, 'Computer Science Hub');
  assert.equal(meta.views, 120000);
  assert.equal(meta.ageDays, 730.5);
  assert.equal(L.parseMetaLine('3Blue1Brown').channel, '3Blue1Brown');
  assert.equal(L.parseMetaLine('3Blue1Brown').views, null);
});

test('interpretRow prefers the badge and falls back to an aria-label duration', () => {
  assert.equal(L.interpretRow({ title: 'A', badgeText: '1:00', ariaLabels: ['2 minutes'] }).durationSec, 60);
  const aria = L.interpretRow({
    title: 'Office hours',
    badgeText: '',
    ariaLabels: ['Office hours 12 minutes, 4 seconds'],
    metaText: 'Queue School • 4,200 views • 5 days ago',
  });
  assert.equal(aria.durationSec, 724);
  assert.equal(aria.channel, 'Queue School');
  assert.equal(aria.views, 4200);
  assert.equal(aria.ageDays, 5);
  assert.equal(L.parseAriaDuration('1 hour, 2 minutes, 3 seconds'), 3723);
  assert.equal(L.parseAriaDuration('LIVE'), null);
});

test('readHealth warns when lengths disappear and stays quiet when the row is readable', () => {
  const ok = L.readHealth([
    { title: 'One', durationSec: 60 },
    { title: 'Two', durationSec: 120 },
    { title: 'Three', durationSec: 30 },
  ]);
  assert.equal(ok.ok, true);
  const broken = L.readHealth([
    { title: 'One', durationSec: null },
    { title: 'Two', durationSec: null },
    { title: 'Three', durationSec: 30 },
  ]);
  assert.equal(broken.ok, false);
  assert.equal(broken.level, 'lengths');
  assert.match(broken.message, /1 of 3/);
  assert.equal(L.readHealth([]).level, 'empty');
});

test('fillTime packs more minutes than shortest-first when a longer pair fits', () => {
  const videos = [
    { id: 'a', remainingSec: 14 * 60 },
    { id: 'b', remainingSec: 12 * 60 },
    { id: 'c', remainingSec: 11 * 60 },
    { id: 'd', remainingSec: 10 * 60 },
  ];
  const greedy = L.pickForBudget(videos, 25 * 60);
  assert.equal(greedy.totalSec, 21 * 60);
  const fill = L.fillTime(videos, 25 * 60);
  assert.equal(fill.totalSec, 25 * 60);
  assert.equal(fill.count, 2);
  assert.ok(fill.pickedIds.has('a'));
  assert.ok(fill.pickedIds.has('c'));

  // Same filled time: prefer more videos over one long video.
  const tie = L.fillTime([
    { id: 'long', remainingSec: 600 },
    { id: 'a', remainingSec: 360 },
    { id: 'b', remainingSec: 240 },
  ], 600);
  assert.equal(tie.totalSec, 600);
  assert.equal(tie.count, 2);
  assert.ok(tie.pickedIds.has('a') && tie.pickedIds.has('b'));
  assert.ok(!tie.pickedIds.has('long'));

  const all = L.fillTime([{ id: 'a', remainingSec: 10 }, { id: 'b', remainingSec: 20 }], 100);
  assert.equal(all.count, 2);
  assert.equal(all.totalSec, 30);
  assert.equal(L.fillTime([{ id: 'a', remainingSec: 500 }], 100).count, 0);
});

test('evaluatePlaylist sorts by views, date, and channel and can fill the budget', () => {
  const list = [
    { id: 'old', title: 'Old hit', durationText: '10:00', channel: 'Zebra', views: 50, ageDays: 400 },
    { id: 'new', title: 'New clip', durationText: '4:00', channel: 'Alpha', views: 10, ageDays: 2 },
    { id: 'mid', title: 'Middle', durationText: '25:00', channel: 'Alpha', views: 1000, ageDays: 30 },
  ];
  const newest = L.evaluatePlaylist(list, { hideWatched: false, sortChoice: 'newest' });
  assert.deepEqual(newest.videos.map(v => v.id).sort((a, b) => newest.videos.find(x => x.id === a).cssOrder - newest.videos.find(x => x.id === b).cssOrder), ['new', 'mid', 'old']);

  const popular = L.evaluatePlaylist(list, { hideWatched: false, sortChoice: 'mostViews' });
  assert.equal(popular.videos.find(v => v.id === 'mid').cssOrder, 1);
  assert.equal(popular.videos.find(v => v.id === 'new').cssOrder, 3);

  const byChannel = L.evaluatePlaylist(list, { hideWatched: false, sortChoice: 'channel' });
  assert.ok(byChannel.videos.find(v => v.id === 'old').cssOrder > byChannel.videos.find(v => v.id === 'new').cssOrder);

  const channel = L.evaluatePlaylist(list, { hideWatched: false, channel: 'alpha' });
  assert.deepEqual(channel.videos.filter(v => v.visible).map(v => v.id), ['new', 'mid']);
  assert.equal(channel.videos.find(v => v.id === 'old').hiddenReason, 'channel');

  const band = L.evaluatePlaylist(list, { hideWatched: false, durationBand: 'over30' });
  assert.deepEqual(band.videos.filter(v => v.visible).map(v => v.id), []);
  const midBand = L.evaluatePlaylist(list, { hideWatched: false, durationBand: 'under10' });
  // 10:00 is still "under 10 min" (the band is remaining <= 10:00).
  assert.deepEqual(midBand.videos.filter(v => v.visible).map(v => v.id), ['old', 'new']);

  // 25 min, most-videos packs 4 + 10 = 14. Fill-the-time takes the 25 min video.
  const most = L.evaluatePlaylist(list, { hideWatched: false, budgetMinutes: '25', fillMode: 'most' });
  assert.equal(most.stats.fittedSec, 14 * 60);
  const fill = L.evaluatePlaylist(list, { hideWatched: false, budgetMinutes: '25', fillMode: 'fill' });
  assert.equal(fill.stats.fittedSec, 25 * 60);
  assert.deepEqual(fill.videos.filter(v => v.visible).map(v => v.id), ['mid']);
  assert.equal(fill.stats.speedBoard.length, 4);
});

test('planStudy splits a course across days and does not cut a video in half', () => {
  const videos = [
    { id: 'a', title: 'Intro', remainingSec: 20 * 60, isWatched: false },
    { id: 'b', title: 'Next', remainingSec: 20 * 60, isWatched: false },
    { id: 'c', title: 'Long', remainingSec: 50 * 60, isWatched: false },
    { id: 'd', title: 'Done', remainingSec: 0, isWatched: true },
    { id: 'e', title: 'Tail', remainingSec: 10 * 60, isWatched: false },
  ];
  const plan = L.planStudy(videos, { days: 3, minutesPerDay: 30, speed: 1 });
  assert.equal(plan.days.length, 3);
  assert.deepEqual(plan.days[0].videos.map(v => v.id), ['a']);
  assert.deepEqual(plan.days[1].videos.map(v => v.id), ['b']);
  assert.equal(plan.days[2].overrun, true);
  assert.deepEqual(plan.days[2].videos.map(v => v.id), ['c']);
  assert.deepEqual(plan.overflow.map(v => v.id), ['e']);
  assert.match(L.studyToMarkdown(plan, { title: 'CS50' }), /Day 1/);

  // At 2x, 30 minutes holds 60 minutes of video, so the 50 min lecture fits in one day.
  const fast = L.planStudy(videos.filter(v => v.id === 'c'), { days: 2, minutesPerDay: 30, speed: 2 });
  assert.equal(fast.days.length, 1);
  assert.equal(fast.days[0].overrun, false);
  assert.equal(fast.perDaySec, 3600);
});

test('videosToCsv escapes formulas and videosToMarkdown keeps visible rows', () => {
  const csv = L.videosToCsv([
    { id: 'a', title: '=cmd|inject', channel: 'A', durationSec: 60, remainingSec: 30, watchedPct: 50, views: 10, ageDays: 1.234, url: 'https://www.youtube.com/watch?v=a', visible: true, originalIndex: 0 },
  ]);
  assert.match(csv, /'=cmd\|inject/);
  assert.match(csv, /https:\/\/www\.youtube\.com\/watch\?v=a/);
  const md = L.videosToMarkdown([
    { id: 'a', title: 'Keep', channel: 'A', durationSec: 60, remainingSec: 60, watchedPct: 0, visible: true, originalIndex: 0 },
    { id: 'b', title: 'Hide', channel: 'B', durationSec: 60, remainingSec: 60, watchedPct: 0, visible: false, originalIndex: 1 },
  ], { title: 'Queue', visibleOnly: true });
  assert.match(md, /Keep/);
  assert.doesNotMatch(md, /Hide/);
});

test('progress snapshots stay local-shaped and cap the saved list', () => {
  assert.equal(L.progressSnapshot({ totalVideos: 8, watchedCount: 1, unwatchedSec: 6600 }, { listId: 'WL', title: 'Watch Later' }, 100).pct, 13);
  assert.equal(L.progressSnapshot({ totalVideos: 1, watchedCount: 0, unwatchedSec: 1 }, { listId: '../etc', title: 'x' }), null);
  const store = {};
  let merged = store;
  for (let i = 0; i < 40; i++) {
    merged = L.mergeProgress(merged, L.progressSnapshot(
      { totalVideos: 10, watchedCount: 1, unwatchedSec: 10 },
      { listId: `PL${i}`, title: `Course ${i}` },
      i,
    ));
  }
  const recent = L.listRecentProgress(merged);
  assert.equal(recent.length, L.PROGRESS_LIMIT);
  assert.equal(recent[0].listId, 'PL39');
  assert.equal(L.isWatchLaterRemoveLabel('Remove from Watch Later'), true);
  assert.equal(L.isWatchLaterRemoveLabel('  remove   from watch later '), true);
  assert.equal(L.isWatchLaterRemoveLabel('Delete playlist'), false);
  assert.equal(L.isWatchLaterRemoveLabel('Remove from playlist'), false);
  assert.equal(L.isWatchLaterList('WL'), true);
  assert.equal(L.isWatchLaterList('PLxxxx'), false);
});
