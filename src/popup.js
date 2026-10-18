// Popup UI logic for Playlist Lens
(function () {
  'use strict';

  const openOptions = document.getElementById('open-options');
  if (openOptions) {
    openOptions.addEventListener('click', e => {
      e.preventDefault();
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.openOptionsPage) {
        chrome.runtime.openOptionsPage();
      }
    });
  }
})();
