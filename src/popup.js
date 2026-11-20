// Popup UI logic for Fit the Queue
(function () {
  'use strict';

  const Lib = globalThis.PlaylistLensLib;
  const PROGRESS_KEY = 'playlist_lens_progress';
  const openOptions = document.getElementById('open-options');
  const versionEl = document.getElementById('popup-version');
  const list = document.getElementById('progress-list');

  function renderProgress(raw) {
    if (!list || !Lib) return;
    const entries = Lib.listRecentProgress(raw).slice(0, 5);
    while (list.firstChild) list.removeChild(list.firstChild);
    list.hidden = entries.length === 0;
    for (const entry of entries) {
      const item = document.createElement('li');
      const link = document.createElement('a');
      link.href = `https://www.youtube.com/playlist?list=${encodeURIComponent(entry.listId)}`;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = entry.title;
      const meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = `${entry.pct}% watched · ${entry.watched} of ${entry.total} · ${Lib.formatRuntime(entry.unwatchedSec)} left`;
      const bar = document.createElement('div');
      bar.className = 'bar';
      const fill = document.createElement('span');
      fill.style.width = `${entry.pct}%`;
      bar.appendChild(fill);
      item.appendChild(link);
      item.appendChild(meta);
      item.appendChild(bar);
      list.appendChild(item);
    }
  }

  if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
    chrome.storage.local.get([PROGRESS_KEY], result => {
      renderProgress(result[PROGRESS_KEY]);
    });
  }

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