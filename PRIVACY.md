# Privacy

Videolyzer collects nothing.

- **No permissions**: the manifest has no `permissions` key at all — no tabs,
  no storage, no host access grants, no `activeTab`.
- **No background script**, no content-script storage, no settings sync.
- **No network requests by the extension**: playlist titles and durations
  are read from the YouTube page you are already watching
  (`ytInitialData` / DOM), kept in memory to draw the timeline, and
  discarded on navigation. On hover, the tooltip's seek previews load
  plain images from YouTube's own CDN (`i.ytimg.com`: storyboard frames
  for the playing video, cover thumbnails for the rest) exactly like any
  YouTube UI element does — nothing is ever sent anywhere.
- **No analytics, no telemetry, no third parties** — there is nothing to
  send and nowhere to send it.

If a future version ever needs more than this, this file changes first.

— © LoreRuff, AGPL-3.0
