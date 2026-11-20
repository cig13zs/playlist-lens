// YouTube DOM selectors for Fit the Queue.
// Centralized here so a YouTube markup change is a one-file fix.
// Checked against classic ytd-playlist-video-renderer (2026-10-19) and
// yt-lockup-view-model metadata (2026-11-20). Each field lists fallbacks.

(function (root) {
  'use strict';

  const SELECTORS = Object.freeze({
    // Container that holds the playlist video rows
    CONTAINER: 'ytd-playlist-video-list-renderer #contents, ytd-section-list-renderer #contents, yt-section-list-renderer #contents, #contents',

    // Video item rows
    ROW: 'ytd-playlist-video-renderer, yt-lockup-view-model',

    // Direct flex child item of list container (receives flex order and hidden state)
    ROW_ITEM: 'ytd-playlist-video-renderer, #contents > div:has(yt-lockup-view-model), #contents > yt-lockup-view-model, #contents > *',

    // Video title anchor (must contain watch?v=)
    TITLE: 'a#video-title, a.ytLockupMetadataViewModelTitle, a[href*="watch?v="]',

    // Duration timestamp badge on thumbnail (handles tags, classes, and modern badge shapes)
    TIME_BADGE: 'ytd-thumbnail-overlay-time-status-renderer, .ytd-thumbnail-overlay-time-status-renderer, badge-shape, .ytBadgeShapeText, yt-thumbnail-badge-view-model, .time-badge',

    // Watched progress bar inside thumbnail overlay
    PROGRESS_BAR: 'ytd-thumbnail-overlay-resume-playback-renderer #progress, .ytd-thumbnail-overlay-resume-playback-renderer #progress, .resume-playback #progress, [id="progress"]',

    // Channel name and the byline that also carries views and upload age
    CHANNEL: '#channel-name a, #channel-name, ytd-channel-name a, ytd-channel-name, .channel-name, a[href*="/@"], a[href*="/channel/"]',
    META: '#metadata-line, #video-info, ytd-video-meta-block, .yt-content-metadata-view-model-wiz__metadata, yt-content-metadata-view-model, .channel-name',

    // Playlist title in the header
    PLAYLIST_TITLE: 'h1, yt-dynamic-sizing-formatted-string.ytd-playlist-header-renderer, #title',

    // Watch Later overflow menu. The extension only clicks a menu item whose
    // label is exactly "Remove from Watch Later".
    MENU_BUTTON: 'button[aria-label="Action menu"], button[aria-label="More actions"], button[aria-label*="Action menu"], button[aria-label*="More actions"], .pl-fixture-menu',
    MENU_ITEM: 'ytd-menu-service-item-renderer, tp-yt-paper-item, [role="menuitem"], .pl-fixture-menu-pop button',

    // Playlist header container holding metadata and stats
    HEADER: 'ytd-playlist-header-renderer, ytd-playlist-sidebar-renderer',

    // Header metadata text elements containing video count
    HEADER_STATS: '.ytContentMetadataViewModelMetadataText, yt-formatted-string, span, .header-stats',

    // Insertion target: our bar is mounted directly above the video list container
    BAR_TARGET: 'ytd-playlist-video-list-renderer, ytd-section-list-renderer, yt-section-list-renderer, #primary #contents, #contents',

    // Native drag handle element (visually disabled during custom sort to prevent accidental reorder)
    DRAG_HANDLE: '#reorder, #handle, .drag-handle, [aria-label*="drag" i], [aria-label*="reorder" i]',

    // Position / row index element
    INDEX: '#index, .index-message',
  });

  if (typeof module === 'object' && module.exports) {
    module.exports = SELECTORS;
  } else {
    root.PlaylistLensSelectors = SELECTORS;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
