// Fit the Queue content script: time left, sort, filter, and study plan on playlist pages.
// Runs on https://www.youtube.com/* on initial load and yt-navigate-finish.

(function () {
  'use strict';

  const Lib = globalThis.PlaylistLensLib;
  const Selectors = globalThis.PlaylistLensSelectors;

  if (!Lib || !Selectors) {
    console.warn('[Fit the Queue] Library or Selectors not loaded.');
    return;
  }

  const BRAND = 'Fit the Queue';
  const STORAGE_KEY = 'playlist_lens_settings';
  const PROGRESS_KEY = 'playlist_lens_progress';
  let observer = null;
  let debounceTimer = null;
  let isLoadingAll = false;
  let isApplying = false;
  let cleanupStop = false;
  let cleanupRunning = false;
  let lastEvaluated = [];
  let lastProgressKey = '';

  // Title, channel, and length filters live only in memory, and only for the playlist
  // they were typed on. They are not written to chrome.storage.
  let titleQuery = '';
  let channelQuery = '';
  let durationBand = 'any';
  let titleQueryListId = null;

  let state = { ...Lib.DEFAULTS, dismissedForever: false };

  function currentListId() {
    try {
      return new URL(window.location.href).searchParams.get('list');
    } catch {
      return null;
    }
  }

  function isPlaylistPage() {
    try {
      const u = new URL(window.location.href);
      return u.pathname === '/playlist' && u.searchParams.has('list');
    } catch {
      return false;
    }
  }

  function clearElement(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  // Local storage wins over sync when both exist (per-device title filter stays in memory only).
  function loadSettings(cb) {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
      if (cb) cb();
      return;
    }
    chrome.storage.local.get([STORAGE_KEY], localResult => {
      const apply = raw => {
        const hadVersion = raw && raw.settingsVersion === Lib.SETTINGS_VERSION;
        state = { ...state, ...Lib.sanitizeSettings(raw) };
        let dirty = !hadVersion;
        if (!state.firstUseDate) {
          state.firstUseDate = Date.now();
          dirty = true;
        }
        // Write the v2 shape once so a v1 install keeps its sort, budget, and speed.
        if (dirty) saveSettings();
        if (cb) cb();
      };
      const localSettings = localResult[STORAGE_KEY];
      if (chrome.storage.sync) {
        chrome.storage.sync.get([STORAGE_KEY], syncResult => {
          apply({ ...syncResult[STORAGE_KEY], ...localSettings });
        });
      } else {
        apply(localSettings);
      }
    });
  }

  function saveSettings() {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
    const payload = Lib.sanitizeSettings(state);
    state = { ...state, ...payload };
    chrome.storage.local.set({ [STORAGE_KEY]: payload });
    if (chrome.storage.sync) {
      chrome.storage.sync.set({ [STORAGE_KEY]: payload });
    }
  }

  function trackAction() {
    state.useCount = (state.useCount || 0) + 1;
    saveSettings();
  }

  // Teardown bar and row modifications
  function teardown() {
    cleanupStop = true;
    cleanupRunning = false;
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    const bar = document.getElementById('playlist-lens-bar');
    if (bar) bar.remove();

    restoreNativeRows();
  }

  function getItemElement(row, container) {
    if (!container) return row;
    let curr = row;
    while (curr && curr.parentElement && curr.parentElement !== container) {
      curr = curr.parentElement;
    }
    if (curr && curr.parentElement === container) {
      return curr;
    }
    return row;
  }

  function restoreNativeRows() {
    const container = document.querySelector(Selectors.CONTAINER);
    if (container) {
      container.classList.remove('playlist-lens-container-active');
      container.classList.remove('playlist-lens-reorder-disabled');
      for (const child of container.children) {
        child.classList.remove('playlist-lens-hidden');
        child.style.removeProperty('--pl-order');
        child.style.removeProperty('order');
      }
    }

    const rows = document.querySelectorAll(Selectors.ROW);
    for (const row of rows) {
      row.classList.remove('playlist-lens-hidden');
      row.style.removeProperty('--pl-order');
      row.style.removeProperty('order');

      const badge = row.querySelector('.playlist-lens-remaining-badge');
      if (badge) badge.remove();
    }
  }

  function collectMetaText(row, titleEl) {
    const selectors = `${Selectors.CHANNEL}, ${Selectors.META}`;
    const bits = [];
    for (const el of row.querySelectorAll(selectors)) {
      if (titleEl && (el === titleEl || titleEl.contains(el) || el.contains(titleEl))) continue;
      const t = el.textContent.replace(/\s+/g, ' ').trim();
      if (!t) continue;
      if (bits.some(bit => bit === t || bit.includes(t))) continue;
      for (let i = bits.length - 1; i >= 0; i--) {
        if (t.includes(bits[i])) bits.splice(i, 1);
      }
      bits.push(t);
    }
    return bits.join(' • ');
  }

  // Extract video data from DOM row. Several fallbacks feed interpretRow so a
  // restyle that drops one badge still leaves a length, channel, or progress.
  function extractRowData(row, idx, container) {
    const itemEl = getItemElement(row, container);
    // Try the title selectors in order: the thumbnail link also matches the generic
    // watch?v= fallback and comes first in the row, but its text is the duration badge.
    let titleEl = null;
    for (const sel of Selectors.TITLE.split(',')) {
      titleEl = row.querySelector(sel.trim());
      if (titleEl && titleEl.textContent.trim()) break;
      titleEl = titleEl || null;
    }
    const title = titleEl && titleEl.textContent.trim() ? titleEl.textContent.trim() : `Video ${idx + 1}`;
    let href = titleEl ? titleEl.getAttribute('href') : '';
    if (!href) {
      const anyLink = row.querySelector('a[href*="watch?v="]');
      if (anyLink) href = anyLink.getAttribute('href');
    }

    let id = null;
    if (href) {
      const m = href.match(/[?&]v=([^&]+)/);
      if (m) id = m[1];
    }
    if (!id) {
      id = row.getAttribute('data-id') || `row-${idx}`;
    }

    const timeBadge = row.querySelector(Selectors.TIME_BADGE);
    const ariaLabels = [];
    for (const el of row.querySelectorAll('[aria-label]')) {
      const label = el.getAttribute('aria-label');
      if (label) ariaLabels.push(label.slice(0, 300));
      if (ariaLabels.length >= 8) break;
    }

    const progressBar = row.querySelector(Selectors.PROGRESS_BAR);
    let watchedPct = null;
    if (progressBar) {
      watchedPct = progressBar.getAttribute('style')
        || progressBar.getAttribute('aria-valuenow')
        || progressBar.getAttribute('aria-valuetext');
    }
    if (!watchedPct) {
      const overlay = row.querySelector('ytd-thumbnail-overlay-resume-playback-renderer, .resume-playback');
      if (overlay) watchedPct = overlay.getAttribute('aria-valuenow') || overlay.getAttribute('aria-label');
    }

    const interpreted = Lib.interpretRow({
      title,
      badgeText: timeBadge ? timeBadge.textContent : '',
      ariaLabels,
      metaText: collectMetaText(row, titleEl),
      watchedPct,
    });
    const url = href
      ? (href.startsWith('http') ? href : `https://www.youtube.com${href.startsWith('/') ? href : `/${href}`}`)
      : (id && !String(id).startsWith('row-') ? `https://www.youtube.com/watch?v=${encodeURIComponent(id)}` : '');

    return {
      el: row,
      itemEl,
      id,
      title: interpreted.title || title,
      href,
      url,
      durationText: interpreted.durationText,
      durationSec: interpreted.durationSec,
      watchedPct: interpreted.watchedPct,
      channel: interpreted.channel,
      views: interpreted.views,
      ageDays: interpreted.ageDays,
      ageLabel: interpreted.ageLabel,
    };
  }

  // Read header playlist total videos count
  function getHeaderTotalCount() {
    const header = document.querySelector(Selectors.HEADER);
    if (!header) return null;
    const statsEls = header.querySelectorAll(Selectors.HEADER_STATS);
    for (const el of statsEls) {
      const text = el.textContent.replace(/\s+/g, ' ').trim();
      const m = text.match(/(\d[\d,]*)\s*videos/i);
      if (m) {
        return parseInt(m[1].replace(/,/g, ''), 10);
      }
    }
    // Fallback: check full header text
    const text = header.textContent.replace(/\s+/g, ' ').trim();
    const m = text.match(/(\d[\d,]*)\s*videos/i);
    return m ? parseInt(m[1].replace(/,/g, ''), 10) : null;
  }

  function getPlaylistTitle() {
    const header = document.querySelector(Selectors.HEADER);
    if (!header) return 'Playlist';
    const heading = header.querySelector(Selectors.PLAYLIST_TITLE);
    const text = (heading ? heading.textContent : '').replace(/\s+/g, ' ').trim();
    return text || 'Playlist';
  }

  // Main evaluation and DOM update pass
  function updateView() {
    if (isApplying || !isPlaylistPage()) return;
    isApplying = true;

    try {
      const container = document.querySelector(Selectors.CONTAINER);
      const rows = document.querySelectorAll(Selectors.ROW);

      const bar = ensureBar();
      if (!bar) {
        isApplying = false;
        return;
      }

      if (rows.length === 0) {
        renderNotice(bar, `${BRAND} couldn't read videos on this page. YouTube's layout may be updating.`);
        isApplying = false;
        return;
      }

      clearNotice(bar);

      const rawVideos = [];
      for (let i = 0; i < rows.length; i++) {
        rawVideos.push(extractRowData(rows[i], i, container));
      }

      const { videos, stats } = Lib.evaluatePlaylist(rawVideos, {
        budgetMinutes: state.budgetMinutes,
        hideWatched: state.hideWatched,
        sortChoice: state.sortChoice,
        query: titleQuery,
        channel: channelQuery,
        durationBand,
        speed: state.speed,
        fillMode: state.fillMode,
      });
      lastEvaluated = videos;

      // Apply to container. Dragging is also off while a filter hides rows, since a drag
      // between the visible rows would save a reorder across the hidden ones.
      if (container) {
        const reordering = state.sortChoice !== 'default' || state.budgetMinutes !== '';
        const filtering = stats.queryActive || stats.channelActive || stats.bandActive;
        container.classList.toggle('playlist-lens-container-active', reordering);
        container.classList.toggle('playlist-lens-reorder-disabled', reordering || filtering);
      }

      // Apply order and visibility per row
      for (let i = 0; i < videos.length; i++) {
        const item = videos[i];
        const row = item.el;
        const itemEl = item.itemEl || getItemElement(row, container);

        // Visibility
        if (item.visible) {
          itemEl.classList.remove('playlist-lens-hidden');
          if (row !== itemEl) row.classList.remove('playlist-lens-hidden');
        } else {
          itemEl.classList.add('playlist-lens-hidden');
          if (row !== itemEl) row.classList.add('playlist-lens-hidden');
        }

        // CSS order
        if (state.sortChoice !== 'default' || state.budgetMinutes !== '') {
          itemEl.style.setProperty('--pl-order', item.cssOrder);
          itemEl.style.order = item.cssOrder;
          if (row !== itemEl) {
            row.style.setProperty('--pl-order', item.cssOrder);
            row.style.order = item.cssOrder;
          }
        } else {
          itemEl.style.removeProperty('--pl-order');
          itemEl.style.removeProperty('order');
          if (row !== itemEl) {
            row.style.removeProperty('--pl-order');
            row.style.removeProperty('order');
          }
        }

        // Partially watched remaining time badge
        const isPartiallyWatched = item.watchedPct > 0 && !item.isWatched && item.remainingSec !== null;
        let remBadge = row.querySelector('.playlist-lens-remaining-badge');
        if (isPartiallyWatched && item.visible) {
          if (!remBadge) {
            remBadge = document.createElement('div');
            remBadge.className = 'playlist-lens-remaining-badge';
            const thumb = row.querySelector('ytd-thumbnail, .thumbnail-container, a#thumbnail');
            if (thumb) {
              thumb.style.position = 'relative';
              thumb.appendChild(remBadge);
            }
          }
          if (remBadge) {
            remBadge.textContent = `${Lib.formatDurationBadge(item.remainingSec)} left`;
          }
        } else if (remBadge) {
          remBadge.remove();
        }
      }

      renderBarUI(bar, stats);
      renderHealth(bar, Lib.readHealth(rawVideos));
      renderFirstRunHint(bar);
      if (!bar.querySelector('#pl-study').hidden) renderStudy(bar, videos);
      if (!bar.querySelector('#pl-cleanup').hidden && !cleanupRunning) renderCleanup(bar, videos);
      rememberProgress(stats);
    } catch (err) {
      console.error('[Fit the Queue] Error updating view:', err);
    } finally {
      isApplying = false;
    }
  }

  function ensureBar() {
    let bar = document.getElementById('playlist-lens-bar');
    if (bar) return bar;

    const target = document.querySelector(Selectors.BAR_TARGET);
    if (!target) return null;

    bar = document.createElement('div');
    bar.id = 'playlist-lens-bar';
    bar.tabIndex = -1;
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', `${BRAND} controls`);

    // Build bar markup using safe elements
    const topRow = document.createElement('div');
    topRow.className = 'playlist-lens-row';

    // Left: runtime statistics & honesty note
    const runtimeGroup = document.createElement('div');
    runtimeGroup.className = 'playlist-lens-runtime-group';

    const brand = document.createElement('div');
    brand.className = 'playlist-lens-brand';
    const mark = document.createElement('span');
    mark.className = 'playlist-lens-mark';
    mark.setAttribute('aria-hidden', 'true');
    const brandName = document.createElement('span');
    brandName.textContent = BRAND;
    brand.appendChild(mark);
    brand.appendChild(brandName);
    runtimeGroup.appendChild(brand);

    const runtimeHeader = document.createElement('div');
    runtimeHeader.className = 'playlist-lens-runtime-header';
    runtimeHeader.id = 'pl-runtime-header';
    runtimeGroup.appendChild(runtimeHeader);

    const progressLine = document.createElement('div');
    progressLine.className = 'playlist-lens-progress';
    progressLine.id = 'pl-progress';
    runtimeGroup.appendChild(progressLine);

    const speedBoard = document.createElement('div');
    speedBoard.className = 'playlist-lens-speed-board';
    speedBoard.id = 'pl-speed-board';
    speedBoard.setAttribute('role', 'group');
    speedBoard.setAttribute('aria-label', 'Time remaining at each playback speed');
    const boardLabel = document.createElement('span');
    boardLabel.className = 'playlist-lens-speed-label';
    boardLabel.textContent = 'Left';
    speedBoard.appendChild(boardLabel);
    for (const speed of Lib.SPEED_BOARD) {
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = 'playlist-lens-chip';
      pill.dataset.speed = String(speed);
      pill.textContent = Lib.formatSpeed(speed);
      pill.title = `Show the budget at ${Lib.formatSpeed(speed)}`;
      pill.setAttribute('aria-pressed', 'false');
      speedBoard.appendChild(pill);
    }
    runtimeGroup.appendChild(speedBoard);

    const completeness = document.createElement('div');
    completeness.className = 'playlist-lens-completeness';
    completeness.id = 'pl-completeness';
    runtimeGroup.appendChild(completeness);

    const filterSummary = document.createElement('div');
    filterSummary.className = 'playlist-lens-filter-summary';
    filterSummary.id = 'pl-filter-summary';
    runtimeGroup.appendChild(filterSummary);

    const budgetSummary = document.createElement('div');
    budgetSummary.className = 'playlist-lens-budget-summary';
    budgetSummary.id = 'pl-budget-summary';
    runtimeGroup.appendChild(budgetSummary);

    topRow.appendChild(runtimeGroup);

    // Right: controls
    const controls = document.createElement('div');
    controls.className = 'playlist-lens-controls';

    // Title filter: words to keep, -word to drop
    const searchBox = document.createElement('div');
    searchBox.className = 'playlist-lens-budget-box playlist-lens-search-box';

    const searchInput = document.createElement('input');
    searchInput.type = 'search';
    searchInput.id = 'pl-title-filter';
    searchInput.className = 'playlist-lens-input playlist-lens-search-input';
    searchInput.placeholder = 'Filter titles';
    searchInput.autocomplete = 'off';
    searchInput.spellcheck = false;
    searchInput.value = titleQuery;
    searchInput.title = 'Show only videos whose title has every word. Put - before a word to hide it.';
    searchInput.setAttribute('aria-label', 'Filter videos by title');

    searchBox.appendChild(searchInput);
    controls.appendChild(searchBox);

    const channelBox = document.createElement('div');
    channelBox.className = 'playlist-lens-budget-box playlist-lens-search-box';
    const channelInput = document.createElement('input');
    channelInput.type = 'search';
    channelInput.id = 'pl-channel-filter';
    channelInput.className = 'playlist-lens-input playlist-lens-search-input';
    channelInput.placeholder = 'Channel';
    channelInput.autocomplete = 'off';
    channelInput.spellcheck = false;
    channelInput.value = channelQuery;
    channelInput.title = 'Keep videos whose channel matches every word. Put - before a word to hide it.';
    channelInput.setAttribute('aria-label', 'Filter videos by channel');
    channelBox.appendChild(channelInput);
    controls.appendChild(channelBox);

    const lengthBox = document.createElement('div');
    lengthBox.className = 'playlist-lens-budget-box';
    const lengthSelect = document.createElement('select');
    lengthSelect.id = 'pl-length-band';
    lengthSelect.className = 'playlist-lens-select';
    lengthSelect.setAttribute('aria-label', 'Filter by length remaining');
    lengthSelect.title = 'Filter by time still left on each video';
    for (const [value, label] of [
      ['any', 'Any length'],
      ['under10', 'Under 10 min'],
      ['mid', '10–30 min'],
      ['over30', 'Over 30 min'],
    ]) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      lengthSelect.appendChild(option);
    }
    lengthSelect.value = durationBand;
    lengthBox.appendChild(lengthSelect);
    controls.appendChild(lengthBox);

    // Minutes input box: "I have __ min"
    const budgetBox = document.createElement('div');
    budgetBox.className = 'playlist-lens-budget-box';

    const budgetLabel = document.createElement('label');
    budgetLabel.setAttribute('for', 'pl-budget-input');
    budgetLabel.textContent = 'I have';

    const budgetInput = document.createElement('input');
    budgetInput.type = 'number';
    budgetInput.id = 'pl-budget-input';
    budgetInput.className = 'playlist-lens-input';
    budgetInput.min = '1';
    budgetInput.max = '9999';
    budgetInput.placeholder = 'min';
    budgetInput.value = state.budgetMinutes;
    budgetInput.setAttribute('aria-label', 'Time budget in minutes');

    const budgetSuffix = document.createElement('span');
    budgetSuffix.className = 'playlist-lens-budget-suffix';
    budgetSuffix.textContent = 'min';

    budgetBox.appendChild(budgetLabel);
    budgetBox.appendChild(budgetInput);
    budgetBox.appendChild(budgetSuffix);
    controls.appendChild(budgetBox);

    // Playback speed: the budget and unwatched total count real time at this speed
    const speedBox = document.createElement('div');
    speedBox.className = 'playlist-lens-budget-box';

    const speedLabel = document.createElement('label');
    speedLabel.setAttribute('for', 'pl-speed');
    speedLabel.textContent = 'at';

    const speedSelect = document.createElement('select');
    speedSelect.id = 'pl-speed';
    speedSelect.className = 'playlist-lens-select';
    speedSelect.title = 'The speed you watch at. Faster speeds fit more videos into your minutes.';
    speedSelect.setAttribute('aria-label', 'Playback speed');
    for (const speed of Lib.SPEEDS) {
      const option = document.createElement('option');
      option.value = String(speed);
      option.textContent = Lib.formatSpeed(speed);
      speedSelect.appendChild(option);
    }
    speedSelect.value = String(Lib.normalizeSpeed(state.speed));

    speedBox.appendChild(speedLabel);
    speedBox.appendChild(speedSelect);
    controls.appendChild(speedBox);

    const fillBox = document.createElement('div');
    fillBox.className = 'playlist-lens-budget-box';
    const fillSelect = document.createElement('select');
    fillSelect.id = 'pl-fill-mode';
    fillSelect.className = 'playlist-lens-select';
    fillSelect.setAttribute('aria-label', 'How to fill the time budget');
    fillSelect.title = 'Most videos packs the shortest ones. Fill the time uses the minutes you have as fully as it can.';
    for (const [value, label] of [
      ['most', 'Most videos'],
      ['fill', 'Fill the time'],
    ]) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      fillSelect.appendChild(option);
    }
    fillSelect.value = Lib.FILL_MODES.includes(state.fillMode) ? state.fillMode : 'most';
    fillBox.appendChild(fillSelect);
    controls.appendChild(fillBox);

    // Sort chips: Default, Shortest, Longest
    const sortGroup = document.createElement('div');
    sortGroup.className = 'playlist-lens-segment';
    sortGroup.setAttribute('role', 'group');
    sortGroup.setAttribute('aria-label', 'Sort order');

    const chipDefault = createChip('Default', 'default', state.sortChoice === 'default');
    const chipShortest = createChip('Shortest', 'shortest', state.sortChoice === 'shortest');
    const chipLongest = createChip('Longest', 'longest', state.sortChoice === 'longest');

    sortGroup.appendChild(chipDefault);
    sortGroup.appendChild(chipShortest);
    sortGroup.appendChild(chipLongest);
    controls.appendChild(sortGroup);

    const moreSort = document.createElement('select');
    moreSort.id = 'pl-sort-more';
    moreSort.className = 'playlist-lens-select playlist-lens-more-sort';
    moreSort.setAttribute('aria-label', 'More sort orders');
    for (const [value, label] of [
      ['', 'More sorts'],
      ['newest', 'Newest'],
      ['oldest', 'Oldest'],
      ['mostViews', 'Most viewed'],
      ['leastViews', 'Least viewed'],
      ['channel', 'Channel A–Z'],
    ]) {
      const option = document.createElement('option');
      option.value = value;
      option.textContent = label;
      moreSort.appendChild(option);
    }
    if (['newest', 'oldest', 'mostViews', 'leastViews', 'channel'].includes(state.sortChoice)) {
      moreSort.value = state.sortChoice;
    }
    controls.appendChild(moreSort);

    // Hide watched toggle
    const toggleLabel = document.createElement('label');
    toggleLabel.className = 'playlist-lens-toggle-chip';

    const toggleCheckbox = document.createElement('input');
    toggleCheckbox.type = 'checkbox';
    toggleCheckbox.id = 'pl-hide-watched';
    toggleCheckbox.checked = state.hideWatched;
    toggleCheckbox.setAttribute('aria-label', 'Hide watched videos');

    const toggleText = document.createElement('span');
    toggleText.textContent = 'Hide watched';

    toggleLabel.appendChild(toggleCheckbox);
    toggleLabel.appendChild(toggleText);
    controls.appendChild(toggleLabel);

    const tools = document.createElement('div');
    tools.className = 'playlist-lens-tools';
    tools.id = 'pl-tools';

    // Load all button
    const loadAllBtn = document.createElement('button');
    loadAllBtn.type = 'button';
    loadAllBtn.className = 'playlist-lens-btn';
    loadAllBtn.id = 'pl-load-all';
    loadAllBtn.textContent = 'Load all';
    tools.appendChild(loadAllBtn);

    const studyBtn = document.createElement('button');
    studyBtn.type = 'button';
    studyBtn.className = 'playlist-lens-btn';
    studyBtn.id = 'pl-study-open';
    studyBtn.textContent = 'Study plan';
    studyBtn.setAttribute('aria-expanded', 'false');
    tools.appendChild(studyBtn);

    const csvBtn = document.createElement('button');
    csvBtn.type = 'button';
    csvBtn.className = 'playlist-lens-btn';
    csvBtn.id = 'pl-export-csv';
    csvBtn.textContent = 'CSV';
    csvBtn.title = 'Download the loaded videos as a CSV file on this device';
    tools.appendChild(csvBtn);

    const mdBtn = document.createElement('button');
    mdBtn.type = 'button';
    mdBtn.className = 'playlist-lens-btn';
    mdBtn.id = 'pl-export-md';
    mdBtn.textContent = 'Markdown';
    mdBtn.title = 'Download the visible videos as a Markdown checklist';
    tools.appendChild(mdBtn);

    const cleanBtn = document.createElement('button');
    cleanBtn.type = 'button';
    cleanBtn.className = 'playlist-lens-btn';
    cleanBtn.id = 'pl-clean-open';
    cleanBtn.textContent = 'Clean watched';
    cleanBtn.hidden = !Lib.isWatchLaterList(currentListId());
    cleanBtn.setAttribute('aria-expanded', 'false');
    tools.appendChild(cleanBtn);

    // Reset button
    const resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.className = 'playlist-lens-btn playlist-lens-btn-reset';
    resetBtn.id = 'pl-reset';
    resetBtn.textContent = 'Reset';
    tools.appendChild(resetBtn);

    topRow.appendChild(controls);
    bar.appendChild(topRow);
    bar.appendChild(tools);

    const hint = document.createElement('div');
    hint.id = 'pl-first-run-hint';
    hint.className = 'playlist-lens-first-run';
    hint.setAttribute('role', 'note');
    hint.hidden = true;
    const hintText = document.createElement('span');
    hintText.textContent =
      'Tip: the Left row is time remaining at 1x–2x. Enter the minutes you have, or open Study plan. Shortcuts: Alt+Shift+F filter, Alt+Shift+R reset.';
    const hintDismiss = document.createElement('button');
    hintDismiss.type = 'button';
    hintDismiss.className = 'playlist-lens-btn-dismiss';
    hintDismiss.textContent = 'Got it';
    hintDismiss.setAttribute('aria-label', 'Dismiss first-run tip');
    hint.appendChild(hintText);
    hint.appendChild(hintDismiss);
    bar.appendChild(hint);

    const empty = document.createElement('div');
    empty.id = 'pl-empty';
    empty.className = 'playlist-lens-empty';
    empty.setAttribute('role', 'status');
    empty.hidden = true;
    bar.appendChild(empty);

    const health = document.createElement('div');
    health.id = 'pl-health';
    health.className = 'playlist-lens-notice';
    health.hidden = true;
    health.setAttribute('role', 'status');
    bar.appendChild(health);

    const study = buildStudyPanel();
    bar.appendChild(study);
    const cleanup = buildCleanupPanel();
    bar.appendChild(cleanup);

    // Card container for support/rating asks
    const cardContainer = document.createElement('div');
    cardContainer.id = 'pl-card-container';
    bar.appendChild(cardContainer);

    // Event listeners
    budgetInput.addEventListener('input', e => {
      state.budgetMinutes = e.target.value.trim();
      saveSettings();
      updateView();
    });

    // Count a budget as used once it is committed (Enter, blur or the spinner), not per keystroke,
    // so typing "30" is one use toward the support card, not two.
    budgetInput.addEventListener('change', () => {
      if (state.budgetMinutes !== '') trackAction();
    });

    const updateSortChips = (choice, fromMore = false) => {
      state.sortChoice = choice;
      setChipActive(chipDefault, choice === 'default');
      setChipActive(chipShortest, choice === 'shortest');
      setChipActive(chipLongest, choice === 'longest');
      if (!fromMore) {
        moreSort.value = ['newest', 'oldest', 'mostViews', 'leastViews', 'channel'].includes(choice) ? choice : '';
      }
      saveSettings();
      trackAction();
      updateView();
    };

    chipDefault.addEventListener('click', () => updateSortChips('default'));
    chipShortest.addEventListener('click', () => updateSortChips('shortest'));
    chipLongest.addEventListener('click', () => updateSortChips('longest'));
    moreSort.addEventListener('change', () => updateSortChips(moreSort.value || 'default', true));

    toggleCheckbox.addEventListener('change', e => {
      state.hideWatched = e.target.checked;
      saveSettings();
      updateView();
    });

    searchInput.addEventListener('input', e => {
      titleQuery = e.target.value;
      titleQueryListId = currentListId();
      updateView();
    });

    channelInput.addEventListener('input', e => {
      channelQuery = e.target.value;
      titleQueryListId = currentListId();
      updateView();
    });

    lengthSelect.addEventListener('change', e => {
      durationBand = Lib.DURATION_BANDS.includes(e.target.value) ? e.target.value : 'any';
      updateView();
    });

    speedSelect.addEventListener('change', e => {
      state.speed = Lib.normalizeSpeed(e.target.value);
      saveSettings();
      updateView();
    });

    speedBoard.addEventListener('click', e => {
      const pill = e.target.closest('button[data-speed]');
      if (!pill) return;
      state.speed = Lib.normalizeSpeed(pill.dataset.speed);
      speedSelect.value = String(state.speed);
      saveSettings();
      updateView();
    });

    fillSelect.addEventListener('change', e => {
      state.fillMode = Lib.FILL_MODES.includes(e.target.value) ? e.target.value : 'most';
      saveSettings();
      updateView();
    });

    loadAllBtn.addEventListener('click', () => {
      runLoadAll();
    });

    const runReset = () => {
      state.budgetMinutes = '';
      state.sortChoice = 'default';
      state.hideWatched = false;
      state.fillMode = 'most';
      state.speed = 1;
      budgetInput.value = '';
      titleQuery = '';
      channelQuery = '';
      durationBand = 'any';
      searchInput.value = '';
      channelInput.value = '';
      lengthSelect.value = 'any';
      fillSelect.value = 'most';
      toggleCheckbox.checked = false;
      speedSelect.value = '1';
      study.hidden = true;
      cleanup.hidden = true;
      studyBtn.setAttribute('aria-expanded', 'false');
      cleanBtn.setAttribute('aria-expanded', 'false');
      updateSortChips('default');
      saveSettings();
      restoreNativeRows();
      updateView();
    };

    studyBtn.addEventListener('click', () => {
      study.hidden = !study.hidden;
      studyBtn.setAttribute('aria-expanded', study.hidden ? 'false' : 'true');
      if (!study.hidden) renderStudy(bar, lastEvaluated);
    });

    csvBtn.addEventListener('click', () => exportPlaylist('csv'));
    mdBtn.addEventListener('click', () => exportPlaylist('md'));

    cleanBtn.addEventListener('click', () => {
      if (!Lib.isWatchLaterList(currentListId())) return;
      cleanup.hidden = !cleanup.hidden;
      cleanBtn.setAttribute('aria-expanded', cleanup.hidden ? 'false' : 'true');
      if (!cleanup.hidden) renderCleanup(bar, lastEvaluated);
    });

    bar.querySelector('#pl-cleanup-selected').addEventListener('click', () => removeSelected(bar));
    bar.querySelector('#pl-cleanup-stop').addEventListener('click', () => {
      cleanupStop = true;
    });
    bar.querySelector('#pl-cleanup-ack').addEventListener('change', e => {
      bar.querySelector('#pl-cleanup-selected').disabled = !e.target.checked;
    });
    study.querySelector('#pl-study-days').addEventListener('input', () => renderStudy(bar, lastEvaluated));
    study.querySelector('#pl-study-minutes').addEventListener('input', () => renderStudy(bar, lastEvaluated));
    study.querySelector('#pl-study-days').addEventListener('change', () => commitStudyDefaults(bar));
    study.querySelector('#pl-study-minutes').addEventListener('change', () => commitStudyDefaults(bar));
    study.querySelector('#pl-study-download').addEventListener('click', () => exportPlaylist('study'));

    resetBtn.addEventListener('click', runReset);

    hintDismiss.addEventListener('click', () => {
      state.dismissedFirstRunHint = true;
      hint.hidden = true;
      saveSettings();
    });

    bar.addEventListener('keydown', e => {
      if (e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey) {
        const key = e.key.toLowerCase();
        if (key === 'f') {
          e.preventDefault();
          searchInput.focus();
          searchInput.select();
        } else if (key === 'r') {
          e.preventDefault();
          runReset();
        }
      }
    });

    // Mount before video container
    target.parentNode.insertBefore(bar, target);
    return bar;
  }

  function createChip(text, value, isActive) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `playlist-lens-chip ${isActive ? 'is-active' : ''}`;
    btn.setAttribute('data-sort', value);
    btn.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    btn.textContent = text;
    return btn;
  }

  function setChipActive(chip, active) {
    chip.classList.toggle('is-active', active);
    chip.setAttribute('aria-pressed', active ? 'true' : 'false');
  }

  function renderNotice(bar, message) {
    let notice = bar.querySelector('.playlist-lens-notice');
    if (!notice) {
      notice = document.createElement('div');
      notice.className = 'playlist-lens-notice';
      bar.appendChild(notice);
    }
    notice.textContent = message;
  }

  function clearNotice(bar) {
    const notice = bar.querySelector('.playlist-lens-notice');
    if (notice) notice.remove();
  }

  function renderFirstRunHint(bar) {
    const hint = bar.querySelector('#pl-first-run-hint');
    if (!hint) return;
    hint.hidden = state.dismissedFirstRunHint === true;
  }

  function renderBarUI(bar, stats) {
    const runtimeEl = bar.querySelector('#pl-runtime-header');
    const compEl = bar.querySelector('#pl-completeness');
    const budgetEl = bar.querySelector('#pl-budget-summary');
    const filterEl = bar.querySelector('#pl-filter-summary');
    const loadAllBtn = bar.querySelector('#pl-load-all');

    if (runtimeEl) {
      let text = `${stats.totalVideos} video${stats.totalVideos === 1 ? '' : 's'}, ${Lib.formatRuntime(stats.totalSec)} total, ${Lib.formatRuntime(stats.unwatchedSec)} unwatched`;
      if (stats.speed !== 1) {
        text += ` (${Lib.formatRuntime(stats.unwatchedWatchSec)} at ${Lib.formatSpeed(stats.speed)})`;
      }
      if (stats.noLengthCount > 0) {
        text += ` • ${stats.noLengthCount} without a length`;
      }
      runtimeEl.textContent = text;
    }

    const headerTotal = getHeaderTotalCount();
    const isPartial = headerTotal !== null && stats.totalVideos < headerTotal;

    if (compEl) {
      if (headerTotal !== null) {
        let msg = `Loaded ${stats.totalVideos} of ${headerTotal}`;
        if (isPartial && (state.budgetMinutes !== '' || state.sortChoice !== 'default' || stats.queryActive || stats.channelActive || stats.bandActive)) {
          msg += ` • based on ${stats.totalVideos} of ${headerTotal}`;
        }
        compEl.textContent = msg;
      } else {
        compEl.textContent = `Loaded ${stats.totalVideos} video${stats.totalVideos === 1 ? '' : 's'}`;
      }
    }

    if (loadAllBtn) {
      loadAllBtn.style.display = isPartial ? 'inline-flex' : 'none';
      if (isLoadingAll) {
        loadAllBtn.textContent = 'Loading...';
        loadAllBtn.disabled = true;
      } else {
        loadAllBtn.textContent = 'Load all';
        loadAllBtn.disabled = false;
      }
    }

    if (filterEl) {
      const parts = [];
      if (stats.queryActive) parts.push(`${stats.matchCount} of ${stats.totalVideos} match "${titleQuery.trim()}"`);
      if (stats.channelActive) parts.push(`channel "${channelQuery.trim()}"`);
      if (stats.bandActive) {
        const labels = { under10: 'under 10 min', mid: '10–30 min', over30: 'over 30 min' };
        parts.push(labels[stats.durationBand] || 'length filter');
      }
      if (parts.length) {
        filterEl.textContent = parts.join(' · ');
        filterEl.style.display = 'block';
      } else {
        filterEl.textContent = '';
        filterEl.style.display = 'none';
      }
    }

    const progressEl = bar.querySelector('#pl-progress');
    if (progressEl) {
      progressEl.textContent = stats.totalVideos
        ? `${stats.watchedCount} of ${stats.totalVideos} watched (${stats.progressPct}%)`
        : '';
    }

    const board = bar.querySelector('#pl-speed-board');
    if (board) {
      board.hidden = state.showSpeedBoard === false;
      const active = Lib.normalizeSpeed(state.speed);
      for (const pill of board.querySelectorAll('button[data-speed]')) {
        const speed = Number(pill.dataset.speed);
        const entry = (stats.speedBoard || []).find(row => row.speed === speed);
        pill.textContent = `${Lib.formatSpeed(speed)} ${entry ? Lib.formatRuntime(entry.watchSec) : ''}`.trim();
        const on = active === speed;
        pill.classList.toggle('is-active', on);
        pill.setAttribute('aria-pressed', on ? 'true' : 'false');
      }
    }

    const clean = bar.querySelector('#pl-clean-open');
    if (clean) clean.hidden = !Lib.isWatchLaterList(currentListId());

    if (budgetEl) {
      if (stats.budgetResult !== null) {
        const count = stats.budgetResult.count;
        const totalFit = Lib.formatRuntime(stats.fittedWatchSec);
        const speedNote = stats.speed !== 1 ? ` at ${Lib.formatSpeed(stats.speed)}` : '';
        budgetEl.textContent = `${count} video${count === 1 ? '' : 's'} fit in ${state.budgetMinutes} min${speedNote} (${totalFit})`;
        budgetEl.style.display = 'block';
      } else {
        budgetEl.style.display = 'none';
        budgetEl.textContent = '';
      }
    }

    renderSupportCards(bar);
    renderEmpty(bar, stats);
  }

  function renderEmpty(bar, stats) {
    const el = bar.querySelector('#pl-empty');
    if (!el) return;
    let message = '';
    if (stats.budgetResult && stats.fittedCount === 0) {
      message = 'Nothing fits in that time. Add minutes, or clear the title filter.';
    } else if (stats.queryActive && stats.matchCount === 0) {
      message = 'No titles match that filter.';
    } else if ((stats.channelActive || stats.bandActive) && !lastEvaluated.some(v => v.visible)) {
      message = 'Nothing matches that channel or length filter.';
    } else if (
      state.hideWatched &&
      !stats.queryActive &&
      !stats.channelActive &&
      !stats.bandActive &&
      !stats.budgetResult &&
      stats.unwatchedCount === 0 &&
      stats.totalVideos > 0
    ) {
      message = 'Every loaded video is watched. Turn off Hide watched to see them.';
    }
    el.hidden = message === '';
    el.textContent = message;
  }

  function renderSupportCards(bar) {
    const container = bar.querySelector('#pl-card-container');
    if (!container) return;

    const cardType = Lib.nextCard(state);
    if (!cardType) {
      clearElement(container);
      return;
    }

    // Don't re-render if already showing this card
    if (container.querySelector(`[data-card-type="${cardType}"]`)) return;
    clearElement(container);

    const card = document.createElement('div');
    card.className = 'playlist-lens-card';
    card.setAttribute('data-card-type', cardType);

    const content = document.createElement('div');
    content.className = 'playlist-lens-card-content';

    const actions = document.createElement('div');
    actions.className = 'playlist-lens-card-actions';

    if (cardType === 'kofi') {
      const msg = document.createElement('span');
      msg.textContent = `${BRAND} is free and keeps your playlists on this device.`;
      content.appendChild(msg);

      const kofiBtn = document.createElement('a');
      kofiBtn.className = 'playlist-lens-btn playlist-lens-btn-kofi';
      kofiBtn.href = Lib.KOFI_URL;
      kofiBtn.target = '_blank';
      kofiBtn.rel = 'noopener noreferrer';
      kofiBtn.textContent = 'Support on Ko-fi';
      actions.appendChild(kofiBtn);
    } else if (cardType === 'rating') {
      const msg = document.createElement('span');
      msg.textContent = `Enjoying ${BRAND}? A rating on the Web Store helps others find it.`;
      content.appendChild(msg);

      const rateBtn = document.createElement('a');
      rateBtn.className = 'playlist-lens-btn';
      rateBtn.href = Lib.STORE_URL;
      rateBtn.target = '_blank';
      rateBtn.rel = 'noopener noreferrer';
      rateBtn.textContent = 'Leave a rating';
      actions.appendChild(rateBtn);
    }

    const dismissBtn = document.createElement('button');
    dismissBtn.type = 'button';
    dismissBtn.className = 'playlist-lens-btn-dismiss';
    dismissBtn.textContent = 'Dismiss';
    dismissBtn.addEventListener('click', () => {
      if (!state.seenCards) state.seenCards = [];
      state.seenCards.push(cardType);
      saveSettings();
      card.remove();
    });

    const neverBtn = document.createElement('button');
    neverBtn.type = 'button';
    neverBtn.className = 'playlist-lens-btn-dismiss';
    neverBtn.textContent = "Don't show again";
    neverBtn.addEventListener('click', () => {
      state.dismissedForever = true;
      saveSettings();
      card.remove();
    });

    actions.appendChild(dismissBtn);
    actions.appendChild(neverBtn);

    card.appendChild(content);
    card.appendChild(actions);
    container.appendChild(card);
  }

  // "Load all": scrolls the list until YouTube stops loading or 2,000 videos, then returns to top
  async function runLoadAll() {
    if (isLoadingAll) return;
    isLoadingAll = true;

    const loadAllBtn = document.getElementById('pl-load-all');
    if (loadAllBtn) {
      loadAllBtn.textContent = 'Loading...';
      loadAllBtn.disabled = true;
    }

    let lastCount = 0;
    let stagnationRounds = 0;
    const MAX_VIDEOS = 2000;

    const headerTotal = getHeaderTotalCount() || MAX_VIDEOS;
    const targetCount = Math.min(headerTotal, MAX_VIDEOS);

    while (isLoadingAll) {
      const currentCount = document.querySelectorAll(Selectors.ROW).length;
      if (currentCount >= targetCount) {
        break;
      }

      if (currentCount === lastCount) {
        stagnationRounds++;
        if (stagnationRounds >= 6) {
          // No more videos loading after 3 seconds
          break;
        }
      } else {
        stagnationRounds = 0;
        lastCount = currentCount;
      }

      window.scrollTo(0, document.documentElement.scrollHeight);
      await new Promise(r => setTimeout(r, 500));
    }

    isLoadingAll = false;
    window.scrollTo(0, 0);
    updateView();
  }

  function buildStudyPanel() {
    const panel = document.createElement('div');
    panel.id = 'pl-study';
    panel.className = 'playlist-lens-panel';
    panel.hidden = true;
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', 'Study plan');

    const lead = document.createElement('p');
    lead.className = 'playlist-lens-panel-lead';
    lead.textContent = 'Splits what’s left in playlist order across the days you choose. Watched videos are skipped, and a lecture longer than one day stays in one piece.';
    panel.appendChild(lead);

    const controls = document.createElement('div');
    controls.className = 'playlist-lens-tools';
    controls.appendChild(labeledNumber('pl-study-days', 'Days', state.studyDays, 1, 60));
    controls.appendChild(labeledNumber('pl-study-minutes', 'Min / day', state.studyMinutes, 1, 600));
    const download = document.createElement('button');
    download.type = 'button';
    download.className = 'playlist-lens-btn';
    download.id = 'pl-study-download';
    download.textContent = 'Download plan';
    controls.appendChild(download);
    panel.appendChild(controls);

    const output = document.createElement('div');
    output.id = 'pl-study-output';
    panel.appendChild(output);
    return panel;
  }

  function labeledNumber(id, label, value, min, max) {
    const wrap = document.createElement('label');
    wrap.className = 'playlist-lens-budget-box';
    wrap.setAttribute('for', id);
    const name = document.createElement('span');
    name.textContent = label;
    const input = document.createElement('input');
    input.type = 'number';
    input.id = id;
    input.className = 'playlist-lens-input';
    input.min = String(min);
    input.max = String(max);
    input.value = String(value);
    wrap.appendChild(name);
    wrap.appendChild(input);
    return wrap;
  }

  function buildCleanupPanel() {
    const panel = document.createElement('div');
    panel.id = 'pl-cleanup';
    panel.className = 'playlist-lens-panel';
    panel.hidden = true;
    panel.setAttribute('role', 'region');
    panel.setAttribute('aria-label', 'Clean watched videos from Watch Later');

    const lead = document.createElement('p');
    lead.className = 'playlist-lens-panel-lead';
    lead.textContent = 'Watch Later only. Nothing leaves the list until you press Remove. Each click uses YouTube’s own “Remove from Watch Later” menu item, and anything else is left alone. Stop a batch whenever you want.';
    panel.appendChild(lead);

    const list = document.createElement('div');
    list.id = 'pl-cleanup-list';
    panel.appendChild(list);

    const ackLabel = document.createElement('label');
    ackLabel.className = 'playlist-lens-ack';
    const ack = document.createElement('input');
    ack.type = 'checkbox';
    ack.id = 'pl-cleanup-ack';
    const ackText = document.createElement('span');
    ackText.textContent = 'Remove the checked videos from Watch Later. YouTube can undo one removal from its own toast.';
    ackLabel.appendChild(ack);
    ackLabel.appendChild(ackText);
    panel.appendChild(ackLabel);

    const actions = document.createElement('div');
    actions.className = 'playlist-lens-tools';
    const selected = document.createElement('button');
    selected.type = 'button';
    selected.className = 'playlist-lens-btn';
    selected.id = 'pl-cleanup-selected';
    selected.textContent = 'Remove selected';
    selected.disabled = true;
    const stop = document.createElement('button');
    stop.type = 'button';
    stop.className = 'playlist-lens-btn playlist-lens-btn-reset';
    stop.id = 'pl-cleanup-stop';
    stop.textContent = 'Stop';
    stop.hidden = true;
    actions.appendChild(selected);
    actions.appendChild(stop);
    panel.appendChild(actions);

    const status = document.createElement('div');
    status.id = 'pl-cleanup-status';
    status.className = 'playlist-lens-panel-lead';
    status.setAttribute('role', 'status');
    panel.appendChild(status);
    return panel;
  }

  function studyPool(videos) {
    return (videos || [])
      .filter(v => v.matchesQuery && v.matchesChannel && v.matchesBand)
      .slice()
      .sort((a, b) => a.originalIndex - b.originalIndex);
  }

  function renderStudy(bar, videos) {
    const output = bar.querySelector('#pl-study-output');
    if (!output) return;
    const days = bar.querySelector('#pl-study-days');
    const minutes = bar.querySelector('#pl-study-minutes');
    const plan = Lib.planStudy(studyPool(videos), {
      days: days ? days.value : state.studyDays,
      minutesPerDay: minutes ? minutes.value : state.studyMinutes,
      speed: state.speed,
    });
    clearElement(output);
    if (!plan.days.length) {
      const empty = document.createElement('p');
      empty.className = 'playlist-lens-panel-lead';
      empty.textContent = 'Nothing left to schedule in the loaded videos.';
      output.appendChild(empty);
      return;
    }
    for (const day of plan.days) {
      const block = document.createElement('section');
      block.className = 'playlist-lens-day';
      const heading = document.createElement('h3');
      heading.textContent = `Day ${day.day} · ${Lib.formatRuntime(day.watchSec)}${day.overrun ? ' · longer than one day' : ''}`;
      block.appendChild(heading);
      const items = document.createElement('ul');
      for (const video of day.videos) {
        const li = document.createElement('li');
        li.textContent = `${video.title} (${Lib.formatRuntime(video.durationSec)})`;
        items.appendChild(li);
      }
      block.appendChild(items);
      output.appendChild(block);
    }
    if (plan.overflow.length) {
      const extra = document.createElement('p');
      extra.className = 'playlist-lens-panel-lead';
      extra.textContent = `${plan.overflow.length} more video${plan.overflow.length === 1 ? '' : 's'} need another day.`;
      output.appendChild(extra);
    }
  }

  function commitStudyDefaults(bar) {
    const days = bar.querySelector('#pl-study-days');
    const minutes = bar.querySelector('#pl-study-minutes');
    const next = Lib.sanitizeSettings({
      ...state,
      studyDays: days ? days.value : state.studyDays,
      studyMinutes: minutes ? minutes.value : state.studyMinutes,
    });
    state.studyDays = next.studyDays;
    state.studyMinutes = next.studyMinutes;
    if (days) days.value = String(state.studyDays);
    if (minutes) minutes.value = String(state.studyMinutes);
    saveSettings();
    renderStudy(bar, lastEvaluated);
  }

  function renderCleanup(bar, videos) {
    const list = bar.querySelector('#pl-cleanup-list');
    if (!list || cleanupRunning) return;
    const checked = new Set(
      [...list.querySelectorAll('.pl-cleanup-check:checked')].map(el => el.dataset.id),
    );
    const hadChecks = list.querySelector('.pl-cleanup-check');
    clearElement(list);
    const watched = (videos || []).filter(v => v.isWatched);
    if (!Lib.isWatchLaterList(currentListId())) {
      const note = document.createElement('p');
      note.className = 'playlist-lens-panel-lead';
      note.textContent = 'Open Watch Later to remove videos you have already finished.';
      list.appendChild(note);
      return;
    }
    if (!watched.length) {
      const note = document.createElement('p');
      note.className = 'playlist-lens-panel-lead';
      note.textContent = 'No watched videos in the rows loaded on this page.';
      list.appendChild(note);
      return;
    }
    for (const video of watched) {
      const row = document.createElement('div');
      row.className = 'playlist-lens-cleanup-row';
      const label = document.createElement('label');
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.className = 'pl-cleanup-check';
      box.dataset.id = video.id;
      box.checked = hadChecks ? checked.has(video.id) : true;
      const name = document.createElement('span');
      name.textContent = video.title || video.id;
      label.appendChild(box);
      label.appendChild(name);
      const one = document.createElement('button');
      one.type = 'button';
      one.className = 'playlist-lens-btn pl-cleanup-one';
      one.textContent = 'Remove';
      one.dataset.id = video.id;
      one.title = 'Remove this one video from Watch Later';
      one.addEventListener('click', () => removeIds(bar, [video.id]));
      row.appendChild(label);
      row.appendChild(one);
      list.appendChild(row);
    }
  }

  function renderHealth(bar, health) {
    const el = bar.querySelector('#pl-health');
    if (!el) return;
    const show = !!(health && !health.ok && health.message);
    el.hidden = !show;
    el.textContent = show ? health.message : '';
  }

  function rememberProgress(stats) {
    if (state.rememberProgress === false) return;
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
    const snap = Lib.progressSnapshot(stats, { listId: currentListId(), title: getPlaylistTitle() });
    if (!snap) return;
    const key = `${snap.listId}|${snap.total}|${snap.watched}|${snap.unwatchedSec}|${snap.pct}|${snap.title}`;
    if (key === lastProgressKey) return;
    lastProgressKey = key;
    chrome.storage.local.get([PROGRESS_KEY], result => {
      const merged = Lib.mergeProgress(result && result[PROGRESS_KEY], snap);
      chrome.storage.local.set({ [PROGRESS_KEY]: merged });
    });
  }

  function fileBase() {
    const id = (currentListId() || 'playlist').replace(/[^\w-]+/g, '').slice(0, 40);
    return `fit-the-queue-${id || 'playlist'}`;
  }

  function downloadText(filename, text, mime) {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.rel = 'noopener';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function exportPlaylist(kind) {
    const title = getPlaylistTitle();
    if (kind === 'csv') {
      downloadText(`${fileBase()}.csv`, Lib.videosToCsv(lastEvaluated), 'text/csv;charset=utf-8');
      return;
    }
    if (kind === 'md') {
      const summary = (document.getElementById('pl-runtime-header') || {}).textContent || '';
      downloadText(
        `${fileBase()}.md`,
        Lib.videosToMarkdown(lastEvaluated, { title, summary, visibleOnly: true }),
        'text/markdown;charset=utf-8',
      );
      return;
    }
    const bar = document.getElementById('playlist-lens-bar');
    if (!bar) return;
    const plan = Lib.planStudy(studyPool(lastEvaluated), {
      days: (bar.querySelector('#pl-study-days') || {}).value,
      minutesPerDay: (bar.querySelector('#pl-study-minutes') || {}).value,
      speed: state.speed,
    });
    downloadText(`${fileBase()}-study.md`, Lib.studyToMarkdown(plan, { title }), 'text/markdown;charset=utf-8');
  }

  function findRemoveItem() {
    const nodes = document.querySelectorAll(Selectors.MENU_ITEM);
    for (const node of nodes) {
      if (node.closest('#playlist-lens-bar')) continue;
      const text = node.innerText || node.textContent || '';
      if (!Lib.isWatchLaterRemoveLabel(text)) continue;
      const rect = node.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) continue;
      return node;
    }
    return null;
  }

  function waitForRemoveItem() {
    const start = Date.now();
    return new Promise(resolve => {
      const tick = () => {
        const found = findRemoveItem();
        if (found || Date.now() - start > 900) resolve(found || null);
        else setTimeout(tick, 40);
      };
      tick();
    });
  }

  // One user click removes one Watch Later video, and only by activating YouTube's
  // own menu item. Any other label is ignored.
  async function removeOneFromWatchLater(row) {
    if (!Lib.isWatchLaterList(currentListId())) {
      return { ok: false, reason: 'This only runs on Watch Later, so nothing was removed.' };
    }
    const menuBtn = row && row.querySelector(Selectors.MENU_BUTTON);
    if (!menuBtn) {
      return { ok: false, reason: 'YouTube’s menu button was not on this row, so nothing was removed.' };
    }
    menuBtn.click();
    const item = await waitForRemoveItem();
    if (!item) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return { ok: false, reason: 'YouTube’s Remove from Watch Later button was not found, so nothing was removed.' };
    }
    item.click();
    return { ok: true };
  }

  function removeSelected(bar) {
    const ack = bar.querySelector('#pl-cleanup-ack');
    if (!ack || !ack.checked) return;
    const ids = [...bar.querySelectorAll('.pl-cleanup-check:checked')].map(el => el.dataset.id);
    removeIds(bar, ids);
  }

  async function removeIds(bar, ids) {
    if (cleanupRunning || !ids.length) return;
    if (!Lib.isWatchLaterList(currentListId())) return;
    cleanupRunning = true;
    cleanupStop = false;
    const stopBtn = bar.querySelector('#pl-cleanup-stop');
    const status = bar.querySelector('#pl-cleanup-status');
    const batch = ids.length > 1;
    if (stopBtn) stopBtn.hidden = !batch;
    let removed = 0;
    let halted = '';
    const cap = Math.min(ids.length, 100);
    for (let i = 0; i < cap; i++) {
      if (cleanupStop || !Lib.isWatchLaterList(currentListId())) break;
      const video = lastEvaluated.find(v => v.id === ids[i] && v.isWatched && v.el && v.el.isConnected);
      if (!video) continue;
      if (status) status.textContent = `Removing ${i + 1} of ${cap}. Press Stop to halt.`;
      const result = await removeOneFromWatchLater(video.el);
      if (!result.ok) {
        halted = result.reason;
        break;
      }
      removed += 1;
      if (i < cap - 1) await new Promise(r => setTimeout(r, 400));
    }
    cleanupRunning = false;
    if (stopBtn) stopBtn.hidden = true;
    if (status) {
      if (halted) status.textContent = halted;
      else if (cleanupStop) status.textContent = `Stopped after ${removed} removal${removed === 1 ? '' : 's'}.`;
      else status.textContent = `Removed ${removed} watched video${removed === 1 ? '' : 's'} from Watch Later.`;
    }
    updateView();
  }

  // Setup MutationObserver to watch for new rows arriving as user scrolls
  function setupObserver() {
    if (observer) observer.disconnect();

    const container = document.querySelector(Selectors.CONTAINER);
    if (!container) return;

    observer = new MutationObserver(mutations => {
      if (isApplying) return;
      const hasAddedNodes = mutations.some(m => m.addedNodes && m.addedNodes.length > 0);
      if (hasAddedNodes) {
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          updateView();
        }, 150);
      }
    });

    observer.observe(container, { childList: true, subtree: false });
  }

  function init() {
    if (!isPlaylistPage()) {
      teardown();
      return;
    }

    // Filters belong to the playlist they were typed on, and are not stored.
    if (titleQueryListId !== null && titleQueryListId !== currentListId()) {
      titleQuery = '';
      channelQuery = '';
      durationBand = 'any';
      const searchInput = document.getElementById('pl-title-filter');
      if (searchInput) searchInput.value = '';
      const channelInput = document.getElementById('pl-channel-filter');
      if (channelInput) channelInput.value = '';
      const lengthSelect = document.getElementById('pl-length-band');
      if (lengthSelect) lengthSelect.value = 'any';
    }
    titleQueryListId = currentListId();

    loadSettings(() => {
      // Container may take a moment to mount on SPA navigate
      let attempts = 0;
      const interval = setInterval(() => {
        attempts++;
        if (document.querySelector(Selectors.BAR_TARGET)) {
          clearInterval(interval);
          setupObserver();
          updateView();
        } else if (attempts > 30) {
          clearInterval(interval);
        }
      }, 200);
    });
  }

  // YouTube SPA event listeners
  window.addEventListener('yt-navigate-finish', () => {
    init();
  });

  // Fallback popstate for SPA URL changes
  window.addEventListener('popstate', () => {
    setTimeout(init, 100);
  });

  // Run on load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
