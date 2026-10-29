/* Focus Suite 3.1 — options.js
   Keyword list + classifier editor. Lists live in chrome.storage.sync, one
   key per list (each key has an 8 KB quota). Loosening protections is allowed
   — but never on impulse: removing Blocked keywords asks for a deliberate
   confirmation. The 18+ hard block itself has no off switch. */
"use strict";
(function () {
  var D = FOCUS_DEFAULTS;
  var E = FocusEngine;
  var KEYS = ["ytfSettings", "ytfAllowed", "ytfGood", "ytfBlocked"];
  var LISTS = [["allowed", "ytfAllowed"], ["good", "ytfGood"], ["blocked", "ytfBlocked"]];
  var QUOTA_ITEM = 8192;
  var WARN_AT = 7000;
  var $ = function (id) { return document.getElementById(id); };
  var savedBlocked = D.blocked.slice();

  function say(text, isErr) {
    var s = $("status");
    s.textContent = text;
    s.className = isErr ? "err" : "";
    clearTimeout(say.t);
    say.t = setTimeout(function () { s.textContent = ""; }, 4500);
  }

  function updateMeters() {
    LISTS.forEach(function (pair) {
      var id = pair[0], key = pair[1];
      var items = E.parseList($(id).value);
      var bytes = key.length + JSON.stringify(items).length;
      $(id + "Count").textContent = items.length + " keyword" + (items.length === 1 ? "" : "s");
      var size = $(id + "Size");
      size.textContent = (bytes / 1024).toFixed(1) + " KB of 8 KB sync quota" + (bytes > WARN_AT ? " — near the limit" : "");
      size.className = bytes > WARN_AT ? "warn" : "";
    });
  }

  function fill(s) {
    var st = Object.assign({}, D.settings, s.ytfSettings || {});
    $("allowed").value = (s.ytfAllowed || D.allowed).join("\n");
    $("good").value = (s.ytfGood || D.good).join("\n");
    $("blocked").value = (s.ytfBlocked || D.blocked).join("\n");
    $("queryMode").value = st.queryPassMode;
    $("stillBlocks").checked = !!st.queryPassStillBlocks;
    $("smartFilter").checked = st.smartFilter !== false;
    savedBlocked = (s.ytfBlocked || D.blocked).slice();
    updateMeters();
  }

  function load() { chrome.storage.sync.get(KEYS, fill); }

  function save() {
    var next = {
      ytfAllowed: E.parseList($("allowed").value),
      ytfGood: E.parseList($("good").value),
      ytfBlocked: E.parseList($("blocked").value)
    };
    for (var i = 0; i < LISTS.length; i++) {
      var key = LISTS[i][1];
      if (key.length + JSON.stringify(next[key]).length > QUOTA_ITEM) {
        say("The " + LISTS[i][0] + " list is over the 8 KB sync quota — trim it and save again.", true);
        return;
      }
    }
    var removed = savedBlocked.filter(function (k) { return next.ytfBlocked.indexOf(k) === -1; });
    if (removed.length && !confirm(
      "You are removing " + removed.length + " blocked keyword" + (removed.length === 1 ? "" : "s") +
      ":\n\n" + removed.slice(0, 12).join(", ") + (removed.length > 12 ? ", …" : "") +
      "\n\nLoosening protections is allowed — but not on impulse. Continue?")) return;

    chrome.storage.sync.get(["ytfSettings"], function (s) {
      var settings = Object.assign({}, D.settings, s.ytfSettings || {}, {
        queryPassMode: $("queryMode").value,
        queryPassStillBlocks: $("stillBlocks").checked,
        smartFilter: $("smartFilter").checked
      });
      next.ytfSettings = settings;
      chrome.storage.sync.set(next, function () {
        if (chrome.runtime.lastError) { say(chrome.runtime.lastError.message, true); return; }
        savedBlocked = next.ytfBlocked.slice();
        say("Saved. Open YouTube tabs update instantly.");
      });
    });
  }

  function reset() {
    if (!confirm("Reset all three lists, the classifier toggle, and the search override to the defaults?")) return;
    chrome.storage.sync.get(["ytfSettings"], function (s) {
      var settings = Object.assign({}, s.ytfSettings || {}, {
        queryPassMode: D.settings.queryPassMode,
        queryPassStillBlocks: D.settings.queryPassStillBlocks,
        smartFilter: D.settings.smartFilter
      });
      chrome.storage.sync.set({
        ytfSettings: settings, ytfAllowed: D.allowed.slice(), ytfGood: D.good.slice(), ytfBlocked: D.blocked.slice()
      }, function () { load(); say("Defaults restored."); });
    });
  }

  function exportJson() {
    chrome.storage.sync.get(KEYS, function (s) {
      var data = {
        focusSuite: "3.1",
        settings: Object.assign({}, D.settings, s.ytfSettings || {}),
        allowed: s.ytfAllowed || D.allowed, good: s.ytfGood || D.good, blocked: s.ytfBlocked || D.blocked
      };
      var a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
      a.download = "focus-suite-youtube-settings.json";
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 3000);
    });
  }

  function importJson(file) {
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var d = JSON.parse(String(reader.result));
        if (!Array.isArray(d.allowed) || !Array.isArray(d.good) || !Array.isArray(d.blocked)) throw new Error("Missing allowed/good/blocked arrays.");
        fill({
          ytfSettings: d.settings || {},
          ytfAllowed: E.parseList(d.allowed.join("\n")),
          ytfGood: E.parseList(d.good.join("\n")),
          ytfBlocked: E.parseList(d.blocked.join("\n"))
        });
        savedBlocked = D.blocked.slice(); // importing counts as an edit: removals will still confirm
        say("Imported into the editor — press Save to apply.");
      } catch (err) { say("Import failed: " + err.message, true); }
    };
    reader.readAsText(file);
  }

  ["allowed", "good", "blocked"].forEach(function (id) { $(id).addEventListener("input", updateMeters); });
  $("save").addEventListener("click", save);
  $("reset").addEventListener("click", reset);
  $("export").addEventListener("click", exportJson);
  $("importBtn").addEventListener("click", function () { $("importFile").click(); });
  $("importFile").addEventListener("change", function (e) { if (e.target.files[0]) importJson(e.target.files[0]); e.target.value = ""; });
  load();
})();
