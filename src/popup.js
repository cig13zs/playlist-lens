// Popup UI logic for Playlist Lens
(function () {
  'use strict';

  const openOptions = document.getElementById('open-options');
  const versionEl = document.getElementById('popup-version');

  if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest && versionEl) {
    versionEl.textContent = `v${chrome.runtime.getManifest().version}`;
  }

  if (openOptions) {
    openOptions.addEventListener('click', e => {
      e.preventDefault();
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.openOptionsPage) {
        chrome.runtime.openOptionsPage();
      }
    });
  }
})();