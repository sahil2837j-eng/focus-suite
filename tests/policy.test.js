/* Focus Tracker 2.0 — policy source tests.
   Run:  node tests/policy.test.js
   These guard the two breaking decisions of 2.0 at the source level:
   a future edit that reintroduces a Sunday branch, a 48h term, or an
   unlock message should fail here before it ever ships. */
"use strict";
const fs = require("fs");
const path = require("path");

const bg = fs.readFileSync(path.join(__dirname, "..", "background.js"), "utf8");
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8"));
const popup = fs.readFileSync(path.join(__dirname, "..", "popup.js"), "utf8")
  + fs.readFileSync(path.join(__dirname, "..", "popup.html"), "utf8");
const options = fs.readFileSync(path.join(__dirname, "..", "options.js"), "utf8")
  + fs.readFileSync(path.join(__dirname, "..", "options.html"), "utf8");
const classifier = fs.readFileSync(path.join(__dirname, "..", "content-classifier.js"), "utf8");
const focusScript = fs.readFileSync(path.join(__dirname, "..", "youtube-focus.js"), "utf8");

let failed = 0;
function check(name, condition) {
  if (condition) console.log(`  ok   ${name}`);
  else { console.error(`  FAIL ${name}`); failed++; }
}

console.log("24-hour term");
check("BLOCK_MS is exactly DAY_MS", /BLOCK_MS\s*=\s*DAY_MS/.test(bg));
check("DAY_MS is 24 * 60 * 60 * 1000", /DAY_MS\s*=\s*24\s*\*\s*60\s*\*\s*60\s*\*\s*1000/.test(bg));
check("no 48-hour arithmetic anywhere", !/\b48\s*\*\s*60/.test(bg) && !/2\s*\*\s*DAY_MS/.test(bg));
check("detox arms endsAt = now + BLOCK_MS", /endsAt:\s*now \+ BLOCK_MS/.test(bg));

console.log("Sunday exemption deleted");
check("sundayAllowed appears only in the migration purge",
  (bg.match(/sundayAllowed/g) || []).length === 3 && bg.includes('"sundayAllowed" in b'));
check("rule sync has no day-of-week branch", !bg.slice(bg.indexOf("async function syncRules"), bg.indexOf("async function pushBlockLog")).includes("getDay"));
check("popup has no Sunday toggle or exemption key",
  !/sundayAllowed|allowOnSunday|allow on Sundays/i.test(popup));
check("manifest carries the 2.0 identity (no 'Sunday' in the name)", !/sunday/i.test(manifest.name));

console.log("No early-lift surface");
check("worker exposes no lift/unblock/skip message",
  !/case\s+"(lift|unblock|skip|liftBlock|unblockNow)"/.test(bg));
check("removeBlock refuses locked detox terms", bg.includes("Locked by policy. Detox terms end by clock only."));
check("removeBlock refuses the locked YouTube term", bg.includes("Locked by policy. The 24h YouTube term ends by clock only."));
check("judging can arm but never lift (comment is law)", bg.includes("can arm, never lift"));

console.log("Explainability + clock guard");
check("every firing writes to blockLog", (bg.match(/pushBlockLog\(/g) || []).length >= 3);
check("expiry uses effNow (largest observed timestamp)", bg.includes("function effNow()") && bg.includes("Math.max(Date.now(), lastSeenAt)"));

console.log("Suite merge");
const contentScripts = manifest.content_scripts || [];
const focusEntry = contentScripts.find((c) => (c.js || []).includes("youtube-focus.js")) || {};
check("one YouTube Focus content script, injected at document_start", focusEntry.run_at === "document_start");
check("shared defaults + engine + classifier load before the content script",
  (focusEntry.js || []).join(",") === "yt-defaults.js,yt-engine.js,content-classifier.js,youtube-focus.js");
check("the old youtube-blocker.js is gone from the manifest", !JSON.stringify(manifest).includes("youtube-blocker"));
check("options page is declared", !!(manifest.options_ui && manifest.options_ui.page === "options.html"));
check("worker imports the shared engine + classifier",
  bg.includes('importScripts("yt-defaults.js", "yt-engine.js", "content-classifier.js")'));
check("tracker classification uses the shared keyword lists", bg.includes("self.FocusEngine.classifyText"));
check("Allowed wins in tracker classification too", bg.includes("Allowed always wins"));
check("loosening a YouTube protection needs a second click", popup.includes("armLoosen(key)") && popup.includes("armLoosen(\"mode:\" + mode)"));
check("shield counters carry numbers only (no titles, no URLs)",
  /type:\s*"ytf-shield",\s*hidden:\s*pending\.hidden,\s*shorts:\s*pending\.shorts,\s*adult:\s*pending\.adult/.test(fs.readFileSync(path.join(__dirname, "..", "youtube-focus.js"), "utf8")));

console.log("18+ hard block");
check("classifier exposes adult domains and a verdict helper",
  classifier.includes("ADULT_DOMAINS") && classifier.includes("function verdict"));
check("18+ is always hard-blocked in the pure verdict",
  classifier.includes('result.category === "adult_18plus"') && classifier.includes('reason: "adult"'));
check("YouTube tiles are tagged with classifier categories",
  focusScript.includes("data-ytf-cat") && focusScript.includes("adult_18plus"));
check("worker adds permanent adult-domain DNR rules",
  bg.includes("RID.adult") && bg.includes("MAX_ADULT_DOMAINS") && bg.includes("self.ContentClassifier.ADULT_DOMAINS"));
check("popup exposes the classifier toggle",
  popup.includes("smartFilter") && popup.includes("Smart content classifier"));

console.log("Classifier inspector + channel verdicts");
check("options loads the shared classifier before its own script",
  /<script src="content-classifier\.js"><\/script>\s*<script src="options\.js"><\/script>/.test(options));
check("options has a local inspector with presets",
  options.includes("inspectTitle") && options.includes("inspectRun") && options.includes("data-preset"));
check("options inspector uses the shared classifier and verdict helper",
  options.includes("C.classify") && options.includes("C.verdict") && options.includes("renderInspect"));
check("options explains the five local layers",
  options.includes("How it decides") && options.includes("05 · Policy"));
check("YouTube page loads channel verdicts from local storage",
  focusScript.includes("channelVerdicts") && focusScript.includes('chrome.storage.local.get(["blockedChannels", "channelVerdicts"]'));
check("channel verdicts override keywords but never adult hard blocks",
  focusScript.includes("channel-verdict") && focusScript.indexOf("result.category === \"adult_18plus\"") < focusScript.indexOf("channelVerdict === \"useful\""));

if (failed) {
  console.error(`\n${failed} policy test(s) failed. 2.0 means: 24h, 7/7, clock only.`);
  process.exit(1);
}
console.log("\nAll policy tests passed: 24h locked terms, seven-day enforcement, no lift.");
