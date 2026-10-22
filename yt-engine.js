/* Focus Suite 3.0 — yt-engine.js
   Pure keyword matching / decision engine. DOM-free, chrome-free, so it runs
   in the content script, the service worker, the options page, Node tests,
   and the live tester on the product page.

   Matching rules
   - case-insensitive
   - LEFT word boundary only:  "focus" matches "focusing";  "art" does NOT match "smart"
   - multi-word keywords match spaces OR hyphens:  "geo tv" matches "geo-tv"
   - input is regex-escaped:  "18+", "c++", "node.js" are safe
   - Allowed ALWAYS wins over Blocked (escape hatch: "fail" blocks, "failsafe" allowed) */
(function (root) {
  "use strict";

  var SYNTAX = /[.*+?^${}()|[\]\\]/g;
  function esc(s) { return s.replace(SYNTAX, "\\$&"); }
  function tokens(k) { return String(k).trim().toLowerCase().split(/[\s-]+/).filter(Boolean); }

  function compileList(list) {
    var parts = [];
    var seen = {};
    (list || []).forEach(function (k) {
      var t = tokens(k);
      if (!t.length) return;
      var key = t.join(" ");
      if (seen[key]) return;
      seen[key] = true;
      parts.push(t.map(esc).join("[\\s-]+"));
    });
    if (!parts.length) return null;
    return new RegExp("(?<![\\p{L}\\p{N}_])(?:" + parts.join("|") + ")", "iu");
  }

  function compile(lists) {
    lists = lists || {};
    return {
      allowed: compileList(lists.allowed),
      good: compileList(lists.good),
      blocked: compileList(lists.blocked)
    };
  }

  function hit(re, text) { return !!re && re.test(text); }

  function classifyText(text, c) {
    var t = String(text || "").toLowerCase();
    return { allowed: hit(c.allowed, t), good: hit(c.good, t), blocked: hit(c.blocked, t) };
  }

  /* Search override: a query that matches the right list skips filtering
     for that results page. queryPassMode decides which lists count. */
  function queryOverride(query, settings, c) {
    var mode = (settings && settings.queryPassMode) || "allowed+good";
    if (mode === "never" || !query) return { pass: false, via: null };
    var k = classifyText(query, c);
    if (k.allowed) return { pass: true, via: "allowed" };
    if (mode === "allowed+good" && k.good) return { pass: true, via: "good" };
    return { pass: false, via: null };
  }

  /* The one decision. opts.queryOverride = the results page is overridden. */
  function decide(text, settings, c, opts) {
    var mode = (settings && settings.mode) || "balanced";
    if (mode === "off") return { hide: false, reason: "mode-off" };
    var k = classifyText(text, c);
    if (k.allowed) return { hide: false, reason: "allowed" };
    if (opts && opts.queryOverride) {
      if (settings.queryPassStillBlocks && k.blocked) return { hide: true, reason: "blocked" };
      return { hide: false, reason: "query-override" };
    }
    if (k.blocked) return { hide: true, reason: "blocked" };
    if (mode === "strict") return k.good ? { hide: false, reason: "good" } : { hide: true, reason: "not-good" };
    return { hide: false, reason: "neutral" };
  }

  function parseList(text) {
    var seen = {};
    return String(text || "").split(/[\n,]+/).map(function (s) { return s.trim().toLowerCase(); })
      .filter(function (s) { if (!s || seen[s]) return false; seen[s] = true; return true; });
  }

  var api = {
    compile: compile, compileList: compileList, classifyText: classifyText,
    queryOverride: queryOverride, decide: decide, parseList: parseList
  };
  root.FocusEngine = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : self);
