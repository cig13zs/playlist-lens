// Playlist Lens content script: time budget, duration sort and unwatched totals on playlist pages.
// Runs on https://www.youtube.com/* on initial load and yt-navigate-finish.

(function () {
  'use strict';

  const Lib = globalThis.PlaylistLensLib;
  const Selectors = globalThis.PlaylistLensSelectors;

  if (!Lib || !Selectors) {
    console.warn('[Playlist Lens] Library or Selectors not loaded.');
    return;
  }

  const STORAGE_KEY = 'playlist_lens_settings';
  let observer = null;
  let debounceTimer = null;
  let isLoadingAll = false;
  let isApplying = false;

  let state = {
    budgetMinutes: '',
    hideWatched: true,
    sortChoice: 'default', // 'default' | 'shortest' | 'longest'
    useCount: 0,
    firstUseDate: null,
    seenCards: [],
    dismissedForever: false,
  };

  function isPlaylistPage() {
    try {
      const u = new URL(window.location.href);
      return u.pathname === '/playlist' && u.searchParams.has('list');
    } catch {
      return false;
    }
  }

  // Safe storage helper with chrome.storage.local
  function loadSettings(cb) {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get([STORAGE_KEY], result => {
        if (result && result[STORAGE_KEY]) {
          state = { ...state, ...result[STORAGE_KEY] };
        }
        if (!state.firstUseDate) {
          state.firstUseDate = Date.now();
          saveSettings();
        }
        if (cb) cb();
      });
    } else {
      if (cb) cb();
    }
  }

  function saveSettings() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.set({ [STORAGE_KEY]: state });
    }
  }

  function trackAction() {
    state.useCount = (state.useCount || 0) + 1;
    saveSettings();
  }

  // Teardown bar and row modifications
  function teardown() {
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

  // Extract video data from DOM row
  function extractRowData(row, idx, container) {
    const itemEl = getItemElement(row, container);
    const titleEl = row.querySelector(Selectors.TITLE);
    const title = titleEl ? titleEl.textContent.trim() : `Video ${idx + 1}`;
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
    const durationText = timeBadge ? timeBadge.textContent.trim() : null;

    const progressBar = row.querySelector(Selectors.PROGRESS_BAR);
    const watchedPct = progressBar ? progressBar.getAttribute('style') : null;

    return {
      el: row,
      itemEl,
      id,
      title,
      durationText,
      watchedPct,
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
        renderNotice(bar, "Playlist Lens: couldn't read videos on this page. YouTube layout may be updating.");
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
      });

      // Apply to container
      if (container) {
        if (state.sortChoice !== 'default' || state.budgetMinutes !== '') {
          container.classList.add('playlist-lens-container-active');
          container.classList.add('playlist-lens-reorder-disabled');
        } else {
          container.classList.remove('playlist-lens-container-active');
          container.classList.remove('playlist-lens-reorder-disabled');
        }
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
    } catch (err) {
      console.error('[Playlist Lens] Error updating view:', err);
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
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', 'Playlist Lens controls');

    // Build bar markup using safe elements
    const topRow = document.createElement('div');
    topRow.className = 'playlist-lens-row';

    // Left: runtime statistics & honesty note
    const runtimeGroup = document.createElement('div');
    runtimeGroup.className = 'playlist-lens-runtime-group';

    const runtimeHeader = document.createElement('div');
    runtimeHeader.className = 'playlist-lens-runtime-header';
    runtimeHeader.id = 'pl-runtime-header';
    runtimeGroup.appendChild(runtimeHeader);

    const completeness = document.createElement('div');
    completeness.className = 'playlist-lens-completeness';
    completeness.id = 'pl-completeness';
    runtimeGroup.appendChild(completeness);

    const budgetSummary = document.createElement('div');
    budgetSummary.className = 'playlist-lens-budget-summary';
    budgetSummary.id = 'pl-budget-summary';
    runtimeGroup.appendChild(budgetSummary);

    topRow.appendChild(runtimeGroup);

    // Right: controls
    const controls = document.createElement('div');
    controls.className = 'playlist-lens-controls';

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
    budgetSuffix.textContent = 'min';
    budgetSuffix.style.color = 'var(--pl-text-secondary)';

    budgetBox.appendChild(budgetLabel);
    budgetBox.appendChild(budgetInput);
    budgetBox.appendChild(budgetSuffix);
    controls.appendChild(budgetBox);

    // Sort chips: Default, Shortest, Longest
    const sortGroup = document.createElement('div');
    sortGroup.style.display = 'inline-flex';
    sortGroup.style.gap = '4px';

    const chipDefault = createChip('Default', 'default', state.sortChoice === 'default');
    const chipShortest = createChip('Shortest', 'shortest', state.sortChoice === 'shortest');
    const chipLongest = createChip('Longest', 'longest', state.sortChoice === 'longest');

    sortGroup.appendChild(chipDefault);
    sortGroup.appendChild(chipShortest);
    sortGroup.appendChild(chipLongest);
    controls.appendChild(sortGroup);

    // Hide watched toggle
    const toggleLabel = document.createElement('label');
    toggleLabel.className = 'playlist-lens-chip playlist-lens-toggle-chip';
    toggleLabel.style.cursor = 'pointer';

    const toggleCheckbox = document.createElement('input');
    toggleCheckbox.type = 'checkbox';
    toggleCheckbox.id = 'pl-hide-watched';
    toggleCheckbox.checked = state.hideWatched;

    const toggleText = document.createElement('span');
    toggleText.textContent = 'Hide watched';

    toggleLabel.appendChild(toggleCheckbox);
    toggleLabel.appendChild(toggleText);
    controls.appendChild(toggleLabel);

    // Load all button
    const loadAllBtn = document.createElement('button');
    loadAllBtn.type = 'button';
    loadAllBtn.className = 'playlist-lens-btn';
    loadAllBtn.id = 'pl-load-all';
    loadAllBtn.textContent = 'Load all';
    controls.appendChild(loadAllBtn);

    // Reset button
    const resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.className = 'playlist-lens-btn playlist-lens-btn-reset';
    resetBtn.id = 'pl-reset';
    resetBtn.textContent = 'Reset';
    controls.appendChild(resetBtn);

    topRow.appendChild(controls);
    bar.appendChild(topRow);

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

    const updateSortChips = choice => {
      state.sortChoice = choice;
      chipDefault.classList.toggle('is-active', choice === 'default');
      chipShortest.classList.toggle('is-active', choice === 'shortest');
      chipLongest.classList.toggle('is-active', choice === 'longest');
      saveSettings();
      trackAction();
      updateView();
    };

    chipDefault.addEventListener('click', () => updateSortChips('default'));
    chipShortest.addEventListener('click', () => updateSortChips('shortest'));
    chipLongest.addEventListener('click', () => updateSortChips('longest'));

    toggleCheckbox.addEventListener('change', e => {
      state.hideWatched = e.target.checked;
      saveSettings();
      updateView();
    });

    loadAllBtn.addEventListener('click', () => {
      runLoadAll();
    });

    resetBtn.addEventListener('click', () => {
      state.budgetMinutes = '';
      state.sortChoice = 'default';
      state.hideWatched = false;
      budgetInput.value = '';
      toggleCheckbox.checked = false;
      chipDefault.classList.add('is-active');
      chipShortest.classList.remove('is-active');
      chipLongest.classList.remove('is-active');
      saveSettings();
      restoreNativeRows();
      updateView();
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
    btn.textContent = text;
    return btn;
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

  function renderBarUI(bar, stats) {
    const runtimeEl = bar.querySelector('#pl-runtime-header');
    const compEl = bar.querySelector('#pl-completeness');
    const budgetEl = bar.querySelector('#pl-budget-summary');
    const loadAllBtn = bar.querySelector('#pl-load-all');

    if (runtimeEl) {
      let text = `${stats.totalVideos} video${stats.totalVideos === 1 ? '' : 's'}, ${Lib.formatRuntime(stats.totalSec)} total, ${Lib.formatRuntime(stats.unwatchedSec)} unwatched`;
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
        if (isPartial && (state.budgetMinutes !== '' || state.sortChoice !== 'default')) {
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

    if (budgetEl) {
      if (stats.budgetResult !== null) {
        const count = stats.budgetResult.count;
        const totalFit = Lib.formatRuntime(stats.budgetResult.totalSec);
        budgetEl.textContent = `${count} video${count === 1 ? '' : 's'} fit in ${state.budgetMinutes} min (${totalFit})`;
        budgetEl.style.display = 'block';
      } else {
        budgetEl.style.display = 'none';
        budgetEl.textContent = '';
      }
    }

    renderSupportCards(bar);
  }

  function renderSupportCards(bar) {
    const container = bar.querySelector('#pl-card-container');
    if (!container) return;

    const cardType = Lib.nextCard(state);
    if (!cardType) {
      container.innerHTML = '';
      return;
    }

    // Don't re-render if already showing this card
    if (container.querySelector(`[data-card-type="${cardType}"]`)) return;
    container.innerHTML = '';

    const card = document.createElement('div');
    card.className = 'playlist-lens-card';
    card.setAttribute('data-card-type', cardType);

    const content = document.createElement('div');
    content.className = 'playlist-lens-card-content';

    const actions = document.createElement('div');
    actions.className = 'playlist-lens-card-actions';

    if (cardType === 'kofi') {
      const msg = document.createElement('span');
      msg.textContent = 'Finding videos faster? Playlist Lens is 100% free with no tracking.';
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
      msg.textContent = 'Enjoying Playlist Lens? A rating on the Web Store helps others find it!';
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
