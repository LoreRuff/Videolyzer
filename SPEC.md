# VIDEOLYZER — Build Spec v1.0

> YouTube continuous-timeline extension. Fuses a whole playlist into ONE progress
> bar + scrubber spanning the TOTAL queue duration: cross-video seeking, per-video
> segments, buffered overlay. Zero permissions, zero build step, zero network
> requests made by the extension (hover previews load YouTube's own CDN images).
> UI language: English.

---

## 0. Agent kickoff prompt (paste this first)

> You are building "Videolyzer", a YouTube continuous-timeline browser extension
> (Firefox/Zen first, all major browsers). Read this entire SPEC.md before writing
> code. Work milestone by milestone (M0→M5), do not skip ahead. Hard rules:
> (1) Correctness before speed: a cross-video seek must land on the exact requested
> global time — drift is a bug. (2) Zero permissions: no host_permissions, no
> background script, no storage, no network requests made by the extension —
> data only from the page (ytInitialData/DOM); hover previews may load
> YouTube's own CDN images (`i.ytimg.com`) like any page element.
> (3) `movie_player` is touched ONLY inside the MAIN-world
> bridge; content.js never calls player APIs directly. (4) Native player controls
> stay untouched — our bar sits above them and the extension vanishes cleanly if
> anything is missing. (5) Four code files only: manifest.json, bridge.js
> (MAIN world), content.js, styles.css. (6) Lint warnings are build
> failures. Start with M0 and show me a runnable result before continuing.

---

## 1. Stack

| Layer | Choice | Why |
|---|---|---|
| Platform | WebExtension MV3, content-script only | one manifest, all engines |
| Targets | Gecko (Zen/Firefox/LibreWolf) + Chromium (Chrome/Edge/Brave/Opera/Vivaldi); Safari via Apple converter (documented, untested v1) | "all major browsers" |
| Player access | `bridge.js` content script with `"world": "MAIN"` (Chrome 111+, Firefox 128+) | isolated world can't see player JS; YouTube 2026 CSP + Trusted Types block inline script injection — the browser-injected MAIN world is the only clean path (validated on Chrome 149 / Firefox 155 / Zen) |
| Protocol | CustomEvents on window: `vl-cmd` / `vl-state` | no port messaging, no storage |
| Playlist data | `ytInitialData` queue panel (`lengthText` parse — `lengthSeconds` gone in 2026) + DOM fallback | zero network requests |
| SPA tracking | `yt-navigate-finish` document event | no URL polling |
| UI | vanilla DOM + CSS transforms | no framework, no build step |
| Validation | `web-ext lint` | store gate: 0 errors |
| License | AGPL-3.0 — © LoreRuff | repo convention (hAIrness) |

---

## 2. File tree

```
videolyzer/
├─ manifest.json        # MV3: two content_scripts on *://*.youtube.com/* ONLY (bridge world:MAIN @ document_start; UI @ document_idle) — no permissions key at all
├─ bridge.js            # MAIN world (the ONLY code touching movie_player): queue scrape, 250ms state ticks, vl-cmd handler
├─ content.js           # isolated world: prefix-sum math, cross-video seek machine, UI
├─ styles.css           # unified bar: track, segments, buffer, scrubber, tooltip, badges
├─ icons/               # icon-16/32/48/96/128.png — violet tile, timeline motif
├─ LICENSE              # AGPL-3.0 — © LoreRuff
├─ README.md            # what/why, install per browser, how it works, AI-assisted declaration
├─ PRIVACY.md           # zero data collection
└─ screenshots/         # store listing assets
```

---

## 3. Event & data flow

```
load | yt-navigate-finish (isolated)
 → wait for #movie_player + playlist panel
 → scrape queue [{videoId, title, length}] (ytInitialData lengthText parse → DOM fallback)
 → starts[i] = Σ d[0..i-1]; TOTAL = Σ d
 → bridge.js (MAIN, document_start) emits vl-state {state,index,t,duration,loaded} every 250 ms
 → globalNow = starts[index] + t → repaint bar (transform: scaleX)

user scrub → global target T (isolated)
 → binary search starts[] → (i, local = T − starts[i])
 → same video  → vl-cmd {seek, local}          → bridge seekTo(local, true)
 → cross video → vl-cmd {playAt, i} + pending {i, local} → bridge playVideoAt(i)
 → the switch is a real SPA nav → yt-navigate-finish → boot keeps pending iff the
   video being loaded IS the target (keepPending), else wipes it
 → consumePending each state tick: ad → wait · not loaded → wait · cued → kick
   playVideo() ≤4 @1s · else paced seekTo(local) ≤20 @3s
 → landed |t−local|<2.5 s → cleared; budget spent → bar snaps to truth
```

---

## 4. Timeline math

| Value | Definition | Source |
|---|---|---|
| `d[i]` | duration of queue item i | panel `lengthText` parse (2026; `lengthSeconds` gone) / DOM fallback |
| `starts[i]` | `Σ d[0..i-1]` (starts[0] = 0) | computed |
| `TOTAL` | `Σ d` | computed |
| `globalNow` | `starts[index] + getCurrentTime()` | bridge state |
| `(i, local)` | target T → binary search in `starts[]`; `local = T − starts[i]` | computed |

Unknown/live duration → segment flagged non-scrubbable, excluded from TOTAL with badge note.

---

## 5. Player bridge (MAIN world)

| Event | Direction | Payload |
|---|---|---|
| `vl-cmd` | isolated → MAIN | `{type:'seek', t}` · `{type:'playAt', i}` · `{type:'play'}` · `{type:'queue'}` |
| `vl-state` | MAIN → isolated | `{state, index, t, duration, loaded, qsig, sb, sbVid}` every 250 ms; `qsig` = live queue ids in play order (`getPlaylist()`), null = no queue — the referee for runtime queue changes; `sb`/`sbVid` = storyboard spec of the playing video + its video id (cached per id; the source of seek previews), null when none |

Registered in the manifest as a content script with `"world": "MAIN"` and
`run_at: "document_start"`. (The original design — inline `<script>` `textContent`
injection — was falsified on live YouTube 2026: page CSP `script-src 'self' …`
plus Trusted Types block every inline/DOM-sink script; the browser-injected MAIN
world is the only clean path and works identically on Chromium and Gecko.) Bridge
is the ONLY code allowed to call `seekTo` / `playVideoAt` / `playVideo` /
`getPlaylist` / `getPlaylistIndex` / `getCurrentTime` / `getDuration`.

---

## 6. Cross-video seek state machine

| Condition | Action |
|---|---|
| target video == current | `seekTo(local, true)` directly |
| target ≠ current | `pending = {i, local, tries: 0, kicks: 0}` → `playAt(i)` inside the user-gesture task |
| the switch itself is a SPA nav | `yt-navigate-finish` → boot keeps `pending` iff the video being loaded IS the target (`keepPending`); unrelated navs wipe it |
| ad showing | wait — never seek an ad; media-not-ready is not a failure |
| `index ≠ i` or `duration ≤ 0` | wait — Gecko reports `getDuration() === 0` until media is really loaded; a deadline here would kill the intent mid-load |
| cued (state −1/5), kicks < 4 | `playVideo()` kick ≤1/s — a queued play is honored at load-complete, and a seek on a cued player positions media directly |
| otherwise, tries < 20 | `seekTo(local, true)` paced ≤1/3 s, in ANY player state (cued positions, buffering integrates, playing eventually honors) |
| landed: `\|t − local\| < 2.5 s` | clear pending |
| tries ≥ 20 | drop pending; bar snaps to truth |

The click is a standing intent, not a timed one: YouTube ignores `seekTo()` issued
before the new media loads, `playVideoAt()` performs a real SPA navigation, and a
slow machine can take 20+ s to load a long video — so the machine never fires a
seek together with `playAt`, waits out ads and load windows without a clock, and
keeps applying paced seeks for up to a minute. Empirically validated on Chrome 149
(CDP, 13/13), Zen and Firefox 155 (Marionette, 9/9 each).

---

## 7. Edge cases & guards

| Case | Behaviour |
|---|---|
| Ad showing (`.ytp-ad-showing`) | freeze bar updates, block seeks, resume after |
| Cross-click SPA nav mid-seek (`yt-navigate-finish`) | pending survives its own navigation (`keepPending`), wiped by unrelated ones |
| Shuffle enabled | disable bar + badge "SHUFFLE OFF" (v1) |
| Queue mutated at runtime (add / remove / shuffle toggle) | `qsig` diverges from the built bar → refresh: DOM panel scrape if it matches live order, else the `ytInitialData` snapshot, accepted only on a `qsig` match (or bridge-flagged shuffle); ≥1.5 s cooldown, never mid-drag/mid-seek |
| Queue born at runtime on a plain watch page (no playlist at load) | `ytInitialData` never materializes a panel, and the panel renders the playing row with links carrying no `v` param — `reconcileCurrent` grafts the player's own `index`/`duration` (fill the playing row's id/length/title blanks, or prepend the missing row; never during ads, when the tick reports the ad's duration; no graft when the player's position holds another video, e.g. a shuffled panel). The `qsig` referee still gates every rebuild: a wrong guess is rejected, not built |
| Seek previews | tooltip shows the storyboard frame of the playing video (spec shipped by the bridge, parsed in content.js with the yt-dlp-verified format; JS `$`-substitutions use function replacers; the finest storyboard level is chosen and its tiles scaled to the tooltip's full inner width — the preview is a full-bleed image like YouTube's own hover card; the repaint key covers url AND tile position, so every frame change paints) and the cover thumbnail of any other segment — live streams, ads and missing specs degrade to covers, never to fetches |
| autoplay blocked | `playVideoAt` chained inside user-gesture task; paused-at-target fallback |
| Live / unknown duration | segment non-scrubbable |
| Queue > 100 items | visible panel items only (v1) |
| No player / no playlist / no bridge | extension does nothing (clean vanish) |
| m.youtube.com | out of scope v1 |

