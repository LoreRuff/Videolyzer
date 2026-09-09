/* Videolyzer — one continuous timeline for YouTube playlists.
 * Isolated world: scrape, prefix-sum math, seek state machine, UI.
 * The only code allowed to touch movie_player is bridge.js, declared in
 * the manifest with "world": "MAIN" (inline injection died with YouTube's
 * 2026 strict CSP + Trusted Types). Payloads are JSON strings because
 * primitives are the only values guaranteed to cross worlds safely in
 * both directions. */

(() => {
  'use strict';

  // ---------- constants ----------
  const SEEK_MAX_TRIES = 20;      // slow retry budget: 20 × 3s = one minute of standing intent
  const SEEK_PACE_MS = 3000;      // seekTo is swallowed if fired too fast; one per 3s
  const LAND_EPS = 2.5;           // seconds: |t - target| below this = landed
  const STEP_SMALL = 5;
  const STEP_BIG = 30;

  // ---------- cross-world plumbing (isolated side) ----------
  const emit = (o) => window.dispatchEvent(new CustomEvent('vl-cmd', { detail: JSON.stringify(o) }));

  // ---------- state ----------
  let queue = null;    // [{id, title, length}] in panel order
  let starts = [];     // prefix sums: starts[i] = sum(length[0..i-1])
  let total = 0;       // sum(length)
  let shuffled = false;
  let builtSig = '';   // sigOf(queue) the bar was built from; '' = not built yet
  let lastSig = null;  // live qsig from the bridge; null = player has no queue
  let lastDomQ = null; // panel DOM scrape of the current refresh cycle
  let refreshAt = 0;   // last refresh attempt (ms): cooldown against stale sources
  let lastTick = null; // latest bridge state payload (reconcile needs index/duration)
  let sbVid = null;   // video id the storyboard spec belongs to (bridge tick)
  let sb = null;      // parsed storyboard of that video, or null
  let prevKey = '';   // last preview drawn: pointermove storms restyle nothing
  let st = { index: -1, t: 0, duration: 0, state: -1, loaded: 0 };
  let pending = null;  // cross-video seek in flight: {i, local, tries}
  let ui = null;       // built DOM refs
  let frozenAt = null; // last true position before an ad took over the player
  let playerEl = null;
  let hideObserver = null;
  let dragging = false;

  // ---------- helpers ----------
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  const fmt = (s) => {
    s = Math.max(0, Math.floor(s));
    const h = (s / 3600) | 0, m = ((s % 3600) / 60) | 0, x = s % 60;
    const mm = String(m).padStart(2, '0'), xx = String(x).padStart(2, '0');
    return h ? h + ':' + mm + ':' + xx : m + ':' + xx;
  };

  const parseLen = (txt) => {
    const p = txt.split(':').map(Number);
    if (!p.length || p.some(isNaN)) return null;
    return p.reduce((a, b) => a * 60 + b, 0);
  };

  // Queue signature: ids in order — the whole identity of a queue state.
  const sigOf = (q) => q.map((x) => x.id).join(',');

  // Largest i with starts[i] <= T. starts is sorted, so binary search:
  // 7 steps for a 100-video queue instead of scanning it.
  function findSegment(T) {
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (starts[mid] <= T) lo = mid; else hi = mid - 1;
    }
    return lo;
  }

  const adShowing = () => !!(playerEl && playerEl.classList.contains('ytp-ad-showing'));

  const interactive = () => !!(queue && total && st.index >= 0 && !adShowing() && !shuffled);

  function globalNow() {
    return starts[clamp(st.index, 0, queue.length - 1)] + st.t;
  }

  // ---------- DOM fallback (only if ytInitialData probe fails) ----------
  function scrapeDomQueue() {
    const nodes = document.querySelectorAll('ytd-playlist-panel-video-renderer');
    if (!nodes.length) return null;
    const out = [];
    for (const el of nodes) {
      const title = el.querySelector('#video-title');
      const time = el.querySelector('ytd-thumbnail-overlay-time-status-renderer #text');
      const link = el.querySelector('a');
      const m = link && link.href ? link.href.match(/[?&]v=([\w-]{6,})/) : null;
      out.push({
        id: m ? m[1] : '',
        title: title ? (title.getAttribute('title') || title.textContent.trim()) : '',
        length: time ? parseLen(time.textContent.trim()) : null
      });
    }
    return out;
  }

  // The panel renders the playing video as "now playing": its links carry
  // no v param (verified live) and its duration overlay can be absent, so
  // the scrape is blind to the very row runtime queues hinge on. The
  // player itself is the better witness for the playing video — id from
  // the page URL, duration from the tick — so fill the row's blanks at
  // the position the player reports, or prepend it when the panel omits
  // it entirely. The qsig referee at the call site rejects wrong guesses.
  function reconcileCurrent(q) {
    if (!q || !q.length || !lastTick || lastTick.index < 0) return q;
    const v = new URLSearchParams(location.search).get('v');
    if (!v) return q;
    // During ads the tick reports the ad's duration, not the video's:
    // grafting it would poison the total. Skip — the qsig trigger retries.
    const pe = document.getElementById('movie_player');
    if (pe && pe.classList.contains('ytp-ad-showing')) return q;
    const dur = lastTick.duration > 0 ? lastTick.duration : null;
    const row = q[lastTick.index];
    if (row && (row.id === v || (!row.id && !q.some((x) => x.id === v)))) {
      q[lastTick.index] = Object.assign({}, row, {
        id: v,
        length: row.length || dur,
        title: row.title || watchTitle()
      });
      return q;
    }
    // The player's position holds another video (e.g. a shuffled panel):
    // no honest graft exists there, leave the scrape to the referee.
    if (row && row.id && row.id !== v) return q;
    return [{ id: v, title: watchTitle(), length: dur }, ...q];
  }

  function watchTitle() {
    const h1 = document.querySelector('ytd-watch-metadata h1');
    return (h1 && (h1.getAttribute('title') || h1.textContent.trim())) ||
      document.title.replace(/ - YouTube$/, '');
  }

  // ---------- model ----------
  function rebuild(q, shuf) {
    shuffled = !!shuf;
    // A missing duration (live/upcoming) breaks the global map: there is no
    // honest continuous timeline without it, so v1 bows out entirely.
    if (!q.length || q.some((x) => !x.length || x.length <= 0)) {
      // Mark this content as seen even when unmappable, or the qsig referee
      // would retry the same bow-out on every state tick.
      builtSig = lastSig || sigOf(q);
      destroyUI();
      queue = null;
      total = 0;
      return;
    }
    queue = q;
    builtSig = sigOf(q);
    starts = new Array(q.length);
    let acc = 0;
    for (let i = 0; i < q.length; i++) { starts[i] = acc; acc += q[i].length; }
    total = acc;
    buildUI();
  }

  // ---------- queue refresh ----------
  // ytInitialData is a snapshot of page load: it never learns about videos
  // added to the queue afterwards. The referee is qsig — the player's own
  // live view — and a source is trusted only when it matches it (or when
  // the bridge flags shuffle, where order divergence is the point).
  function refreshQueue() {
    lastDomQ = reconcileCurrent(scrapeDomQueue());
    // The panel DOM is what the user is actually looking at; matching the
    // live play order proves the content is fresh AND shuffle is off.
    if (lastDomQ && lastDomQ.length && sigOf(lastDomQ) === lastSig) {
      rebuild(lastDomQ, false);
      return;
    }
    emit({ type: 'queue' }); // judged on arrival in handleQueuePayload
  }

  function handleQueuePayload(d) {
    const q = d.queue || [];
    if (!q.length) return;
    const qs = sigOf(q);
    if (qs === builtSig) return; // duplicate reply: the bar is already this
    // lastSig null = no live witness (no queue yet, or getPlaylist broken):
    // trust the snapshot, exactly like v1 did at page load.
    if (qs === lastSig || lastSig === null) { rebuild(q, !!d.shuffled); return; }
    if (d.shuffled) {
      // The order divergence IS the shuffle: disable the bar, and prefer the
      // DOM panel — fresher than the snapshot — for whatever geometry is left.
      rebuild((lastDomQ && lastDomQ.length) ? lastDomQ : q, true);
      builtSig = lastSig; // play order is unknowable from panel sources: stop here
    }
    // else: stale snapshot — the cooldown on the state tick retries later
  }

  // ---------- seeking ----------
  function seekGlobal(T) {
    if (!interactive()) return;
    T = clamp(T, 0, total - 0.01);
    const i = findSegment(T);
    const local = T - starts[i];
    if (i === st.index) {
      emit({ type: 'seek', t: local });
      pending = null;
    } else {
      // The race: YouTube silently drops seekTo() issued before the new media
      // loads, so we never fire the seek together with playVideoAt(). The
      // watcher below applies it once the player reports the target ready.
      // playVideoAt runs synchronously inside this user-gesture task, which
      // also keeps it alive when autoplay is blocked.
      pending = { i, local, tries: 0 };
      emit({ type: 'playAt', i });
    }
  }

  function consumePending() {
    if (!pending) return;
    // Preroll on the target video: a seekTo now would land on the ad, not
    // the video, and burn the retry budget. The ad is just "media not
    // ready" — wait it out.
    if (adShowing()) return;
    // Gecko reports duration===0 until the new media is actually loaded,
    // and a slow network can take longer than any fixed budget to switch
    // videos. So the pending has no clock: it simply waits until the player
    // is really on the target video. A click is a standing intent — it is
    // replaced by the next click or dropped on teardown, never by a timer.
    if (st.index !== pending.i || !(st.duration > 0)) return;
    if (Math.abs(st.t - pending.local) < LAND_EPS) { pending = null; return; }
    const now = performance.now();
    // Cued/unstarted: kick playVideo() first, one per second, a few times
    // — the kick is honored when the media finishes loading, and a seek on
    // a cued player positions it for when playback starts.
    if ((st.state === -1 || st.state === 5) && (pending.kicks || 0) < 4) {
      if (now - (pending.lastKick || 0) < 1000) return;
      pending.kicks = (pending.kicks || 0) + 1; pending.lastKick = now;
      emit({ type: 'play' }); return;
    }
    // seekTo is swallowed in the first instants of healthy playback; the
    // player honors it while cued or buffering. So retry slowly, with a
    // standing budget, instead of burning the tries in one second.
    if (pending.tries >= SEEK_MAX_TRIES) { pending = null; return; }
    if (now - (pending.lastSeek || 0) < SEEK_PACE_MS) return;
    pending.tries++; pending.lastSeek = now;
    emit({ type: 'seek', t: pending.local });
  }

  // ---------- seek previews ----------
  // YouTube's storyboard spec, format verified against yt-dlp's extractor:
  // "template|level|..." — template first, levels ascending in width, each
  // level 8 '#'-fields: width#height#frames#cols#rows#interval_ms#name#sigh.
  // Placeholders: $L = level index, $N = level name ("default", or "M$M"
  // where $M becomes the image index), then "&sigh=" seals the URL. JS
  // replace() gives $-patterns meaning in the replacement string, so every
  // substitution below uses a function replacer.
  function parseSb(spec) {
    const parts = spec.split('|');
    if (parts.length < 2) return null;
    let base = parts[0];
    if (base.indexOf('//') === 0) base = 'https:' + base;
    if (base.indexOf('https://') !== 0) return null;
    let best = null;
    for (let i = 1; i < parts.length; i++) {
      const f = parts[i].split('#');
      if (f.length !== 8) continue;
      const lv = { w: +f[0], h: +f[1], n: +f[2], cols: +f[3], rows: +f[4], ms: +f[5], sigh: f[7] };
      if (!lv.w || !lv.h || !lv.n || !lv.cols || !lv.rows || !lv.ms || !lv.sigh) continue;
      lv.url = base
        .replace(/\$L/g, () => String(i - 1))
        .replace(/\$N/g, () => f[6]);
      // Levels ascend in width, so the last valid one is the finest — the
      // same level YouTube's own hover preview paints from. Oversized tiles
      // are scaled down to the tooltip's box in sbFrame.
      best = lv;
    }
    return best;
  }

  // Frame tile for a local time inside the spec's video, or null. The
  // storyboard image is exactly cols*w x rows*h pixels of tiles; the finest
  // level's tiles outsize the display box, so the grid scales by k and the
  // crop coordinates scale with it.
  function sbFrame(localT, dispW) {
    let per = sb.ms;
    if (!per && lastTick && lastTick.duration > 0) per = lastTick.duration * 1000 / sb.n;
    if (!per) return null;
    const f = clamp(Math.floor(localT * 1000 / per), 0, sb.n - 1);
    const tiles = sb.cols * sb.rows;
    const img = Math.floor(f / tiles);
    const tile = f - img * tiles;
    const k = dispW / sb.w;
    return {
      url: sb.url.replace(/\$M/g, () => String(img)) + '&sigh=' + sb.sigh,
      pos: -(tile % sb.cols) * sb.w * k + 'px ' + -Math.floor(tile / sb.cols) * sb.h * k + 'px',
      size: sb.cols * sb.w * k + 'px ' + sb.rows * sb.h * k + 'px',
      w: dispW, h: Math.round(sb.h * k)
    };
  }

  // Tooltip preview: a real frame inside the playing video (the storyboard
  // is its own), the cover thumbnail everywhere else — frame data for other
  // videos would take network fetches this extension refuses to make.
  // Keyed writes: a pointermove storm restyles nothing unchanged.
  function setPreview(seg, localT, dispW) {
    const id = queue[seg] ? queue[seg].id : '';
    if (!id) {
      if (prevKey !== 'none') { prevKey = 'none'; ui.prev.style.display = 'none'; }
      return;
    }
    const live = sb && sbVid === id ? sbFrame(localT, dispW) : null;
    let key, url, pos, size, w, h;
    if (live) {
      // pos belongs in the key: adjacent frames share one storyboard image,
      // and a url-only key would swallow every tile change while hovering.
      key = 'f:' + id + ':' + live.url + ':' + live.pos;
      url = live.url; pos = live.pos; size = live.size; w = live.w; h = live.h;
    } else {
      key = 'c:' + id + ':' + dispW;
      url = 'https://i.ytimg.com/vi/' + id + '/mqdefault.jpg';
      pos = 'center'; size = 'cover';
      w = dispW; h = Math.round(dispW * 9 / 16);
    }
    if (key === prevKey) return;
    prevKey = key;
    const s = ui.prev.style;
    s.display = 'block';
    s.width = w + 'px'; s.height = h + 'px';
    s.backgroundImage = 'url("' + url + '")';
    s.backgroundPosition = pos;
    s.backgroundSize = size;
  }

  // ---------- UI ----------
  const div = (cls) => { const d = document.createElement('div'); d.className = cls; return d; };

  function buildUI() {
    destroyUI();
    playerEl = document.getElementById('movie_player');
    if (!playerEl || !total || queue.length < 1) return;

    const root = document.createElement('div');
    root.id = 'vl-bar';
    root.tabIndex = 0;
    root.setAttribute('role', 'slider');
    root.setAttribute('aria-label', 'Videolyzer playlist timeline');
    root.setAttribute('aria-valuemin', '0');
    root.setAttribute('aria-valuemax', String(Math.floor(total)));

    const track = div('vl-track');
    const buffer = div('vl-buffer');
    const fill = div('vl-fill');
    const ticks = div('vl-ticks');
    for (let i = 1; i < starts.length; i++) {
      const t = document.createElement('i');
      t.style.left = (starts[i] / total * 100) + '%';
      ticks.appendChild(t);
    }
    const ball = div('vl-ball');
    const tip = div('vl-tip');
    const prev = div('vl-prev');
    const txt = div('vl-txt');
    tip.append(prev, txt);
    const badge = div('vl-badge');

    track.append(buffer, fill, ticks, ball);
    root.append(track, tip, badge);
    playerEl.appendChild(root);
    ui = { root, track, fill, buffer, ball, tip, prev, txt, badge };
    root.classList.toggle('vl-off', shuffled);

    bindUI();
    hideObserver = new MutationObserver(mirrorAutohide);
    hideObserver.observe(playerEl, { attributes: true, attributeFilter: ['class'] });
    mirrorAutohide();
  }

  function destroyUI() {
    if (hideObserver) { hideObserver.disconnect(); hideObserver = null; }
    if (ui) { ui.root.remove(); ui = null; }
    playerEl = null;
    dragging = false;
    frozenAt = null;
    prevKey = ''; // the rebuilt tooltip must restyle its preview from scratch
  }

  function bindUI() {
    const { root, track } = ui;

    root.addEventListener('pointerenter', () => root.classList.add('vl-over'));
    root.addEventListener('pointerleave', () => { root.classList.remove('vl-over'); hideTip(); });

    track.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return; // primary button only: right-click is the page's
      if (!interactive()) return;
      e.preventDefault();
      dragging = true;
      root.classList.add('vl-drag');
      track.setPointerCapture(e.pointerId); // drag survives leaving the track
      dragTo(e);
    });
    track.addEventListener('pointermove', (e) => {
      if (dragging) dragTo(e);
      else if (interactive()) showTip(e, null);
      else hideTip();
    });
    track.addEventListener('pointerup', (e) => {
      if (!dragging) return;
      dragging = false;
      root.classList.remove('vl-drag');
      hideTip();
      ui.root.focus({ preventScroll: true }); // keyboard ←/→ now work without Tab
      seekGlobal(xToT(e));
    });
    track.addEventListener('pointercancel', () => {
      dragging = false;
      root.classList.remove('vl-drag');
      paint();
    });

    // stopPropagation: YouTube binds its own arrow shortcuts at document level.
    root.addEventListener('keydown', (e) => {
      if (!interactive()) return;
      let dir = 0;
      if (e.key === 'ArrowLeft') dir = -1;
      else if (e.key === 'ArrowRight') dir = 1;
      else return;
      e.preventDefault();
      e.stopPropagation();
      seekGlobal(globalNow() + (e.shiftKey ? STEP_BIG : STEP_SMALL) * dir);
    });
  }

  const xToT = (e) => {
    const r = ui.track.getBoundingClientRect();
    return clamp(e.clientX - r.left, 0, r.width) / r.width * total;
  };

  const dragTo = (e) => { paint(xToT(e)); showTip(e, null); };

  function showTip(e, T) {
    if (!ui || !queue) return;
    const r = ui.track.getBoundingClientRect();
    const x = clamp(e.clientX - r.left, 0, r.width);
    const t = T != null ? T : (x / r.width) * total;
    const tc = clamp(t, 0, total - 0.01);
    const seg = findSegment(tc);
    ui.txt.textContent = queue[seg].title + ' — ' + fmt(t);
    // The preview spans the tooltip's whole inner width, so the card is one
    // full-bleed image like YouTube's own hover card: 10 = .vl-tip padding 4
    // + border 1, on both sides.
    setPreview(seg, tc - starts[seg], Math.min(320, r.width) - 10);
    // Clamp inside the track: the player clips overflow, so the -50%-centered
    // tooltip would be cut by the video edge at both ends. offsetWidth is
    // read once here because text and preview — hence the width — are final.
    ui.tip.style.maxWidth = Math.min(320, r.width) + 'px';
    const w = ui.tip.offsetWidth;
    ui.tip.style.left = (r.width >= w ? clamp(x, w / 2, r.width - w / 2) : r.width / 2) + 'px';
    ui.tip.style.opacity = '1';
  }

  const hideTip = () => { if (ui) { ui.tip.style.opacity = '0'; } };

  function setBadge(txt) {
    if (!ui) return;
    ui.badge.textContent = txt || '';
    ui.badge.style.display = txt ? 'block' : 'none';
  }

  function paint(previewT) {
    if (!ui || !queue) return;
    const ad = adShowing();
    // Shuffled: the live index maps to the shuffled order, not the panel
    // order our starts[] describe — any position we draw would be a lie,
    // so the bar stays empty and only the badge speaks.
    const now = shuffled ? 0
      : previewT != null ? previewT
      : ad ? (frozenAt || 0)
      : globalNow();
    if (!ad && previewT == null) frozenAt = now; // freeze truth, never drag previews
    const f = clamp(now / total, 0, 1);

    // transform only: no layout writes, no reflow storm at 4 Hz.
    ui.fill.style.transform = 'scaleX(' + f + ')';
    const buf = shuffled ? 0
      : starts[clamp(st.index, 0, queue.length - 1)] + st.loaded * st.duration;
    ui.buffer.style.transform = 'scaleX(' + clamp(buf / total, 0, 1) + ')';

    const w = ui.track.clientWidth; // one read per paint, before the writes
    ui.ball.style.transform = 'translate(' + (f * w - 6) + 'px,-50%)';

    ui.root.setAttribute('aria-valuenow', String(Math.floor(now)));
    ui.root.setAttribute('aria-valuetext', fmt(now) + ' / ' + fmt(total));

    setBadge(ad ? 'AD' : shuffled ? 'SHUFFLE OFF' : '');
    mirrorAutohide();
  }

  function mirrorAutohide() {
    if (!ui || !playerEl) return;
    // Mirror the player's own autohide, but never while the user is on us.
    const hidden = playerEl.classList.contains('ytp-autohide') &&
                   !ui.root.classList.contains('vl-over') && !dragging;
    ui.root.classList.toggle('vl-hidden', hidden);
  }

  // ---------- bridge protocol ----------
  window.addEventListener('vl-state', (e) => {
    let d;
    try { d = JSON.parse(e.detail); } catch (err) { return; }
    if (d.kind === 'queue') {
      handleQueuePayload(d);
      return;
    }
    if (d.kind !== 'state') return;
    lastTick = d;
    // Storyboard of the playing video, parsed once per video id: the spec
    // is static per video, so the id is the gate (plus a retry while the
    // spec has not materialized yet in the player response).
    if (d.sbVid !== sbVid || (!sb && typeof d.sb === 'string')) {
      sbVid = d.sbVid || null;
      sb = sbVid && typeof d.sb === 'string' ? parseSb(d.sb) : null;
    }
    if (typeof d.qsig === 'string') lastSig = d.qsig;
    // Live queue changed under us (add/remove/shuffle toggle): rebuild from a
    // fresh source. Never mid-drag or mid-seek — pending's index math refers
    // to the old map — and with a cooldown, because sources can be stale and
    // the next tick retries anyway.
    if (typeof d.qsig === 'string' && d.qsig !== builtSig && !dragging && !pending &&
        performance.now() - refreshAt > 1500) {
      refreshAt = performance.now();
      refreshQueue();
    }
    if (!queue) return;
    st.index = d.index;
    st.t = d.t;
    st.duration = d.duration;
    st.state = d.state;
    st.loaded = d.loaded;
    if (dragging) return; // preview wins until the pointer is released
    consumePending();
    paint();
  });

  // ---------- boot ----------
  // Ask the bridge for the queue; retry while the SPA settles, then fall
  // back to scraping the playlist panel DOM directly.
  function requestQueue(n) {
    if (queue) return;
    if (n <= 0) {
      // DOM fallback: only worth building the bar if the bridge is alive —
      // a bar without seeks is dead weight, better an honest vanish.
      if (!document.documentElement.hasAttribute('data-vl-live')) return;
      const q = reconcileCurrent(scrapeDomQueue());
      if (q && q.length) rebuild(q, false); // DOM path can't judge shuffle: assume off
      return;
    }
    emit({ type: 'queue' });
    setTimeout(() => requestQueue(n - 1), 500);
  }

  function boot() {
    // playVideoAt() is a real SPA navigation: yt-navigate-finish fires while
    // our pending seek is still in flight, and a blanket wipe here used to
    // kill the very intent that caused the navigation. Keep the pending only
    // when the page we just landed on IS its target video.
    const v = new URLSearchParams(location.search).get('v');
    const keep = !!(pending && queue && queue[pending.i] && queue[pending.i].id === v);
    destroyUI();
    queue = null; starts = []; total = 0; shuffled = false;
    builtSig = ''; lastSig = null; lastDomQ = null; lastTick = null; sbVid = null; sb = null; // the new page owns its own queue
    if (!keep) pending = null;
    if (!location.pathname.startsWith('/watch')) return; // clean vanish off-watch
    requestQueue(10);
  }

  document.addEventListener('yt-navigate-finish', boot);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
