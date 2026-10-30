/* Focus Suite 3.3 — options.js
   Keyword list + classifier editor + local inspector. Lists live in chrome.storage.sync, one
   key per list (each key has an 8 KB quota). Loosening protections is allowed
   — but never on impulse: removing Blocked keywords asks for a deliberate
   confirmation. The 18+ hard block itself has no off switch. */
"use strict";
(function () {
  var D = FOCUS_DEFAULTS;
  var E = FocusEngine;
  var C = window.ContentClassifier || null;
  var KEYS = ["ytfSettings", "ytfAllowed", "ytfGood", "ytfBlocked"];
  var LISTS = [["allowed", "ytfAllowed"], ["good", "ytfGood"], ["blocked", "ytfBlocked"]];
  var QUOTA_ITEM = 8192;
  var WARN_AT = 7000;
  var $ = function (id) { return document.getElementById(id); };
  var savedBlocked = D.blocked.slice();
  var currentSettings = Object.assign({}, D.settings);
  var verdictsState = {};
  var pendingVerdict = null;
  var verdictTimer = null;

  var PRESETS = {
    memory: {
      url: "https://www.youtube.com/watch?v=p9IOq5l2fV0",
      title: "How to Build a Memory Palace (Method of Loci Tutorial)",
      channel: "Cognitive Mastery Lab",
      description: "Learn how the ancient Greeks and World Memory Champions use spatial navigation to memorize thousands of facts, numbers, and vocabulary using memory palaces.",
      tags: "memory palace, method of loci, spaced repetition, mnemonics, memorization technique"
    },
    mit: {
      url: "https://ocw.mit.edu/courses/6-006-introduction-to-algorithms/",
      title: "MIT 6.006: Introduction to Algorithms - Lecture 1",
      channel: "MIT OpenCourseWare",
      description: "Peak finding, asymptotic notation, Big-O complexity and recurrences. High-level academic tutorial for computer science students.",
      tags: "mit opencourseware, algorithms, data structures, computer science, lecture"
    },
    huberman: {
      url: "https://www.youtube.com/watch?v=QmOF0crdyRU",
      title: "Controlling Your Dopamine For Motivation, Focus & Drive",
      channel: "Andrew Huberman",
      description: "Dr. Andrew Huberman discusses the neuroscience of dopamine, how quick-hit social media collapses baseline motivation, and how to build sustained deep work focus.",
      tags: "andrew huberman, dopamine detox, deep work, habit stacking, neuroscience"
    },
    gta: {
      url: "https://www.youtube.com/watch?v=gta5-funny-fails",
      title: "GTA 5 FUNNIEST MOMENTS & RAGE FAILS COMPILATION #89",
      channel: "Gaming Central Fails",
      description: "Watch hilarious gaming glitches, rage quit reactions, and funny moments in GTA Online! Try not to laugh challenge!",
      tags: "funny moments, fails compilation, try not to laugh, gta 5, rage quit"
    },
    shorts: {
      url: "https://www.youtube.com/shorts/craziest-prank-gone-wrong",
      title: "CRAZY PUBLIC PRANK GONE WRONG IN TARGET 😱💀 #shorts",
      channel: "Viral Prankster Central",
      description: "You won't believe what happened next!! Subscribe for part 2!",
      tags: "prank, shorts, viral, exposed"
    },
    adult: {
      url: "https://pornhub.com/view_video.php?viewkey=ph987654",
      title: "Uncensored 18+ Adult Video XXX Leaked",
      channel: "Adult Network Studio",
      description: "Explicit erotic adult video with high NSFW keywords.",
      tags: "xxx, porn, erotic, nsfw, 18+"
    },
    neutral: {
      url: "https://www.youtube.com/watch?v=bridges",
      title: "How bridges are built",
      channel: "Engineering Explained",
      description: "A short engineering explainer about bridge construction.",
      tags: ""
    }
  };

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

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

  function applyPreset(name) {
    var p = PRESETS[name];
    if (!p) return;
    $("inspectTitle").value = p.title;
    $("inspectChannel").value = p.channel;
    $("inspectUrl").value = p.url;
    $("inspectDescription").value = p.description;
    $("inspectTags").value = p.tags;
    $("inspectTranscript").value = "";
    inspect();
  }

  function clearInspect() {
    ["inspectTitle", "inspectChannel", "inspectUrl", "inspectDescription", "inspectTags", "inspectTranscript"].forEach(function (id) {
      $(id).value = "";
    });
    $("inspectResult").hidden = true;
    $("inspectResult").innerHTML = "";
    $("inspectStatus").textContent = "";
  }

  function renderInspect(result, v) {
    var labels = {
      adult_18plus: "18+ adult",
      entertainment: "Entertainment",
      education: "Education",
      memory_cognitive: "Memory & cognitive",
      self_improvement: "Self-improvement",
      unknown: "Unknown"
    };
    var cls = v.hard ? "hard" : v.hide ? "hide" : "allow";
    var verdict = v.hard ? "Hard blocked" : v.hide ? "Hidden now" : "Shown now";
    var rows = [
      ["18+ adult", result.scores.adult_18plus, "var(--coral)"],
      ["Entertainment", result.scores.entertainment, "var(--sand)"],
      ["Memory & cognitive", result.scores.memory_cognitive, "#c084fc"],
      ["Education", result.scores.education, "var(--mint)"],
      ["Self-improvement", result.scores.self_improvement, "var(--brand)"]
    ];
    var html = '<div class="inspect-head"><div><b>' + esc(labels[result.category] || result.category) +
      '</b><span class="badge ' + cls + '">' + verdict + '</span></div>' +
      '<span class="meta" style="margin:0">' + result.confidence + '% confidence · density ' + result.densityScore + '</span></div>' +
      '<p style="margin:8px 0 0;color:var(--muted)">' + esc(result.explanation) + '</p><div style="margin-top:10px">';
    rows.forEach(function (r) {
      var n = Math.max(0, Math.min(100, Math.round(r[1])));
      html += '<div class="meter"><span>' + esc(r[0]) + '</span><span class="track"><span class="fill" style="width:' + n +
        '%;background:' + r[2] + '"></span></span><span>' + n + '%</span></div>';
    });
    html += '</div><div class="signals">' + result.signalsDetected.map(function (sig) {
      return '<span class="signal">🔍 ' + esc(sig) + '</span>';
    }).join("") + '</div>';
    if (result.isShortForm) {
      html += '<p style="margin:8px 0 0;color:var(--sand);font-size:12px">Short-form format detected. In Only useful, it is hidden.</p>';
    }
    $("inspectResult").innerHTML = html;
    $("inspectResult").hidden = false;
  }

  function inspect() {
    var status = $("inspectStatus");
    if (!C) {
      status.textContent = "Classifier script did not load.";
      return;
    }
    var title = $("inspectTitle").value.trim();
    var url = $("inspectUrl").value.trim();
    if (!title && !url) {
      status.textContent = "Add a title or URL first.";
      return;
    }
    var tags = $("inspectTags").value.split(",").map(function (t) { return t.trim(); }).filter(Boolean);
    var result = C.classify({
      url: url,
      title: title,
      channelOrCreator: $("inspectChannel").value.trim(),
      description: $("inspectDescription").value.trim(),
      tags: tags,
      transcriptSample: $("inspectTranscript").value.trim()
    });
    var st = Object.assign({}, currentSettings, { smartFilter: $("smartFilter").checked });
    renderInspect(result, C.verdict(result, st));
    status.textContent = "Inspected locally — no network.";
  }

  function verdictSay(text, isErr) {
    var el = $("verdictStatus");
    el.textContent = text;
    el.style.color = isErr ? "var(--coral)" : "var(--mint)";
    clearTimeout(verdictSay.t);
    verdictSay.t = setTimeout(function () { el.textContent = ""; }, 4500);
  }

  function renderVerdicts(verdicts) {
    verdictsState = verdicts || {};
    var keys = Object.keys(verdictsState).sort();
    $("verdictEmpty").hidden = keys.length > 0;
    $("verdictClear").disabled = keys.length === 0;
    $("verdictList").innerHTML = keys.map(function (key) {
      var useful = verdictsState[key] === "useful";
      var armed = pendingVerdict === key;
      return '<div class="verdict-row"><span class="verdict-name">' + esc(key) + '</span>' +
        '<span class="verdict-tag ' + (useful ? "useful" : "useless") + '">' + (useful ? "👍 useful" : "👎 useless") + '</span>' +
        '<button class="verdict-remove ' + (armed ? "armed" : "") + '" type="button" data-verdict-remove="' + esc(key) + '">' +
        (armed ? "Sure?" : "Remove") + '</button></div>';
    }).join("");
  }

  function loadVerdicts() {
    chrome.storage.local.get(["channelVerdicts"], function (s) {
      void chrome.runtime.lastError;
      renderVerdicts(s.channelVerdicts || {});
    });
  }

  function removeVerdict(key) {
    var next = Object.assign({}, verdictsState);
    delete next[key];
    chrome.storage.local.set({ channelVerdicts: next }, function () {
      if (chrome.runtime.lastError) { verdictSay(chrome.runtime.lastError.message, true); return; }
      pendingVerdict = null;
      renderVerdicts(next);
      verdictSay("Removed. Open YouTube tabs update instantly.");
    });
  }

  function fill(s) {
    var st = Object.assign({}, D.settings, s.ytfSettings || {});
    currentSettings = st;
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
      currentSettings = settings;
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
        focusSuite: "3.3",
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
  Array.prototype.forEach.call(document.querySelectorAll("[data-preset]"), function (b) {
    b.addEventListener("click", function () { applyPreset(b.getAttribute("data-preset")); });
  });
  $("inspectRun").addEventListener("click", inspect);
  $("inspectClear").addEventListener("click", clearInspect);
  ["inspectTitle", "inspectUrl"].forEach(function (id) {
    $(id).addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); inspect(); } });
  });
  $("verdictList").addEventListener("click", function (e) {
    var btn = e.target.closest("[data-verdict-remove]");
    if (!btn) return;
    var key = btn.getAttribute("data-verdict-remove");
    if (pendingVerdict !== key) {
      pendingVerdict = key;
      renderVerdicts(verdictsState);
      clearTimeout(verdictTimer);
      verdictTimer = setTimeout(function () {
        pendingVerdict = null;
        renderVerdicts(verdictsState);
      }, 4000);
      return;
    }
    clearTimeout(verdictTimer);
    removeVerdict(key);
  });
  $("verdictClear").addEventListener("click", function () {
    var count = Object.keys(verdictsState).length;
    if (!count) return;
    if (!confirm("Clear all " + count + " channel verdict" + (count === 1 ? "" : "s") +
      "? Useful channels will no longer be forced into the feed; useless channels will no longer be hidden.")) return;
    chrome.storage.local.set({ channelVerdicts: {} }, function () {
      if (chrome.runtime.lastError) { verdictSay(chrome.runtime.lastError.message, true); return; }
      pendingVerdict = null;
      renderVerdicts({});
      verdictSay("All channel verdicts cleared.");
    });
  });
  try {
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area === "local" && changes.channelVerdicts) loadVerdicts();
    });
  } catch (e) { /* live updates are a bonus */ }
  $("save").addEventListener("click", save);
  $("reset").addEventListener("click", reset);
  $("export").addEventListener("click", exportJson);
  $("importBtn").addEventListener("click", function () { $("importFile").click(); });
  $("importFile").addEventListener("change", function (e) { if (e.target.files[0]) importJson(e.target.files[0]); e.target.value = ""; });
  load();
  loadVerdicts();
})();
