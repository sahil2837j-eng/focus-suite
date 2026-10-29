/* Focus Suite 3.2 — content classifier tests.
   Run:  node tests/classifier.test.js
   Pure Node, no browser. Locks the local education / memory / self-improvement /
   entertainment / 18+ decision rules and the useful-only verdict table. */
"use strict";
const path = require("path");
const C = require(path.join(__dirname, "..", "content-classifier.js"));

let failed = 0, total = 0;
function eq(name, actual, expected) {
  total++;
  if (actual === expected) console.log("  ok   " + name);
  else { failed++; console.error("  FAIL " + name + "  (got " + actual + ", expected " + expected + ")"); }
}
function truthy(name, actual) {
  total++;
  if (actual) console.log("  ok   " + name);
  else { failed++; console.error("  FAIL " + name + "  (got " + actual + ")"); }
}

const classify = (title, extra) => C.classify(Object.assign({ url: "https://www.youtube.com/watch?v=test", title }, extra || {}));

console.log("Categories");
eq("known adult domain is 18+", C.classify({ url: "https://www.pornhub.com/view_video.php?viewkey=x", title: "video" }).category, "adult_18plus");
eq("explicit adult title is 18+", classify("nsfw erotic massage").category, "adult_18plus");
eq("two suggestive markers cross the 18+ line", classify("18+ bikini haul").category, "adult_18plus");
eq("memory palace is memory_cognitive", classify("How to Build a Memory Palace (Method of Loci)").category, "memory_cognitive");
eq("python tutorial is education", classify("Python tutorial for beginners", { channelOrCreator: "freeCodeCamp.org" }).category, "education");
eq("deep work is self_improvement", classify("Deep Work: rules for focused success", { channelOrCreator: "Cal Newport" }).category, "self_improvement");
eq("prank short is entertainment", classify("Funniest pranks", { url: "https://www.youtube.com/shorts/abc" }).category, "entertainment");
eq("neutral how-it-works stays unknown", classify("How bridges are built").category, "unknown");
eq("Pakistani drama stays unknown (Allowed handles it)", classify("Pakistani drama episode 12").category, "unknown");

console.log("Inspector presets");
const mit = C.classify({
  url: "https://ocw.mit.edu/courses/6-006-introduction-to-algorithms/",
  title: "MIT 6.006: Introduction to Algorithms - Lecture 1",
  channelOrCreator: "MIT OpenCourseWare",
  description: "Peak finding, asymptotic notation, Big-O complexity and recurrences.",
  tags: ["mit opencourseware", "algorithms", "lecture"]
});
eq("MIT lecture is education", mit.category, "education");
const huberman = C.classify({
  url: "https://www.youtube.com/watch?v=QmOF0crdyRU",
  title: "Controlling Your Dopamine For Motivation, Focus & Drive",
  channelOrCreator: "Andrew Huberman",
  description: "Neuroscience of dopamine and sustained deep work focus.",
  tags: ["andrew huberman", "dopamine detox", "deep work"]
});
truthy("Huberman focus is useful", C.isUseful(huberman.category));
const gta = C.classify({
  url: "https://www.youtube.com/watch?v=gta5-funny-fails",
  title: "GTA 5 FUNNIEST MOMENTS & RAGE FAILS COMPILATION #89",
  channelOrCreator: "Gaming Central Fails",
  tags: ["funny moments", "fails compilation", "try not to laugh"]
});
eq("GTA fails is entertainment", gta.category, "entertainment");
const adultPreset = C.classify({
  url: "https://pornhub.com/view_video.php?viewkey=ph987654",
  title: "Uncensored 18+ Adult Video XXX Leaked",
  channelOrCreator: "Adult Network Studio",
  tags: ["xxx", "porn", "erotic", "nsfw", "18+"]
});
eq("adult preset is 18+", adultPreset.category, "adult_18plus");
eq("adult preset hard-blocks", C.verdict(adultPreset, { smartFilter: false, mode: "off" }).hard, true);
eq("lookalike domain is not an adult domain", C.classify({ url: "https://notpornhub.com/watch", title: "How bridges are built" }).category, "unknown");
eq("lookalike domain is not an education domain", C.classify({ url: "https://youtube.com.evil.example/watch", title: "random clip" }).category, "unknown");

console.log("Shape + short-form");
const short = classify("Funniest pranks", { url: "https://www.youtube.com/shorts/abc" });
eq("short-form flag", short.isShortForm, true);
eq("short entertainment recommends hard_block", short.recommendedAction, "hard_block");
truthy("confidence is bounded", short.confidence >= 0 && short.confidence <= 100);
truthy("signals are explainable", Array.isArray(short.signalsDetected) && short.signalsDetected.length > 0);
truthy("scores include all five categories", ["adult_18plus", "entertainment", "education", "memory_cognitive", "self_improvement"].every((k) => typeof short.scores[k] === "number"));

console.log("Useful-only verdict table");
const adult = C.classify({ url: "https://www.pornhub.com/", title: "video" });
const ent = classify("Funniest pranks", { url: "https://www.youtube.com/shorts/abc" });
const neutral = classify("How bridges are built");
const useful = classify("Python tutorial for beginners", { channelOrCreator: "freeCodeCamp.org" });

eq("18+ hard-blocks even with smart filter off", C.verdict(adult, { smartFilter: false, mode: "off" }).hard, true);
eq("18+ hard-blocks in balanced", C.verdict(adult, { smartFilter: true, mode: "balanced" }).hide, true);
eq("entertainment hidden in balanced", C.verdict(ent, { smartFilter: true, mode: "balanced" }).hide, true);
eq("entertainment hidden in strict", C.verdict(ent, { smartFilter: true, mode: "strict" }).hide, true);
eq("entertainment allowed when classifier is off", C.verdict(ent, { smartFilter: false, mode: "strict" }).hide, false);
eq("unknown hidden in strict", C.verdict(neutral, { smartFilter: true, mode: "strict" }).hide, true);
eq("unknown allowed in balanced", C.verdict(neutral, { smartFilter: true, mode: "balanced" }).hide, false);
eq("education allowed in strict", C.verdict(useful, { smartFilter: true, mode: "strict" }).hide, false);
truthy("isUseful covers education, memory, self", C.isUseful("education") && C.isUseful("memory_cognitive") && C.isUseful("self_improvement"));
truthy("isUseful excludes adult and entertainment", !C.isUseful("adult_18plus") && !C.isUseful("entertainment") && !C.isUseful("unknown"));

console.log("Domain helper");
eq("www is stripped", C.extractDomain("https://www.youtube.com/watch?v=x"), "youtube.com");
eq("adult domain list is exported", C.ADULT_DOMAINS.length > 10, true);

if (failed) {
  console.error(`\n${failed} of ${total} classifier test(s) failed.`);
  process.exit(1);
}
console.log(`\nAll ${total} classifier tests passed.`);
