// Options page logic for Playlist Lens
(function () {
  'use strict';

  const STORAGE_KEY = 'playlist_lens_settings';
  const Lib = globalThis.PlaylistLensLib;
  const PROGRESS_KEY = 'playlist_lens_progress';
  const hideWatchedInput = document.getElementById('default-hide-watched');
  const sortSelect = document.getElementById('default-sort');
  const speedSelect = document.getElementById('default-speed');
  const fillSelect = document.getElementById('default-fill');
  const speedBoardInput = document.getElementById('default-speed-board');
  const rememberInput = document.getElementById('default-remember-progress');
  const studyDaysInput = document.getElementById('default-study-days');
  const studyMinutesInput = document.getElementById('default-study-minutes');
  const forgetButton = document.getElementById('forget-progress');
  const syncHint = document.getElementById('sync-hint');
  const saveStatus = document.getElementById('save-status');
  const versionEl = document.getElementById('app-version');

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest && versionEl) {
    versionEl.textContent = chrome.runtime.getManifest().version;
  }

  function showStatus() {
    saveStatus.style.display = 'block';
    saveStatus.setAttribute('role', 'status');
    setTimeout(() => {
      saveStatus.style.display = 'none';
    }, 1500);
  }

  function readStorage(cb) {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
      cb({});
      return;
    }
    chrome.storage.local.get([STORAGE_KEY], localResult => {
      const localSettings = localResult[STORAGE_KEY];
      if (chrome.storage.sync) {
        chrome.storage.sync.get([STORAGE_KEY], syncResult => {
          cb({ ...syncResult[STORAGE_KEY], ...localSettings });
        });
      } else {
        cb(localSettings || {});
      }
    });
  }

  function writeStorage(payload, done) {
    if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) {
      if (done) done();
      return;
    }
    chrome.storage.local.set({ [STORAGE_KEY]: payload }, () => {
      if (chrome.storage.sync) {
        chrome.storage.sync.set({ [STORAGE_KEY]: payload }, done);
      } else if (done) {
        done();
      }
    });
  }

  function load() {
    readStorage(raw => {
      const s = Lib ? Lib.sanitizeSettings(raw) : raw;
      if (hideWatchedInput) hideWatchedInput.checked = s.hideWatched !== false;
      if (sortSelect) sortSelect.value = s.sortChoice || 'default';
      if (speedSelect) speedSelect.value = String(s.speed || 1);
      if (fillSelect) fillSelect.value = s.fillMode || 'most';
      if (speedBoardInput) speedBoardInput.checked = s.showSpeedBoard !== false;
      if (rememberInput) rememberInput.checked = s.rememberProgress !== false;
      if (studyDaysInput) studyDaysInput.value = String(s.studyDays || 5);
      if (studyMinutesInput) studyMinutesInput.value = String(s.studyMinutes || 45);
    });
    if (syncHint && typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) {
      syncHint.hidden = false;
    }
  }

  function save() {
    readStorage(current => {
      const merged = {
        ...(current || {}),
        hideWatched: hideWatchedInput.checked,
        sortChoice: sortSelect.value,
        speed: speedSelect.value,
        fillMode: fillSelect.value,
        showSpeedBoard: speedBoardInput.checked,
        rememberProgress: rememberInput.checked,
        studyDays: studyDaysInput.value,
        studyMinutes: studyMinutesInput.value,
      };
      const payload = Lib ? Lib.sanitizeSettings(merged) : merged;
      writeStorage(payload, showStatus);
    });
  }

  if (hideWatchedInput) hideWatchedInput.addEventListener('change', save);
  if (sortSelect) sortSelect.addEventListener('change', save);
  if (speedSelect) speedSelect.addEventListener('change', save);
  if (fillSelect) fillSelect.addEventListener('change', save);
  if (speedBoardInput) speedBoardInput.addEventListener('change', save);
  if (rememberInput) rememberInput.addEventListener('change', save);
  if (studyDaysInput) studyDaysInput.addEventListener('change', save);
  if (studyMinutesInput) studyMinutesInput.addEventListener('change', save);
  if (forgetButton) {
    forgetButton.addEventListener('click', () => {
      if (typeof chrome === 'undefined' || !chrome.storage || !chrome.storage.local) return;
      chrome.storage.local.remove(PROGRESS_KEY, showStatus);
    });
  }

  load();
})();