---

## 8. UI (injected inside `#movie_player`)

| Element | Spec |
|---|---|
| Track | bottom ~52px (above native controls), height 5px → 8px on hover |
| Fill / buffer | watched via `scaleX`, buffered second layer, per-video boundary ticks |
| Scrubber | 12px ball, accent var `--vl-accent` (Zen violet default) |
| Tooltip | dark glass, video title + global time at hover X, clamped inside the track (the player clips overflow); preview block above the text — frame of the playing video, cover of any other |
| Interaction | Pointer Events + `setPointerCapture` (drag), click-to-seek, `←`/`→` ±5 s, Shift ±30 s |
| A11y | `role=slider`, `aria-valuenow=globalNow`, `aria-valuemax=TOTAL` |
| Autohide | MutationObserver on `.ytp-autohide` → `.vl-hidden` |
| Perf | repaint via transform only; state ≤4 Hz; no layout reads inside rAF |

---

## 9. Frontend views

One view: the unified bar — segmented track glued above YouTube's native progress
bar, hover-growing, ticks at every video boundary, buffered overlay, glass tooltip
(preview + title + absolute playlist time), 12px scrubber ball in accent violet,
`SHUFFLE OFF` / `AD` badges floating right; ARIA slider semantics; autohidden
together with the native controls. Native UI untouched.

