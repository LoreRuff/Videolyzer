# Store listing copy — AMO (addons.mozilla.org) + Chrome Web Store

Reusable copy for both listings. Keep every claim in sync with PRIVACY.md.

## Name

Videolyzer

## Short summary (AMO, ≤ 250 chars)

One continuous timeline for YouTube playlists and queues: a single seekable
progress bar across videos, hover previews, zero permissions, zero network
requests, zero tracking.

## Description (AMO, max 4000 chars — also fits CWS, max 16000)

> One timeline for the whole playlist.
> Cross-video seeking, hover previews straight from YouTube's own storyboards,
> a queue that stays live while you watch.

YouTube resets its progress bar at every video boundary. Videolyzer draws one
bar over the player covering the entire playlist or queue: two content
scripts, one event channel, zero permissions.

- **One continuous timeline** — every queue video becomes a segment of a
  single bar, with ticks at boundaries and a live position across the whole
  queue
- **Cross-video seeking** — click, drag or arrow-key anywhere, including
  inside videos you haven't reached yet
- **Hover previews** — real storyboard frames on the playing video, cover
  thumbnails for every other segment, title and absolute queue time always
  visible
- **A queue that stays live** — add or remove videos while watching and the
  bar grows in real time, refereed against the player's own live queue order
- **Keyboard first-class** — ←/→ for small steps, Shift for big steps; the
  bar is an accessible ARIA slider
- **Honest guards** — ads freeze the timeline, shuffle disables scrubbing,
  live streams bow out

### Privacy

Zero permissions, zero network requests, no analytics, no telemetry, no
accounts. Preview images load from YouTube's own CDN on hover, exactly like
any other YouTube UI element.

AGPL-3.0 — © LoreRuff

## CWS single purpose statement

Show one unified, seekable timeline for YouTube playlists and queues, with
hover previews of the target position.

## CWS host permission justification (content scripts on youtube.com)

Content scripts run only on youtube.com: they read the playlist and player
data the page already contains and draw the unified timeline inside the
player. Nothing is transmitted anywhere; no other permissions are requested.

## Data collection disclosure (both stores)

The extension does not collect any user data.

## Categories

- AMO: Photos, Music & Videos
- CWS: Productivity

## Tags

youtube, playlist, timeline, progress bar, queue, seek

## Screenshots (TODO, 1280×800)

1. Theater mode, multi-video playlist, unified bar with segment ticks.
2. Hover at a future video: tooltip with frame/cover preview + title + time.
3. Plain watch page with a runtime queue: bar grown to two segments.
