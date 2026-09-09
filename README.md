# Videolyzer

> One continuous timeline for YouTube playlists: a single progress bar + scrubber
> spanning the entire queue, with cross-video seeking. Zero permissions, zero
> build step; the extension itself makes zero network requests.

## Features

- **Unified timeline** — one bar for the whole playlist, with a tick at every
  video boundary and the queue's total duration as its scale.
- **Cross-video seeking** — click, drag or arrow anywhere in the queue: the
  right video loads at the right second.
- **Buffered overlay** and a glass tooltip (video title + absolute queue time).
- **Seek previews** — the tooltip shows a frame-accurate preview of the
  playing video (storyboards straight from the player) and the cover
  thumbnail of any other video in the queue.
- **Keyboard**: `←`/`→` ±5 s, `Shift+←`/`→` ±30 s; the bar is an ARIA slider.
- **Guards**: ads freeze the timeline (`AD` badge), shuffle disables it
  (`SHUFFLE OFF` badge, v1), live/unknown durations bow out honestly.
- **Native player untouched** — the bar sits above YouTube's own controls and
  vanishes the moment anything it needs is missing.

## How it works

`content.js` runs in the extension's isolated world (scraping, prefix-sum math,
UI). The only code touching YouTube's `movie_player` is a tiny bridge
(`bridge.js`) registered as a MAIN-world content script — the only clean path on
2026 YouTube, whose CSP and Trusted Types block every injected inline script. The
two halves talk via JSON `CustomEvent`s (`vl-cmd` / `vl-state`). Queue durations
come from the `ytInitialData` queue panel (parsing `lengthText` — the only place
2026 YouTube still exposes them) with a DOM fallback — no network requests, no
API keys, no permissions. The queue stays live: the bridge ships the player's
own playlist ids with every state tick, and additions, removals or a shuffle
toggle rebuild the bar from a source that matches that live view. Queues born
at runtime on a single video are picked up too — the panel never links the
playing row, so its id and duration are grafted from the player itself
before the live view judges the rebuild.

Tooltip previews ride the same bridge ticks: the player's own storyboard
spec is parsed to crop the right frame out of YouTube's tiled preview
images. The spec only exists for the video the player holds, so every
other segment shows its cover thumbnail — no fetches, no APIs; images load
from YouTube's CDN on hover only, like any YouTube UI element.

Cross-video seeking handles the classic race — YouTube silently drops `seekTo()`
issued before the new media loads, and the switch itself is an SPA navigation —
with a standing-intent state machine: `playVideoAt(i)` fires first (inside the
user-gesture task, so it survives blocked autoplay), the pending seek survives
its own navigation, `playVideo()` kicks revive a cued target, and paced seeks
keep applying (up to 20, one every 3 s) in any player state until the target
second is reached — or the bar honestly snaps back to truth.

Full details: [SPEC.md](SPEC.md).

## Install

- **Firefox / Zen** (temporary): `about:debugging` → This Firefox →
  *Load Temporary Add-on* → pick `manifest.json` — or a release `.zip`,
  which loads the same way. Temporary add-ons vanish on browser restart.
- **Chrome / Edge / Brave / Opera / Vivaldi**: extensions page → developer
  mode → *Load unpacked* → pick the folder.
- **Safari**: via Apple's Safari Web Extension Converter (documented path,
  not tested in v1).

**Permanent without a store:** on Chromium browsers *Load unpacked* already
survives restarts — keep developer mode on, ignore Chrome's nag bubble at
every start. Firefox release builds (Zen included) enforce signed XPIs, so
until the AMO listing ships the temporary path above is the only option.
Builds that relax signing — LibreWolf (relaxed by default), Firefox
Developer Edition or Nightly with `xpinstall.signatures.required=false` in
`about:config` — can keep it for good: rename the release `.zip` to `.xpi`
and install it from `about:addons` → gear → *Install Add-on From File…*.

After installing, hard-refresh (`Ctrl+Shift+R`) any YouTube tab that was
already open: browsers do not inject content scripts into tabs that
predate the extension. Store listings (AMO, Chrome Web Store) will replace
the manual paths once reviewed.

## Compatibility

| Browser | Status |
|---|---|
| Zen (primary target), Firefox, LibreWolf | supported |
| Chrome, Edge, Brave, Opera, Vivaldi | supported |
| Safari | convertible, untested v1 |
| m.youtube.com | out of scope v1 |

Automated matrix on real browsers: Chrome 149 (CDP) **13/13**, Zen (Gecko 155,
Marionette) **9/9**, Firefox 155 (Marionette) **9/9** — cross-video jumps in both
directions, keyboard seeks, SPA re-navigation, exact `aria` landing.

## Privacy

No data collection, no permissions, no background script; the extension
itself makes no network requests:
[PRIVACY.md](PRIVACY.md).

## Development

Files run as-is — no build step. `web-ext lint` must stay at 0 errors / 0 warnings.

## Roadmap

- v1: cross-video seeking, ad/shuffle guards.
- Later: shuffle support, >100-item queue continuation, m.youtube.com.

## License

[AGPL-3.0](LICENSE) — © LoreRuff

---

Developed with strong AI assistance (opencode/GLM); humans led the ideas, the
testing and the debugging — said openly because it shaped how the project was
built. The name "Videolyzer" a few small, unrelated GitHub repos share it 
(video-analysis tools, not extensions).