---

## 10. Build order

1. M0 Skeleton: folder + LICENSE (AGPL-3.0) + README + PRIVACY.md + manifest.json +
   stubs; `web-ext lint` 0 errors.
2. M1 Core: bridge injection + `vl-state` stream + scrape + prefix math +
   same-video seek (runnable: bar fills in sync on a real playlist).
3. M2 UI: full scrubber — drag/click/keys, tooltip, ticks, buffer, autohide.
4. M3 Guards: pendingSeek cross-video machine, ad freeze, shuffle badge,
   autoplay-off chain.
5. M4 QA matrix: Zen + Firefox + Chromium — boundary jumps both directions, race
   retries, repeated SPA navigations, perf.
6. M5 Packaging: store zip, screenshots, GitHub release.

---

## 11. Non-negotiables

- ONE continuous timeline spanning TOTAL playlist duration, with cross-video seeking —
  the differentiator; no playlist manager, no extra features.
- Seeks land on the exact requested global time: at boundaries `globalNow` == truth;
  no drift, no unexplained jumps.
- Zero `permissions` key in manifest; zero background; zero network requests
  made by the extension; data only from `ytInitialData`/DOM (previews:
  page-style image loads from `i.ytimg.com`, on hover only).
- `movie_player` calls live ONLY in the bridge; content.js stays engine-agnostic.
- Native player never broken: extension vanishes cleanly on any missing piece.
- Four code files, no build step: files run as-is ("Load Temporary Add-on" /
  unpacked mode).
- AGPL-3.0 — © LoreRuff; README declares AI-assisted development openly.
- Store name verified free (CWS/AMO); 6 minor unrelated GitHub repos omonimi —
  acknowledged in README.
