# Security policy

## Supported versions

Security fixes apply to the latest release on the [Chrome Web Store](https://chromewebstore.google.com/detail/olpginhinkaacjcfncphknhnmignoimo) and the `main` branch of this repository.

## Reporting a vulnerability

**Please do not file public GitHub issues for security problems.**

Report privately via [GitHub Security Advisories](https://github.com/cig13zs/playlist-lens/security/advisories/new) or email the maintainer through their GitHub profile.

Include:

- What you found and the impact
- Steps to reproduce
- Extension version and browser

We aim to respond within one week. We credit reporters in the fix unless you prefer to stay anonymous.

## Scope

In scope: Playlist Lens extension code (`src/`), build output, and how it handles YouTube page data and `chrome.storage`.

Out of scope: YouTube itself, third-party sites linked from the options/popup (Ko-fi, Chrome Web Store), and social engineering.

## Design notes

- Manifest V3, no remote code, CSP on extension pages.
- Single permission: `storage` (local + sync for settings).
- Content script only on `https://www.youtube.com/*`.
- User settings are sanitized after read from storage.