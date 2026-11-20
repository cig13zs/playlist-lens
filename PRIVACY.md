# Privacy policy

Fit the Queue (formerly Playlist Lens), version 2.0.0. Last updated 2026-11-20.

Fit the Queue runs on `www.youtube.com` playlist pages. It has no account, no server, no analytics, and no ads.

## What it saves

On your device, using Chrome’s extension storage:

- Time budget, hide-watched setting, sort choice, playback speed, how a budget packs videos, whether the speed comparison is shown, and study-plan defaults
- Whether you dismissed support/rating cards or the first-run tip
- How often you applied a budget or sort, and the date you first used the extension
- If you leave “Remember watched progress” on: for each playlist you open, the playlist id, the playlist title, how many videos were loaded, how many were watched, the unwatched seconds, the percent watched, and the time that snapshot was saved. The newest 30 playlists are kept. This record is stored in `chrome.storage.local` only.

**Local vs sync:** Settings are stored in `chrome.storage.local`. The same settings object is also written to `chrome.storage.sync` when available, so signed-in Chrome can sync them across your browsers. Playlist progress is not written to sync. Google operates sync; Fit the Queue does not see your Google account.

Title text, channel text, and the length filter stay in memory for that visit and that playlist. They are not saved.

Uninstalling the extension removes local data. Synced copies follow Chrome’s sync deletion rules. The options page can forget saved progress without removing the other settings.

A settings object saved by Playlist Lens 1.x is read and kept. New fields use their defaults until you change them.

## What it reads

Only the open playlist page: video titles, channel names, duration badges (or an accessible duration label), view counts, relative dates, and watch-progress bars, to sort, filter, total, export, or hide rows. Cleanup reads YouTube’s Watch Later menu so it can press “Remove from Watch Later” after you click Remove. Playlist URLs are not logged or transmitted.

## What it sends

Nothing. The extension makes no network requests. Export builds a CSV or Markdown file on your device when you click the button. Ko-fi and store rating links load only when you click them. Popup links to a playlist open YouTube only when you click them.

## Contact

Questions: [GitHub issues](https://github.com/cig13zs/playlist-lens/issues) (not for security reports — see [SECURITY.md](SECURITY.md)).
