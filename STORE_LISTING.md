# Chrome Web Store listing

Do not publish from this file. It is the copy for the next store update.

## Name

Fit the Queue: YouTube playlist time & sort

43 characters. The same string fits Chrome (75) and Firefox (50), so both stores show one name.

## Short description

Total and remaining YouTube playlist time at 1x-2x. Sort, filter, fill your minutes, export, and split courses across days. Private.

132 characters.

## Why this name

Playlist Lens sounded like a layer on top of a playlist and did not say what it does. People search for playlist length, Watch Later, and “what fits in an hour,” and the old name missed all three.

Fit the Queue names the job: take the queue you already have (a course, Watch Later, a weekend list) and fit it to the time you actually have. “Queue” covers Watch Later without saying only Watch Later. The store title then names the rest in plain words: YouTube, playlist time, and sort. The short description adds the speeds, the filters, the minute budget, export, and the study plan, and it says the work stays on the device.

Rejected alternatives:

- Keeping “Playlist Lens” as the store name. It is already shipped, but it still needs a glossary.
- “Playlist Length” or “Playlist Duration.” Those match calculator sites, which only total a public URL and cannot see Watch Later, partial progress, or a speed you actually watch at.
- “Watch Later Cleaner.” Cleanup is one control on one playlist, not the product.

The toolbar label is Fit the Queue. The repo, the extension storage key, and the Firefox id stay `playlist-lens` so updates keep their data.

## Long description

Fit a YouTube playlist to the time you have.

Fit the Queue adds a bar on any playlist, including Watch Later. It reads the page you are looking at. It does not ask you to paste a link, and it does not send the playlist anywhere.

- Time left at 1x, 1.25x, 1.5x, and 2x, side by side. Partial watches count only what is left. A video you have already finished counts as zero.
- Type the minutes you have. Most videos keeps the shortest ones that fit. Fill the time uses as many of those minutes as it can, and it never cuts a video in half.
- Sort by length, date, views, or channel. Filter titles, channels, and length.
- Study plan splits what is left across the days you pick, in playlist order.
- Export CSV or Markdown on your device.
- On Watch Later, review watched videos and remove them only when you press Remove. The extension uses YouTube’s own Remove from Watch Later button, and it stops if that button is not there.

Private by design: one permission, `storage`. No account, no analytics, no extra host access. Title and channel filters are kept in memory for that playlist only. Progress snapshots stay in local storage until you forget them.

Unofficial. Not affiliated with YouTube or Google.

Formerly Playlist Lens.
