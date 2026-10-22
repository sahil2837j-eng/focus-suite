/* Focus Tracker 2.0 — youtube-analyzer.js (document_idle)
   Reports real playback to the worker every 15s. Classification happens
   locally in background.js. A paused, ended or backgrounded video
   reports nothing — playback honesty, by construction. */
(function () {
  "use strict";

  var REPORT_MS = 15000;

  function isShortsPage() {
    return location.pathname.indexOf("/shorts/") === 0 || !!document.querySelector("ytd-reel-video-renderer[is-active]");
  }

  function currentVideo() {
    var v = document.querySelector("video.html5-main-video") || document.querySelector("video");
    return v || null;
  }

  function pageTitle() {
    var h1 = document.querySelector("ytd-watch-metadata h1 yt-formatted-string")
      || document.querySelector("h1.title")
      || document.querySelector("h1");
    if (h1 && h1.textContent.trim()) return h1.textContent.trim();
    return document.title.replace(/\s*-\s*YouTube\s*$/, "").trim();
  }

  function channelName() {
    var el = document.querySelector("ytd-video-owner-renderer #channel-name a")
      || document.querySelector("#owner #channel-name a")
      || document.querySelector("ytd-channel-name a");
    return el ? el.textContent.trim() : "";
  }

  function report() {
    try {
      if (document.visibilityState !== "visible") return; // a background tab never accrues
      var onWatch = location.pathname === "/watch" || isShortsPage();
      if (!onWatch) return;
      var v = currentVideo();
      var playing = !!(v && !v.paused && !v.ended && v.readyState > 2 && v.currentTime > 0);
      if (!playing) return; // paused or ended: the session ends, honestly
      chrome.runtime.sendMessage({
        type: "media-report",
        title: pageTitle(),
        channel: channelName(),
        isShorts: isShortsPage(),
        playing: true,
        seconds: REPORT_MS / 1000
      }, function () { void chrome.runtime.lastError; });
    } catch (e) { /* page churned; next tick will retry */ }
  }

  function showBlockedToast(endsAt) {
    var old = document.getElementById("ft-block-toast");
    if (old) old.remove();
    var el = document.createElement("div");
    el.id = "ft-block-toast";
    el.textContent = "🔒 Focus Tracker: entertainment limit crossed. YouTube is blocked for 24 hours — no skip. See you " +
      new Date(endsAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) + " tomorrow.";
    el.style.cssText = [
      "position:fixed", "left:50%", "bottom:28px", "transform:translateX(-50%)",
      "z-index:2147483647", "background:#141824", "color:#f6f7fa",
      "border:1px solid rgba(251,113,133,.5)", "border-radius:12px",
      "padding:12px 16px", "font:500 13px system-ui,sans-serif",
      "box-shadow:0 18px 50px rgba(0,0,0,.6)", "max-width:90vw", "text-align:center"
    ].join(";");
    document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, 3500);
  }

  try {
    chrome.runtime.onMessage.addListener(function (msg) {
      if (msg && msg.type === "yt-blocked") showBlockedToast(msg.endsAt || Date.now() + 86400000);
    });
  } catch (e) { /* older Chrome without the listener is fine */ }

  setInterval(report, REPORT_MS);
  document.addEventListener("yt-navigate-finish", function () { setTimeout(report, 1200); });
  setTimeout(report, 2000);
})();
