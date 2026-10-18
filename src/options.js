// Options page logic for Playlist Lens
(function () {
  'use strict';

  const STORAGE_KEY = 'playlist_lens_settings';
  const hideWatchedInput = document.getElementById('default-hide-watched');
  const sortSelect = document.getElementById('default-sort');
  const saveStatus = document.getElementById('save-status');

  function showStatus() {
    saveStatus.style.display = 'block';
    setTimeout(() => {
      saveStatus.style.display = 'none';
    }, 1500);
  }

  function load() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get([STORAGE_KEY], res => {
        const s = res[STORAGE_KEY] || {};
        if (s.hideWatched !== undefined) {
          hideWatchedInput.checked = s.hideWatched;
        }
        if (s.sortChoice) {
          sortSelect.value = s.sortChoice;
        }
      });
    }
  }

  function save() {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      chrome.storage.local.get([STORAGE_KEY], res => {
        const current = res[STORAGE_KEY] || {};
        current.hideWatched = hideWatchedInput.checked;
        current.sortChoice = sortSelect.value;
        chrome.storage.local.set({ [STORAGE_KEY]: current }, () => {
          showStatus();
        });
      });
    }
  }

  hideWatchedInput.addEventListener('change', save);
  sortSelect.addEventListener('change', save);

  load();
})();
