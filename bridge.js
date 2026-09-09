/* Videolyzer — MAIN-world bridge, declared in manifest with "world": "MAIN".
 * It is the only code allowed to touch movie_player and ytInitialData.
 * Why a manifest-declared MAIN script and not the classic inline <script>
 * injection: YouTube 2026 enforces script-src 'self' plus Trusted Types, so
 * any DOM-sink inline script is blocked twice. The browser injects this file
 * into the page world itself, which page CSP does not govern, and the same
 * declaration works on Chromium 111+ and Gecko 128+ with zero permissions.
 * Payloads are JSON strings: primitives are the only values guaranteed to
 * cross between the page and the isolated world in both engines. */

(() => {
  'use strict';

  var P = function () { return document.getElementById('movie_player'); };

  function send(obj) {
    try { window.dispatchEvent(new CustomEvent('vl-state', { detail: JSON.stringify(obj) })); } catch (e) {}
  }

  function findPanel(d) {
    try {
      var w = d && d.contents && d.contents.twoColumnWatchNextResults;
      var pl = w && w.playlist;
      if (!pl) return null;
      if (pl.playlistPanelRenderer) return pl.playlistPanelRenderer;
      if (pl.playlist && pl.playlist.playlistPanelRenderer) return pl.playlist.playlistPanelRenderer;
      // 2026 shape: the queue renderer sits at playlist.playlist with its
      // contents inline — the playlistPanelRenderer wrapper is gone.
      if (pl.playlist && pl.playlist.contents) return pl.playlist;
      return null;
    } catch (e) { return null; }
  }

  // "7:05" / "1:02:03" -> seconds. lengthSeconds vanished from queue items
  // in 2026: lengthText.simpleText is all we get, so we parse it here.
  function parseLen(txt) {
    var p = String(txt).split(':'), s = 0;
    for (var i = 0; i < p.length; i++) { var n = +p[i]; if (isNaN(n)) return null; s = s * 60 + n; }
    return s;
  }

  function queueFromData() {
    try {
      var pr = findPanel(window.ytInitialData);
      if (!pr || !pr.contents) return null;
      var out = [];
      for (var i = 0; i < pr.contents.length; i++) {
        var r = pr.contents[i] && pr.contents[i].playlistPanelVideoRenderer;
        if (!r) continue;
        var title = '';
        if (r.title) {
          if (r.title.simpleText) title = r.title.simpleText;
          else if (r.title.runs && r.title.runs[0]) title = r.title.runs[0].text;
        }
        var len = r.lengthSeconds ? +r.lengthSeconds
          : (r.lengthText && r.lengthText.simpleText ? parseLen(r.lengthText.simpleText) : null);
        out.push({ id: r.videoId, title: title, length: len });
      }
      return out;
    } catch (e) { return null; }
  }

  // Shuffle check: the live queue order diverging from the panel order means
  // the shuffle button is on. Our timeline maps positions to panel order,
  // so a shuffled queue has no honest timeline — v1 disables scrubbing.
  function isShuffled(q) {
    try {
      var p = P();
      if (!p || !q || !q.length) return false;
      var pl = p.getPlaylist && p.getPlaylist();
      if (!pl || !pl.length || pl.length !== q.length) return false;
      for (var i = 0; i < pl.length; i++) if (pl[i] !== q[i].id) return true;
      return false;
    } catch (e) { return false; }
  }

  // Storyboard spec of the video the player holds — the raw string
  // content.js parses to draw frame-accurate seek previews. A full
  // getPlayerResponse() is expensive and the spec is static per video,
  // so it is cached by video id. Live streams yield no spec: content.js
  // falls back to cover thumbnails.
  var sbCache = null;
  function storyboard(p) {
    try {
      var vid = p.getVideoData ? p.getVideoData().video_id : null;
      if (!vid) { sbCache = null; return null; }
      if (!sbCache || sbCache.vid !== vid) {
        var pr = p.getPlayerResponse ? p.getPlayerResponse() : null;
        var sbr = pr && pr.storyboards ? pr.storyboards.playerStoryboardSpecRenderer : null;
        sbCache = { vid: vid, spec: sbr && typeof sbr.spec === 'string' ? sbr.spec : null };
      }
      return sbCache;
    } catch (e) { sbCache = null; return null; }
  }

  function tick() {
    var p = P();
    if (!p || !p.getPlayerState) return;
    // Live queue signature: the ids in PLAY order, straight from the player.
    // ytInitialData is a load-time snapshot and never learns about videos
    // queued afterwards, so this is the only witness of runtime add/remove/
    // shuffle — content.js referees its queue refreshes against it. null
    // when no queue is attached to the player.
    var sig = null;
    try {
      var pl = p.getPlaylist ? p.getPlaylist() : null;
      if (pl) sig = pl.join(',');
    } catch (e) {}
    var sb = storyboard(p);
    send({
      kind: 'state', ready: true,
      state: p.getPlayerState(),
      index: p.getPlaylistIndex(),
      t: p.getCurrentTime(),
      duration: p.getDuration(),
      loaded: p.getVideoLoadedFraction ? p.getVideoLoadedFraction() : 0,
      qsig: sig,
      // Storyboard spec + the video id it belongs to: previews must key
      // on the id because getVideoData() rides the ad's id mid-roll.
      sb: sb ? sb.spec : null,
      sbVid: sb ? sb.vid : null
    });
  }

  window.addEventListener('vl-cmd', function (e) {
    var d;
    try { d = JSON.parse(e.detail); } catch (err) { return; }
    var p = P();
    if (!p) return;
    if (d.type === 'seek' && typeof d.t === 'number' && isFinite(d.t)) p.seekTo(d.t, true);
    else if (d.type === 'playAt' && typeof d.i === 'number' && d.i >= 0) p.playVideoAt(d.i);
    else if (d.type === 'play' && p.playVideo) p.playVideo();
    else if (d.type === 'queue') {
      var q = queueFromData();
      if (q) send({ kind: 'queue', queue: q, shuffled: isShuffled(q) });
    }
  });

  setInterval(tick, 250); // 4 Hz: the eye reads nothing faster, the CPU agrees
  document.documentElement.setAttribute('data-vl-live', '1'); // heartbeat for the DOM fallback
})();
