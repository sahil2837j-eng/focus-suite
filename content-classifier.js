/* Focus Suite 3.2 — content-classifier.js
   On-device content classifier ported from the standalone
   build-content-classification-feature project. It is intentionally
   DOM-free and network-free: the same file runs in the YouTube content
   script, the service worker, and Node tests.

   Categories
     adult_18plus      hard block, zero tolerance
     entertainment     distraction / dopamine content
     education         lectures, tutorials, academic material
     memory_cognitive  memory, recall, cognitive training
     self_improvement  habits, focus, discipline
     unknown           not enough signal

   This is a transparent heuristic, not a moral verdict. User Allowed
   keywords always win in the extension; 18+ is the one hard exception. */
(function (root) {
  "use strict";

  var ADULT_DOMAINS = [
    "pornhub.com", "xvideos.com", "xnxx.com", "chaturbate.com", "onlyfans.com",
    "redtube.com", "youporn.com", "brazzers.com", "stripchat.com", "livejasmin.com",
    "rule34.xxx", "e-hentai.org", "nhentai.net", "cam4.com", "spankbang.com",
    "tube8.com", "xhamster.com", "beeg.com", "eporner.com", "hqporner.com",
    "heavy-r.com", "fapello.com", "coomer.party", "kemono.party"
  ];

  var ADULT_EXPLICIT_KEYWORDS = [
    "porn", "xxx", "nsfw", "hentai", "erotic", "sex video", "hardcore porn",
    "onlyfans leak", "nude leak", "nude photos", "uncensored sex", "blowjob",
    "cumshot", "creampie", "deepthroat", "threesome", "gangbang", "masturbat",
    "dildo", "vibrator", "hot tub streamer", "bikini try on haul nsfw", "thong haul",
    "cleavage compilation", "erotic massage", "escort service", "bukkake", "milf",
    "shemale", "bdsm", "bondage sex", "fetish"
  ];

  var ADULT_SUGGESTIVE_KEYWORDS = [
    "18+", "bikini haul", "micro bikini", "try on haul", "twerk", "twerking",
    "sexy dance", "hot girl", "stripper", "lingerie haul", "strip tease",
    "nsfw clips", "leaked stream", "naked in public prank", "shower stream",
    "kissing prank gone wild", "provocative", "see through clothes"
  ];

  var ENTERTAINMENT_DOMAINS = [
    "tiktok.com", "9gag.com", "twitch.tv", "netflix.com", "buzzfeed.com",
    "ifunny.co", "roblox.com", "epicgames.com", "store.steampowered.com", "ign.com",
    "kotaku.com", "tmz.com", "eonline.com", "boredpanda.com", "chive.com",
    "reddit.com/r/memes", "reddit.com/r/funny", "reddit.com/r/dankmemes"
  ];

  var ENTERTAINMENT_KEYWORDS = [
    "prank", "try not to laugh", "reacts to", "reaction to", "gossip",
    "drama exposed", "exposed video", "satisfying slime", "rage quit",
    "roast compilation", "funny moments", "fails compilation", "mrbeast challenge",
    "minecraft manhunt", "fortnite gameplay", "gta 5 funny moments", "valorant clutches",
    "celebrity drama", "tea spilled", "diss track", "unboxing toys", "vlog day",
    "daily vlog", "skibidi toilet", "brainrot", "meme compilation", "tiktok cringe",
    "dating show", "reality tv", "cheating caught", "gold digger prank",
    "cursed videos", "asmr mukbang", "eating 10000 calories", "24 hours in a box"
  ];

  var EDUCATIONAL_DOMAINS = [
    "khanacademy.org", "coursera.org", "edx.org", "ocw.mit.edu", "brilliant.org",
    "ankiweb.net", "quizlet.com", "arxiv.org", "codecademy.com", "leetcode.com",
    "stanford.edu", "freecodecamp.org", "nature.com", "sciencedirect.com",
    "w3schools.com", "developer.mozilla.org", "geeksforgeeks.org", "wikipedia.org",
    "britannica.com", "ted.com", "jstor.org"
  ];

  var MEMORY_KEYWORDS = [
    "memory palace", "method of loci", "spaced repetition", "active recall", "anki",
    "mnemonic", "mnemonics", "ebbinghaus forgetting curve", "forgetting curve",
    "neuroplasticity", "hippocampus", "dual n-back", "working memory",
    "chunking technique", "feynman technique", "superlearning", "brain training",
    "speed reading", "memorization technique", "memorize fast", "cognitive load theory",
    "retention rate", "mind mapping", "neurobiology of memory",
    "consolidation of memory", "long term potentiation", "jim kwik memory",
    "dominic o'brien", "memory championship"
  ];

  var EDUCATION_KEYWORDS = [
    "tutorial", "lecture", "crash course", "course", "how to build", "full course",
    "introduction to", "calculus", "linear algebra", "quantum physics",
    "organic chemistry", "neuroscience", "algorithms and data structures",
    "software engineering", "python for beginners", "deep learning",
    "machine learning course", "biology documentary", "history lecture",
    "astrophysics", "computer architecture", "mathematics proof", "derivation",
    "khan academy", "mit opencourseware", "cs50", "scientific explanation",
    "veritasium", "3blue1brown", "kurzgesagt science", "crashcourse",
    "step-by-step tutorial", "academic review", "microbiology", "thermodynamics",
    "economics explained"
  ];

  var SELF_IMPROVEMENT_KEYWORDS = [
    "deep work", "atomic habits", "dopamine detox", "huberman lab",
    "andrew huberman", "cal newport", "james clear", "pomodoro technique",
    "time management", "discipline over motivation", "monk mode", "stoicism",
    "marcus aurelius", "habit stacking", "morning routine", "sleep optimization",
    "circadian rhythm", "calisthenics form", "hyperfocus", "flow state",
    "overcoming procrastination", "focus protocol", "mental resilience",
    "productivity system", "cold plunge benefits", "meditation practice",
    "gratitude journaling", "vo2 max training"
  ];

  var EDUCATIONAL_CREATORS = [
    "3blue1brown", "veritasium", "kurzgesagt", "andrew huberman", "huberman lab",
    "freecodecamp", "cs50", "khan academy", "crashcourse", "lex fridman",
    "mit opencourseware", "stanford online", "fireship", "the primeagen",
    "ali abdaal", "thomas frank", "numberphile", "minutephysics", "smarter everyday",
    "scishow", "ted-ed", "mark rober", "statquest", "two minute papers",
    "real engineering"
  ];

  var DISTRACTING_CREATORS = [
    "mrbeast", "logan paul", "jake paul", "ishowspeed", "adin ross", "kai cenat",
    "pewdiepie", "sssniperwolf", "dharr mann", "troom troom", "5-minute crafts",
    "sidemen", "ksi", "vlad and niki"
  ];

  function extractDomain(urlStr) {
    try {
      var parsed = new URL(String(urlStr || "").indexOf("http") === 0 ? urlStr : "https://" + urlStr);
      return parsed.hostname.toLowerCase().replace(/^www\./, "");
    } catch (e) {
      return String(urlStr || "").toLowerCase().split("/")[0] || "";
    }
  }

  function hasAny(text, list) {
    for (var i = 0; i < list.length; i++) if (text.indexOf(list[i]) !== -1) return list[i];
    return "";
  }

  function domainMatch(domain, list) {
    for (var i = 0; i < list.length; i++) {
      var d = list[i];
      if (domain === d || domain.slice(-(d.length + 1)) === "." + d) return d;
    }
    return "";
  }

  function countHits(text, list) {
    var n = 0, first = "";
    for (var i = 0; i < list.length; i++) {
      if (text.indexOf(list[i]) !== -1) { n++; if (!first) first = list[i]; }
    }
    return { n: n, first: first };
  }

  function classify(input) {
    input = input || {};
    var url = String(input.url || "");
    var title = String(input.title || "").toLowerCase();
    var creator = String(input.channelOrCreator || input.channel || "").toLowerCase();
    var description = String(input.description || "").toLowerCase();
    var transcript = String(input.transcriptSample || "").toLowerCase();
    var tags = (input.tags || []).map(function (t) { return String(t).toLowerCase(); }).join(" ");
    var combined = [title, description, tags, transcript, creator].join(" ").toLowerCase();
    var domain = extractDomain(url);
    var isShortForm = url.indexOf("/shorts/") !== -1 || url.indexOf("tiktok.com") !== -1 ||
      url.indexOf("/reels/") !== -1 || title.indexOf("#shorts") !== -1;
    var signals = [];

    var adultScore = 0;
    var entertainmentScore = 0;
    var educationScore = 0;
    var memoryScore = 0;
    var selfImprovementScore = 0;

    if (domainMatch(domain, ADULT_DOMAINS)) {
      adultScore += 100;
      signals.push("Known adult domain: " + domain);
    }
    if (domainMatch(domain, EDUCATIONAL_DOMAINS)) {
      educationScore += 80;
      signals.push("Verified education domain: " + domain);
    }
    if (domainMatch(domain, ENTERTAINMENT_DOMAINS)) {
      entertainmentScore += 75;
      signals.push("Entertainment platform: " + domain);
    }

    if (isShortForm) {
      entertainmentScore += 35;
      signals.push("Short-form feed detected");
    }

    if (hasAny(creator + " " + title, EDUCATIONAL_CREATORS)) {
      educationScore += 45;
      selfImprovementScore += 25;
      signals.push("Known educational creator");
    }
    if (hasAny(creator + " " + title, DISTRACTING_CREATORS)) {
      entertainmentScore += 55;
      signals.push("High-stimulus creator");
    }

    var adultHit = hasAny(combined, ADULT_EXPLICIT_KEYWORDS);
    if (adultHit) {
      adultScore += 65;
      signals.push("Explicit adult marker: " + adultHit);
    }
    var suggestive = countHits(combined, ADULT_SUGGESTIVE_KEYWORDS);
    if (suggestive.n) {
      adultScore += Math.min(2, suggestive.n) * 30;
      entertainmentScore += 20;
      signals.push("Suggestive marker: " + suggestive.first);
    }
    if (/(?:^|[.\/_-])(porn|xxx|nsfw|onlyfans|fetish|erotic|nude|hentai|adult-video)(?:[.\/_-]|$)/i.test(url)) {
      adultScore += 60;
      signals.push("Adult token in URL");
    }

    var memoryHit = hasAny(combined, MEMORY_KEYWORDS);
    if (memoryHit) {
      memoryScore += 55;
      educationScore += 15;
      signals.push("Memory concept: " + memoryHit);
    }
    var educationHit = hasAny(combined, EDUCATION_KEYWORDS);
    if (educationHit) {
      educationScore += 25;
      signals.push("Education marker: " + educationHit);
    }
    var selfHit = hasAny(combined, SELF_IMPROVEMENT_KEYWORDS);
    if (selfHit) {
      selfImprovementScore += 50;
      signals.push("Self-improvement marker: " + selfHit);
    }
    var entertainmentHit = hasAny(combined, ENTERTAINMENT_KEYWORDS);
    if (entertainmentHit) {
      entertainmentScore += 30;
      signals.push("Entertainment marker: " + entertainmentHit);
    }

    var rawTitle = String(input.title || "");
    var upper = rawTitle.replace(/[^A-Z]/g, "").length;
    var letters = rawTitle.replace(/[^a-zA-Z]/g, "").length;
    if (letters > 10 && upper / letters > 0.6) {
      entertainmentScore += 20;
      signals.push("ALL-CAPS clickbait");
    }
    if (/[!]{2,}|[?]{2,}|[\u{1F631}\u{1F525}\u{1F480}\u{1F92F}]/u.test(rawTitle)) {
      entertainmentScore += 15;
      signals.push("Sensational punctuation/emoji");
    }

    var words = combined.split(/\s+/).filter(function (w) { return w.length > 2; });
    var unique = {};
    for (var i = 0; i < words.length; i++) unique[words[i]] = true;
    var diversity = words.length ? (Object.keys(unique).length / words.length) * 100 : 50;
    var densityScore = Math.min(100, Math.round(diversity * 0.4 + (memoryScore + educationScore > 30 ? 40 : 15)));

    var normAdult = Math.min(100, adultScore);
    var normMem = Math.min(100, memoryScore);
    var normEdu = Math.min(100, educationScore);
    var normSelf = Math.min(100, selfImprovementScore);
    var normEnt = Math.min(100, entertainmentScore);

    var category = "unknown";
    var confidence = 50;
    var recommendedAction = "allow";
    var explanation = "Not enough signals for a confident category.";

    if (normAdult >= 50) {
      category = "adult_18plus";
      confidence = Math.min(99, normAdult);
      recommendedAction = "hard_block";
      explanation = "Explicit or 18+ adult material. Hard blocked.";
    } else if (normMem >= 45 && normMem >= normEnt) {
      category = "memory_cognitive";
      confidence = Math.min(98, Math.max(70, normMem));
      recommendedAction = "allow";
      explanation = "Memory or cognitive-training material.";
    } else if (normEdu >= 45 && normEdu >= normEnt) {
      category = "education";
      confidence = Math.min(98, Math.max(70, normEdu));
      recommendedAction = "allow";
      explanation = "Educational lecture, tutorial, or academic material.";
    } else if (normSelf >= 45 && normSelf >= normEnt) {
      category = "self_improvement";
      confidence = Math.min(98, Math.max(70, normSelf));
      recommendedAction = "allow";
      explanation = "Habit, focus, or discipline material.";
    } else if (normEnt >= 35) {
      category = "entertainment";
      confidence = Math.min(95, Math.max(65, normEnt));
      recommendedAction = isShortForm ? "hard_block" : "swap_learning";
      explanation = isShortForm
        ? "Short-form dopamine loop detected."
        : "Entertainment or distraction content detected.";
    } else if (normEdu > 20 || normMem > 20) {
      category = "education";
      confidence = 62;
      recommendedAction = "allow";
      explanation = "Mild educational signal.";
    }

    if (!signals.length) signals.push("General baseline analysis");

    return {
      category: category,
      confidence: confidence,
      scores: {
        adult_18plus: normAdult,
        entertainment: normEnt,
        education: normEdu,
        memory_cognitive: normMem,
        self_improvement: normSelf
      },
      recommendedAction: recommendedAction,
      signalsDetected: signals.slice(0, 8),
      explanation: explanation,
      isShortForm: isShortForm,
      densityScore: densityScore
    };
  }

  function isUseful(category) {
    return category === "education" || category === "memory_cognitive" || category === "self_improvement";
  }

  /* Pure decision helper used by the YouTube page script and tests.
     Adult is always hard-blocked. Smart filter can be turned off for
     entertainment/unknown, but never for 18+. */
  function verdict(result, settings) {
    settings = settings || {};
    if (result && result.category === "adult_18plus") {
      return { hide: true, hard: true, reason: "adult" };
    }
    if (!result || settings.smartFilter === false) {
      return { hide: false, hard: false, reason: "classifier-off" };
    }
    var mode = settings.mode || "strict";
    if (mode === "off") return { hide: false, hard: false, reason: "mode-off" };
    if (result.category === "entertainment") {
      return { hide: true, hard: false, reason: "classifier-entertainment" };
    }
    if (mode === "strict" && result.category === "unknown") {
      return { hide: true, hard: false, reason: "classifier-not-useful" };
    }
    return { hide: false, hard: false, reason: "classifier-useful" };
  }

  var api = {
    ADULT_DOMAINS: ADULT_DOMAINS,
    classify: classify,
    isUseful: isUseful,
    verdict: verdict,
    extractDomain: extractDomain
  };
  root.ContentClassifier = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : self);
