/* Focus Suite 3.0 — keyword engine tests.   Run:  node tests/engine.test.js
   Pure Node, no browser. Locks in the YouTube Focus matching rules, the three
   modes, the search-override table, and that defaults behave as documented. */
"use strict";
const path = require("path");
require(path.join(__dirname, "..", "yt-defaults.js"));
const E = require(path.join(__dirname, "..", "yt-engine.js"));
const D = globalThis.FOCUS_DEFAULTS;

let failed = 0, total = 0;
function eq(name, actual, expected) {
  total++;
  if (actual === expected) console.log("  ok   " + name);
  else { failed++; console.error("  FAIL " + name + "  (got " + actual + ", expected " + expected + ")"); }
}
const kw = (list, text) => E.classifyText(text, E.compile({ blocked: list })).blocked;

console.log("Matching rules");
eq("focus matches 'focusing' (left boundary only)", kw(["focus"], "Focusing for hours"), true);
eq("art does NOT match 'smart'", kw(["art"], "Smart home ideas"), false);
eq("art matches 'state-of-the-art'", kw(["art"], "state-of-the-art tools"), true);
eq("case-insensitive", kw(["PRANK"], "best Prank ever"), true);
eq("'geo tv' matches 'geo-tv'", kw(["geo tv"], "Watch geo-tv live"), true);
eq("'geo tv' matches 'geo   tv'", kw(["geo tv"], "geo   tv drama"), true);
eq("'stand-up' matches 'stand up'", kw(["stand-up"], "stand up special"), true);
eq("18+ is regex-safe and matches", kw(["18+"], "18+ only"), true);
eq("c++ is regex-safe and matches", kw(["c++"], "learn c++ fast"), true);
eq("node.js is regex-safe; '.' is literal", kw(["node.js"], "nodexjs"), false);
eq("node.js matches literally", kw(["node.js"], "node.js crash course"), true);
eq("empty list never matches", kw([], "anything"), false);

const C = E.compile(D);
const dec = (text, mode, extra) => E.decide(text, Object.assign({}, D.settings, { mode }, extra || {}), C, extra && extra.opts);

console.log("Allowed always wins");
eq("failsafe is allowed even though 'fail' is blocked", dec("failsafe deployment guide", "balanced").hide, false);
eq("plain 'fail' compilation is hidden", dec("epic fail compilation", "balanced").hide, true);
eq("Pakistani drama is shown in strict", dec("Pakistani drama episode 12", "strict").hide, false);
eq("allowed beats blocked words in the same title", dec("drama funny moments", "balanced").hide, false);

console.log("Modes");
eq("Off never hides, even blocked words", dec("funniest pranks", "off").hide, false);
eq("Balanced hides blocked", dec("funniest pranks", "balanced").hide, true);
eq("Balanced keeps neutral videos", dec("how bridges are built", "balanced").hide, false);
eq("Strict hides neutral videos", dec("how bridges are built", "strict").hide, true);
eq("Strict shows good topics", dec("python tutorial for beginners", "strict").hide, false);
eq("Strict still hides blocked even with a good word", dec("funny coding fails", "strict").hide, true);

console.log("Search override table (query -> filtering skipped?)");
const ov = (q, mode) => E.queryOverride(q, Object.assign({}, D.settings, { queryPassMode: mode }), C).pass;
eq("allowed+good: 'drama' passes", ov("drama", "allowed+good"), true);
eq("allowed+good: 'tutorial' passes", ov("tutorial", "allowed+good"), true);
eq("allowed+good: 'funny' stays filtered", ov("funny", "allowed+good"), false);
eq("allowed-only: 'drama' passes", ov("drama", "allowed"), true);
eq("allowed-only: 'tutorial' stays filtered", ov("tutorial", "allowed"), false);
eq("never: 'drama' stays filtered", ov("drama", "never"), false);
eq("override skips keyword filtering",
  dec("funny coding fails", "balanced", { opts: { queryOverride: true } }).hide, false);
eq("queryPassStillBlocks keeps hard blocks hidden during override",
  dec("funny coding fails", "balanced", { queryPassStillBlocks: true, opts: { queryOverride: true } }).hide, true);

console.log("Defaults + helpers");
eq("defaults: mode is balanced", D.settings.mode, "balanced");
eq("defaults: Shorts blocked", D.settings.blockShorts, true);
eq("defaults: 14 allowed keywords", D.allowed.length, 14);
eq("parseList splits lines + commas and de-duplicates", E.parseList("A, b\nB\n\n a ").join("|"), "a|b");

if (failed) { console.error("\n" + failed + " of " + total + " engine test(s) failed."); process.exit(1); }
console.log("\nAll " + total + " engine tests passed.");
