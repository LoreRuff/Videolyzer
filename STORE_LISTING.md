# Store listing copy — AMO (addons.mozilla.org) + Chrome Web Store

Reusable copy for both listings. Keep every claim in sync with PRIVACY.md.

## Name

Videolyzer

## Short summary (AMO, ≤ 250 chars)

One continuous timeline for YouTube playlists and queues: cross-video seeking,
hover previews, zero permissions, zero requests, zero tracking.

## Description

> One timeline for the whole playlist.
> Cross-video seeking, hover previews from YouTube's own storyboards, a queue
> that stays live while you watch.

YouTube resets its progress bar at every video boundary. Videolyzer draws one
bar over the player covering the entire playlist or queue — two content
scripts, one event channel, zero permissions.

- **One continuous timeline** — every queue video becomes a segment of a single
  bar, with ticks at the boundaries and a live position across the whole queue
- **Cross-video seeking** — click, drag or arrow-key anywhere, including inside
  videos you haven't reached yet; the jump is chained through the queue
- **Hover previews** — real storyboard frames on the playing video (the same
  grids YouTube's own bar hovers from), cover art for every other segment,
  title and time always visible
- **A queue that stays live** — add to the queue while watching and the bar
  grows in real time; every rebuild is refereed against the player's own live
  queue order, never a stale snapshot
- **Keyboard first-class** — ←/→ for small steps, Shift for big ones, focus
  kept on the bar after a drag

### Privacy & limits

- Zero permissions in the manifest. The extension makes zero network requests
  and collects nothing: no analytics, no telemetry, no accounts.
- Preview images load from YouTube's own image CDN on hover, exactly like any
  other YouTube UI element. Everything else happens inside the page.
- Shuffle disables scrubbing (a shuffled queue has no honest timeline) and the
  bar says so.
- Works on desktop youtube.com watch pages whenever a playlist or queue is
  attached to the player.

AGPL-3.0 — © LoreRuff

## CWS single purpose statement

Show one unified, seekable timeline for YouTube playlists and queues, with
hover previews of the target position.

## CWS host permission justification (content scripts on youtube.com)

Content scripts run only on youtube.com: they read the playlist and player data
the page already contains and draw the unified timeline inside the player.
Nothing is transmitted anywhere; no other permissions are requested.

## Data collection disclosure (both stores)

None. The extension declares and performs no data collection (Firefox shows the
built-in "no data collection" consent consistent with
`data_collection_permissions: required none` in the manifest).

## Categories

- AMO: Photos, Music & Videos
- CWS: Productivity

## Tags

youtube, playlist, timeline, progress bar, queue, seek

## Screenshots (TODO, 1280×800)

1. Theater mode, multi-video playlist, unified bar with segment ticks.
2. Hover at a future video: tooltip with frame/cover preview + title + time.
3. Plain watch page with a runtime queue: bar grown to two segments.
