# Changelog

## 2.0.0 (2026-11-20)

Fit the Queue is the new name for Playlist Lens. The extension id, Firefox id, and `playlist_lens_settings` storage key are unchanged, so an update keeps your budget, sort, speed, and dismissed cards. New preferences start at their defaults (`fillMode: most`, speed comparison on, progress memory on, study plan 5 days × 45 minutes).

### Added
- Time remaining at 1x, 1.25x, 1.5x, and 2x, shown together. Choosing a speed still drives the time budget.
- Watched progress for each playlist (title, counts, percent, time left), stored only in `chrome.storage.local` and listed in the toolbar popup. A button on the options page forgets it.
- Sort by newest, oldest, most viewed, least viewed, or channel, plus filters for channel name and length still left (under 10, 10–30, over 30 minutes).
- Fill the time: when you set a minute budget, pack the set of videos that uses the most of that time. Most videos, the previous shortest-first pack, stays the default.
- Study plan: split the remaining videos, in playlist order, across the days and minutes you choose. A video longer than one day is not cut in half. Download the plan as Markdown.
- Export the loaded rows to CSV, or the visible rows to Markdown, as a file on your device. No download permission and no upload.
- Watch Later cleanup. The panel lists watched rows. Nothing is removed until you press Remove on a row, or confirm and press Remove selected. Each removal clicks YouTube’s own “Remove from Watch Later” item and stops if that item is not there. Stop halts a batch. Other playlists do not show the control.
- A layout warning when titles or most lengths cannot be read, and fallbacks for badge text, aria-label durations, and lockup metadata.

### Changed
- Store name: **Fit the Queue: YouTube playlist time & sort**.
- Short description now says what the extension does: total and remaining time at 1x–2x, sort, filter, fill, export, and study days.

## 1.2.0 (2026-11-17)

### Security
- Extension pages use a strict Content Security Policy (`script-src 'self'`, no `eval`, no remote code).
- Settings loaded from `chrome.storage` are sanitized before use (sort choice, budget, speed, card state).
- Support card container no longer uses `innerHTML` to clear nodes.

### Bugs and robustness
- Defaults from the options page (sort, hide watched, speed) sync via `chrome.storage.sync` when signed into Chrome.
- Reset also restores playback speed to 1x.

### UI
- Design system (`design.css`): shared color, spacing, radius, and type scale. Light surfaces follow YouTube; dark follows `html[dark]` on YouTube and the OS theme in the popup and options.
- In-page bar: brand mark, segmented sort control, switch for Hide watched, pill budget/speed fields, empty states when nothing fits or no titles match.
- First-run tip on the playlist bar (dismissible, stored locally).
- Options page and popup use the same tokens, icon, and motion (respects `prefers-reduced-motion`).
- New toolbar icons and 440×280 store tile.

### Quality of life
- Keyboard shortcuts on the bar: **Alt+Shift+F** focuses the title filter, **Alt+Shift+R** resets filters.

### Accessibility
- Sort chips expose `aria-pressed`; sort group has `aria-label`.
- Hide-watched checkbox has an accessible name.
- Options controls include labels; save status uses `role="status"`.

### Repository
- README, CONTRIBUTING, SECURITY, issue/PR templates, and CI (`lint`, unit tests, build, offline e2e).

## 1.1.0 (2026-10-23)

- Filter titles: a box in the bar that keeps only videos whose title has every word you type.
  Put `-` before a word to hide titles that have it, and quotes around a phrase. The time budget
  picks only the matching videos. Dragging stays off while the filter hides rows.
- Playback speed: pick 1x to 2x next to the minutes box. "I have 30 min at 1.5x" fits 45 minutes
  of video, and the header adds the unwatched total at that speed. The choice is remembered.

## 1.0.0 (2026-10-19)

- First release: time budget, shortest or longest first, hide watched, runtime header,
  Load all with honest "Loaded N of M" counts, and Reset.