/* Focus Suite 3.1 — youtube-focus.js (document_start)
   ONE content script for everything that changes what YouTube shows:
     • layout cleanup  (home feed, sidebar/related, end screens, promos)
     • Shorts blocking (nav, shelves, cards, /shorts/ pages, click interception)
     • keyword filtering (Off / Balanced / Strict + search override + reveal pill)
     • on-device content classifier (education / memory / self-improvement / 18+)
     • blocked-channel hiding + watch-page bounce  (from Focus Tracker)
   One MutationObserver, one debounced pass. Settings are cached in
   localStorage so the first paint is already clean. Playback accounting
   stays in youtube-analyzer.js. */
(function () {
  "use strict";
  var G = typeof globalThis !== "undefined" ? globalThis : self;
  if (G.__ftSuiteFocus) return; // safe if injected twice
  G.__ftSuiteFocus = true;
  var D = G.FOCUS_DEFAULTS;
  var E = G.FocusEngine;
  var C = G.ContentClassifier;
  if (!D || !E) return;

  var CACHE_KEY = "__ytf_state_v1";
  var SETTINGS_KEYS = ["ytfSettings", "ytfAllowed", "ytfGood", "ytfBlocked"];
  var TILE = [
    "ytd-rich-item-renderer", "ytd-video-renderer", "ytd-compact-video-renderer",
    "ytd-grid-video-renderer", "ytd-playlist-panel-video-renderer", "ytd-playlist-video-renderer",
    "ytd-reel-item-renderer", "yt-lockup-view-model"
  ].join(",");
  var SCOPES = "ytd-search,ytd-browse,ytd-watch-flexy,ytd-playlist-panel-renderer,ytd-miniplayer";

  var settings = clone(D.settings);
  var lists = { allowed: D.allowed.slice(), good: D.good.slice(), blocked: D.blocked.slice() };
  var compiled = E.compile(lists);
  var handles = []; // blocked channel handles, lowercase, no "@"
  var rev = 0; // bumps whenever a setting changes, so cached tile verdicts refresh
  var revealed = false;
  var forcedShortsScreen = false;
  var scheduled = false;
  var counted = typeof WeakSet === "function" ? new WeakSet() : null;
  var pending = { hidden: 0, shorts: 0, adult: 0 };

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function root() { return document.documentElement; }
  function isSearch() { return location.pathname === "/results"; }

  /* ---------------------- first-paint cache + flags --------------------- */
  function readCache() {
    try { return JSON.parse(localStorage.getItem(CACHE_KEY) || "null"); } catch (e) { return null; }
  }
  function writeCache() {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ s: settings })); } catch (e) { /* private mode */ }
  }
  function applyFlags() {
    var h = root();
    if (!h) return;
    h.setAttribute("data-ytf-home", settings.hideHomeRecs ? "1" : "0");
    h.setAttribute("data-ytf-side", settings.hideSidebar ? "1" : "0");
    h.setAttribute("data-ytf-shorts", settings.blockShorts ? "1" : "0");
  }
  var cached = readCache();
  if (cached && cached.s) settings = Object.assign(settings, cached.s);
  applyFlags();

  /* ------------------------------ loading ------------------------------- */
  function load() {
    try {
      chrome.storage.sync.get(SETTINGS_KEYS, function (s) {
        void chrome.runtime.lastError;
        settings = Object.assign(clone(D.settings), s.ytfSettings || {});
        lists = {
          allowed: s.ytfAllowed || D.allowed.slice(),
          good: s.ytfGood || D.good.slice(),
          blocked: s.ytfBlocked || D.blocked.slice()
        };
        compiled = E.compile(lists);
        rev++;
        writeCache();
        applyFlags();
        queue();
      });
    } catch (e) { /* extension reloaded under us */ }
    try {
      chrome.storage.local.get(["blockedChannels"], function (s) {
        void chrome.runtime.lastError;
        handles = (s.blockedChannels || [])
          .map(function (c) { return String((c && c.handle) || "").replace(/^@/, "").toLowerCase(); })
          .filter(Boolean);
        rev++;
        queue();
      });
    } catch (e) { /* ignore */ }
  }

  /* ------------------------------ judging ------------------------------- */
  function channelHref(tile) {
    var a = tile.querySelector('a[href*="/@"], a[href*="/channel/"], a[href*="/user/"]');
    return a ? (a.getAttribute("href") || "") : "";
  }
  function hrefBlocked(href) {
    if (!href || !handles.length) return false;
    var h = href.toLowerCase();
    return handles.some(function (handle) {
      return h.indexOf("/@" + handle) === 0 || h.indexOf("youtube.com/@" + handle) !== -1;
    });
  }
  function countShield(tile, kind) {
    if (!counted || counted.has(tile)) return;
    counted.add(tile);
    if (kind === "shorts") pending.shorts++;
    else if (kind === "adult") pending.adult++;
    else pending.hidden++;
  }

  function absoluteUrl(href) {
    if (!href) return location.href;
    try { return new URL(href, location.origin).href; } catch (e) { return href; }
  }

  /* Pull the title, channel and canonical URL out of a feed tile. The
     classifier only needs these three fields; no video download, no API. */
  function tileMeta(tile) {
    var link = tile.querySelector('a#video-title, a#video-title-link, a[href*="/watch?v="], a[href^="/shorts/"]');
    var title = link ? (link.getAttribute("title") || link.textContent || "") : "";
    var channelEl = tile.querySelector("ytd-channel-name a, #channel-name a, #channel-name yt-formatted-string, .ytd-channel-name");
    var channel = channelEl ? (channelEl.textContent || "") : "";
    if (!title) title = (tile.textContent || "").slice(0, 240);
    return {
      url: absoluteUrl(link ? link.getAttribute("href") : ""),
      title: String(title).replace(/\s+/g, " ").trim(),
      channel: String(channel).replace(/\s+/g, " ").trim()
    };
  }

  function judge(tile, override) {
    var text = (tile.textContent || "").replace(/\s+/g, " ").slice(0, 700);
    if (text.length < 3) return; // not rendered yet — look again on the next pass
    var meta = tileMeta(tile);
    var result = C ? C.classify(meta) : null;
    if (result) tile.setAttribute("data-ytf-cat", result.category);
    else tile.removeAttribute("data-ytf-cat");
    var sig = text + "|" + (override ? 1 : 0) + "|" + rev + "|" + (result ? result.category : "none");
    if (tile.__ytfSig === sig) return;
    tile.__ytfSig = sig;

    var hard = null;
    if (hrefBlocked(channelHref(tile))) hard = "channel";
    else if (settings.blockShorts && tile.querySelector('a[href^="/shorts/"]')) hard = "shorts";
    else if (result && result.category === "adult_18plus") hard = "adult";
    tile.classList.toggle("ytf-hard-hidden", !!hard);
    if (hard) {
      tile.classList.remove("ytf-hidden");
      tile.setAttribute("data-ytf-why", hard);
      countShield(tile, hard);
      return;
    }

    var k = E.classifyText(text, compiled);
    if (k.allowed) {
      tile.classList.remove("ytf-hidden");
      tile.removeAttribute("data-ytf-why");
      return;
    }
    if (k.blocked && (!override || settings.queryPassStillBlocks)) {
      tile.classList.add("ytf-hidden");
      tile.setAttribute("data-ytf-why", "blocked");
      countShield(tile, "keyword");
      return;
    }
    if (override) {
      tile.classList.remove("ytf-hidden");
      tile.removeAttribute("data-ytf-why");
      return;
    }

    if (result) {
      var cv = C.verdict(result, settings);
      if (cv.hide) {
        tile.classList.add("ytf-hidden");
        tile.setAttribute("data-ytf-why", cv.reason);
        countShield(tile, "keyword");
        return;
      }
      if (cv.reason === "classifier-useful") {
        tile.classList.remove("ytf-hidden");
        tile.removeAttribute("data-ytf-why");
        return;
      }
    }

    var d = E.decide(text, settings, compiled, { queryOverride: false });
    tile.classList.toggle("ytf-hidden", d.hide);
    if (d.hide) { tile.setAttribute("data-ytf-why", d.reason); countShield(tile, "keyword"); }
    else tile.removeAttribute("data-ytf-why");
  }

  function pass() {
    scheduled = false;
    if (!root()) return;
    var q = isSearch() ? (new URLSearchParams(location.search).get("q") || "") : "";
    var override = q ? E.queryOverride(q, settings, compiled).pass : false;
    var scopes = document.querySelectorAll(SCOPES);
    for (var i = 0; i < scopes.length; i++) {
      var tiles = scopes[i].querySelectorAll(TILE);
      for (var j = 0; j < tiles.length; j++) {
        var tile = tiles[j];
        if (tile.parentElement && tile.parentElement.closest(TILE)) continue; // outermost tile decides
        judge(tile, override);
      }
    }
    updatePill();
    updateShortsScreen();
    bounceBlockedWatch();
    updateAdultScreen();
  }

  function queue() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(pass, 140);
  }

  /* ----------------------------- reveal pill ---------------------------- */
  function updatePill() {
    var n = isSearch() ? document.querySelectorAll(".ytf-hidden").length : 0;
    var adultN = document.querySelectorAll('.ytf-hard-hidden[data-ytf-cat="adult_18plus"]').length;
    var pill = document.getElementById("ytf-pill");
    if ((!n && !adultN) || !document.body) {
      if (pill) pill.remove();
      if (!n && !adultN) { revealed = false; root().classList.remove("ytf-reveal"); }
      return;
    }
    if (!pill) {
      pill = document.createElement("button");
      pill.id = "ytf-pill";
      pill.type = "button";
      pill.addEventListener("click", function () {
        revealed = !revealed;
        root().classList.toggle("ytf-reveal", revealed);
        updatePill();
      });
      document.body.appendChild(pill);
    }
    var adultText = adultN ? (n ? " \u00b7 " : "") + adultN + " 18+ blocked" : "";
    if (revealed && n) {
      pill.textContent = "Hide the " + n + " video" + (n === 1 ? "" : "s") + " again";
    } else if (n) {
      pill.textContent = "\uD83D\uDEAB " + n + " video" + (n === 1 ? "" : "s") + " hidden" + adultText + " \u2014 click to show";
    } else {
      pill.textContent = "\uD83D\uDEAB " + adultN + " 18+ video" + (adultN === 1 ? "" : "s") + " blocked";
    }
  }

  /* ------------------------------- Shorts ------------------------------- */
  function updateShortsScreen() {
    var onShorts = settings.blockShorts && location.pathname.indexOf("/shorts/") === 0;
    var screen = document.getElementById("ytf-shorts-screen");
    if (!(onShorts || (forcedShortsScreen && settings.blockShorts))) {
      if (screen) screen.remove();
      return;
    }
    if (!screen && document.body) {
      screen = document.createElement("div");
      screen.id = "ytf-shorts-screen";
      screen.innerHTML =
        "<div><p class='ytf-big'>Shorts are blocked</p>" +
        "<p class='ytf-sub'>Focus Suite keeps the infinite scroll out. The rest of YouTube still works.</p>" +
        "<a href='/'>\u2190 Back to Home</a></div>";
      document.body.appendChild(screen);
    }
    var vids = document.querySelectorAll("video");
    for (var i = 0; i < vids.length; i++) { try { vids[i].pause(); vids[i].muted = true; } catch (e) { /* ignore */ } }
  }

  /* ------------------------- 18+ watch-page shield ---------------------- */
  function watchMeta() {
    if (location.pathname !== "/watch") return null;
    var titleEl = document.querySelector("h1.ytd-watch-metadata yt-formatted-string, h1.title yt-formatted-string, #title h1");
    var owner = document.querySelector("ytd-video-owner-renderer a[href*='/@'], #owner a[href*='/@']");
    var title = titleEl ? (titleEl.textContent || "") : (document.title || "");
    var channel = owner ? (owner.textContent || "") : "";
    return {
      url: location.href,
      title: String(title).replace(/\s+/g, " ").trim(),
      channel: String(channel).replace(/\s+/g, " ").trim()
    };
  }

  function updateAdultScreen() {
    var screen = document.getElementById("ytf-adult-screen");
    var info = C ? watchMeta() : null;
    var result = info ? C.classify(info) : null;
    if (!result || result.category !== "adult_18plus") {
      if (screen) screen.remove();
      return;
    }
    if (!screen && document.body) {
      screen = document.createElement("div");
      screen.id = "ytf-adult-screen";
      screen.innerHTML =
        "<div><p class='ytf-big'>18+ content blocked</p>" +
        "<p class='ytf-sub'>Focus Suite's on-device classifier flagged this video. 18+ content is never revealed.</p>" +
        "<a href='/'>\u2190 Back to Home</a></div>";
      document.body.appendChild(screen);
    }
    var vids = document.querySelectorAll("video");
    for (var i = 0; i < vids.length; i++) { try { vids[i].pause(); vids[i].muted = true; } catch (e) { /* ignore */ } }
  }

  document.addEventListener("click", function (e) {
    if (!settings.blockShorts || !e.target || !e.target.closest) return;
    var a = e.target.closest('a[href^="/shorts/"], a[href*="youtube.com/shorts/"]');
    if (!a) return;
    e.preventDefault();
    e.stopImmediatePropagation(); // the player never loads
    forcedShortsScreen = true;
    updateShortsScreen();
  }, true);

  /* ----------------- blocked-channel watch page bounce ------------------ */
  var bouncedFor = "";
  function bounceBlockedWatch() {
    if (location.pathname !== "/watch" || !handles.length) return;
    var owner = document.querySelector("ytd-video-owner-renderer a[href*='/@'], #owner a[href*='/@']");
    if (!owner) return;
    var href = owner.getAttribute("href") || "";
    var id = href + location.search;
    if (hrefBlocked(href) && bouncedFor !== id) {
      bouncedFor = id;
      try { var v = document.querySelector("video"); if (v) v.pause(); } catch (e) { /* ignore */ }
      location.replace("https://www.youtube.com/");
    }
  }

  /* --------------------- shield counters -> tracker ---------------------- */
  function flushShield() {
    if (!pending.hidden && !pending.shorts && !pending.adult) return;
    var msg = { type: "ytf-shield", hidden: pending.hidden, shorts: pending.shorts, adult: pending.adult };
    pending = { hidden: 0, shorts: 0, adult: 0 };
    try { chrome.runtime.sendMessage(msg, function () { void chrome.runtime.lastError; }); } catch (e) { /* ignore */ }
  }
  setInterval(flushShield, 15000);
  window.addEventListener("pagehide", flushShield);

  /* ------------------------------- wiring ------------------------------- */
  try {
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area === "sync" && SETTINGS_KEYS.some(function (k) { return changes[k]; })) load();
      if (area === "local" && changes.blockedChannels) load();
    });
  } catch (e) { /* live updates are a bonus */ }

  function onNavigate() {
    revealed = false;
    forcedShortsScreen = false;
    var adultScreen = document.getElementById("ytf-adult-screen");
    if (adultScreen) adultScreen.remove();
    if (root()) root().classList.remove("ytf-reveal");
    queue();
  }

  function start() {
    load();
    new MutationObserver(function (records) {
      for (var i = 0; i < records.length; i++) {
        var t = records[i].target;
        if (t && t.nodeType === 1 && t.closest && t.closest("yt-live-chat-renderer,#chat,ytd-comments")) continue;
        queue();
        return;
      }
    }).observe(root(), { childList: true, subtree: true });
    document.addEventListener("yt-navigate-finish", onNavigate);
    document.addEventListener("DOMContentLoaded", queue);
    window.addEventListener("popstate", onNavigate);
    window.addEventListener("focus", queue);
  }

  if (root()) start();
  else document.addEventListener("readystatechange", function once() {
    if (root()) { document.removeEventListener("readystatechange", once); start(); }
  });
})();
