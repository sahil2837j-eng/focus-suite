/* =====================================================================
   Focus Tracker 2.0 — "No Loopholes" · background service worker

   POLICY (v2.0, breaking by design)
   - Every automatic block (nightly detox + 40/20 YouTube guard) lasts
     EXACTLY 24 hours from the moment it fires. Rolling, not calendar.
   - There is NO Sunday exemption. The schema key, the rule branch and
     the UI toggles are deleted. Rules apply 7/7.
   - There is NO message, button or API that can lift an armed block
     early. Removal exists only for rules you authored (custom guards).
   - Every automatic firing snapshots its inputs into blockLog.

   Everything runs locally. The only optional network path is the
   numbers-only AI review you enable with your own keys.
===================================================================== */
"use strict";

/* Focus Suite: the shared YouTube keyword brain (defaults + pure engine).
   The same two files run in the content script, popup, options page and here. */
try { importScripts("yt-defaults.js", "yt-engine.js"); } catch (e) { /* tracker still works without it */ }

/* ----------------------------- constants ----------------------------- */
const DAY_MS = 24 * 60 * 60 * 1000;
const BLOCK_MS = DAY_MS; // the one and only automatic block term
const POLICY_VERSION = "2.0"; // block policy: 24h, 7/7, no lift — carried unchanged into the Suite
const SUITE_VERSION = "3.0.0";
const SHIELD_DAYS = 14;
const FLUSH_MS = 30 * 1000;
const MAX_GAP_MS = 3 * 60 * 1000; // gaps longer than this are sleep/lock: discarded
const IDLE_SECONDS = 60;
const STATS_DAYS = 90;
const REVIEW_DAYS = 14;
const MEDIA_DAYS = 7;
const BLOCKLOG_MAX = 25;
const MAX_BLOCKLIST = 50;
const MAX_CHANNELS = 200;
const MAX_PATH_RULES = 50;
const DETOX_MIN_MINUTES = 30;
const YT_ENT_LIMIT_MIN = 40;
const YT_SHORTS_LIMIT_MIN = 20;
const GOAL_WINDOW = [17, 18, 19]; // 17:00–19:59 productive goal
const GOAL_TARGET_MIN = 120;
const AI_TIMEOUT_MS = 45 * 1000;
const AI_MAX_ATTEMPTS = 3;

/* Rule id ranges for declarativeNetRequest dynamic rules */
const RID = { site: 1000, detox: 2000, youtube: 7000, channel: 10000 };

const NEVER_DETOX = new Set([
  "github.com", "gitlab.com", "stackoverflow.com", "developer.mozilla.org",
  "w3schools.com", "coursera.org", "wikipedia.org", "en.wikipedia.org",
  "gmail.com", "mail.google.com", "drive.google.com", "docs.google.com",
  "discord.com", "zoom.us", "localhost", "127.0.0.1", "youtube.com",
  "www.youtube.com", "m.youtube.com", "music.youtube.com",
  "google.com", "www.google.com", "chatgpt.com", "claude.ai",
  "notion.so", "figma.com", "codepen.io", "codesandbox.io", "replit.com",
  "theodinproject.com", "freecodecamp.org", "khanacademy.org", "udemy.com",
  "linkedin.com", "calendar.google.com", "meet.google.com"
]);

const KNOWN_WASTE = new Set([
  "reddit.com", "www.reddit.com", "old.reddit.com", "x.com", "twitter.com",
  "instagram.com", "www.instagram.com", "facebook.com", "www.facebook.com",
  "tiktok.com", "www.tiktok.com", "twitch.tv", "www.twitch.tv",
  "novelphoenix.com", "webnovel.com", "wuxiaworld.com", "royalroad.com",
  "9gag.com", "imgur.com", "pinterest.com", "snapchat.com", "threads.net",
  "netflix.com", "hulu.com", "primevideo.com", "disneyplus.com"
]);

const PASSIVE_WORDS = [
  "how to focus", "motivation", "motivational", "productivity", "adhd",
  "deep work", "procrastinat", "discipline", "self improvement",
  "self-improvement", "morning routine", "stop wasting", "dopamine detox",
  "study tips", "focus tips", "mindset", "habits", "atomic habits",
  "how to study", "how to be productive", "how to stop", "willpower",
  "consistency", "get your life together", "lazy", "grindset"
];

const ENTERTAINMENT_WORDS = [
  "funny", "prank", "reaction", "reacts", "vlog", "gaming", "gameplay",
  "minecraft", "fortnite", "gta", "movie", "trailer", "ufc", "mma",
  "highlights", "meme", "memes", "comedy", "stand up", "stand-up",
  "challenge", "tiktok", "vs ", "versus", "official video", "music video",
  "lyric", "lyrics", "album", "live stream", "livestream", "stream",
  "unboxing", "haul", "mukbang", "asmr", "podcast highlights"
];

const EDU_WORDS = [
  "tutorial", "course", "lesson", "lecture", "documentation", "docs",
  "python", "javascript", "typescript", "react", "node", "css", "html",
  "coding", "programming", "explained", "how to build", "crash course",
  "full course", "masterclass", "tutorial for beginners", "learn ",
  "introduction to", "fundamentals", "deep dive", "walkthrough",
  "math", "physics", "chemistry", "biology", "history of", "science"
];

const AI_PROVIDERS = {
  openai:    { name: "ChatGPT (OpenAI)", endpoint: "https://api.openai.com/v1/chat/completions", model: "gpt-4o-mini", kind: "openai" },
  anthropic: { name: "Claude (Anthropic)", endpoint: "https://api.anthropic.com/v1/messages", model: "claude-3-5-haiku-latest", kind: "anthropic" },
  deepseek:  { name: "DeepSeek", endpoint: "https://api.deepseek.com/v1/chat/completions", model: "deepseek-chat", kind: "openai" },
  qwen:      { name: "Qwen (DashScope)", endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", model: "qwen-plus", kind: "openai" },
  custom:    { name: "Custom (OpenAI-compatible)", endpoint: "", model: "", kind: "openai" }
};

/* ----------------------------- storage ----------------------------- */
const sget = (keys) => chrome.storage.local.get(keys);
const sset = (obj) => chrome.storage.local.set(obj);
const ssGet = (keys) => chrome.storage.session.get(keys);
const ssSet = (obj) => chrome.storage.session.set(obj);

async function getAll() {
  return sget([
    "stats", "reviews", "media", "channelVerdicts", "blocklist",
    "blockedChannels", "pathRules", "prod", "hours", "studyHabit",
    "aiSettings", "digestPending", "blockLog", "trackingEnabled",
    "digestEnabled", "detox", "ytBlock", "lastSeenAt", "policyVersion",
    "seededRulesV1", "theaterNudge", "detoxAppliedFor"
  ]);
}

/* ------------------------------- time ------------------------------ */
function pad(n) { return String(n).padStart(2, "0"); }
function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function todayKey() { return dayKey(Date.now()); }
function parseDay(key) { const [y, m, d] = key.split("-").map(Number); return new Date(y, m - 1, d); }
function addDaysKey(key, n) { const d = parseDay(key); d.setDate(d.getDate() + n); return dayKey(d.getTime()); }
function mondayKey(key) {
  const d = parseDay(key);
  const shift = (d.getDay() + 6) % 7; // Mon=0
  d.setDate(d.getDate() - shift);
  return dayKey(d.getTime());
}
function minuteOfDay(ts) { const d = new Date(ts); return d.getHours() * 60 + d.getMinutes(); }
function fmtMin(sec) {
  const m = Math.round(sec / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h${pad(m % 60)}`;
}
function median(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

/* Clock guard: expiry checks use the largest timestamp ever observed,
   so turning the system clock BACK can never lengthen or confuse a
   term, and a term is only ever shortened by real elapsed time. */
let lastSeenAt = 0;
function effNow() { return Math.max(Date.now(), lastSeenAt); }
async function touchClock() {
  const now = Date.now();
  if (now > lastSeenAt) { lastSeenAt = now; await sset({ lastSeenAt: now }); }
}

/* --------------------------- notifications -------------------------- */
function notify(id, title, message) {
  try {
    chrome.notifications.create(id || `ft-${Date.now()}`, {
      type: "basic",
      iconUrl: "icons/icon128.png",
      title,
      message
    }, () => void chrome.runtime.lastError);
  } catch (e) { /* notifications are best-effort */ }
}

/* --------------------------- domain utils --------------------------- */
function domainOf(url) {
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return null;
    return u.hostname.replace(/^www\./, "");
  } catch (e) { return null; }
}
function cleanDomainInput(raw) {
  return String(raw || "")
    .trim().toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0].split("?")[0].split("#")[0].trim();
}
function isValidDomain(d) { return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d) || d === "localhost"; }

/* Path rules: pattern "domain[/path]" where * matches anything.
   Matched against host+path, www ignored, query only if pattern has "?".
   Longest matching pattern wins. */
function matchPathRule(url, rules) {
  let hostPath;
  try {
    const u = new URL(url);
    hostPath = u.hostname.replace(/^www\./, "") + (u.pathname === "/" ? "" : u.pathname);
    if (u.search) hostPath += u.search;
  } catch (e) { return null; }
  let best = null;
  for (const rule of rules || []) {
    const p = String(rule.pattern || "").replace(/^www\./, "");
    if (!p) continue;
    const hasQueryPattern = p.includes("?");
    const target = hasQueryPattern ? hostPath : hostPath.split("?")[0];
    const rx = new RegExp("^" + p.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$");
    if (rx.test(target) && (!best || p.length > best.pattern.length)) best = rule;
  }
  return best;
}
function kindForUrl(url, rules) {
  const r = matchPathRule(url, rules);
  if (r) return r.kind;
  const d = domainOf(url);
  if (!d) return "neutral";
  if (NEVER_DETOX.has(d)) return "productive";
  if (KNOWN_WASTE.has(d)) return "waste";
  return "neutral";
}
function isUselessForDetox(domain, rules) {
  if (NEVER_DETOX.has(domain)) return false;
  const kind = kindForUrl(`https://${domain}/`, rules);
  return kind === "waste";
}

/* --------------------------- defaults/seed -------------------------- */
async function ensureDefaults() {
  const s = await sget(["blocklist", "pathRules", "seededRulesV1", "trackingEnabled",
    "blockedChannels", "channelVerdicts", "studyHabit", "aiSettings", "digestEnabled"]);
  const patch = {};
  if (!Array.isArray(s.blocklist)) {
    patch.blocklist = [{ domain: "novelphoenix.com", kind: "built-in", addedAt: Date.now() }];
  }
  if (!Array.isArray(s.blockedChannels)) patch.blockedChannels = [];
  if (!s.channelVerdicts) patch.channelVerdicts = {};
  if (typeof s.trackingEnabled !== "boolean") patch.trackingEnabled = true;
  if (typeof s.digestEnabled !== "boolean") patch.digestEnabled = false;
  if (!s.studyHabit) {
    patch.studyHabit = { enabled: false, completions: [], streak: 0, lastDone: null, missed: 0, level: 0, lastNudgeDate: null };
  }
  if (!s.aiSettings) {
    patch.aiSettings = {
      enabled: false, active: {}, keys: {}, models: {}, customEndpoint: "",
      folder: "focus-reports", autoSave: false, scrub: "immediate"
    };
  }
  if (!s.seededRulesV1) {
    const existing = Array.isArray(s.pathRules) ? s.pathRules : [];
    const seeds = [
      { pattern: "theodinproject.com/lessons/*", kind: "productive", seeded: true },
      { pattern: "developer.mozilla.org/*", kind: "productive", seeded: true }
    ];
    patch.pathRules = [...existing, ...seeds.filter(sd => !existing.some(r => r.pattern === sd.pattern))];
    patch.seededRulesV1 = true; // delete them and they stay deleted
  } else if (!Array.isArray(s.pathRules)) {
    patch.pathRules = [];
  }
  if (Object.keys(patch).length) await sset(patch);
}

/* ------------------------- migration to 2.0 ------------------------- */
/* Deletes the Sunday schema, clamps legacy 48h blocks to a 24h term
   measured from their original firing time, keeps everything else. */
async function migrate() {
  const s = await getAll();
  const patch = {};
  let changed = false;

  if (Array.isArray(s.blocklist)) {
    const cleaned = s.blocklist.map((b) => {
      if (b && "sundayAllowed" in b) {
        changed = true;
        const { sundayAllowed, ...rest } = b; // exemption purged, not converted
        return rest;
      }
      return b;
    });
    if (changed) patch.blocklist = cleaned;
  }

  const clampTerm = (term) => {
    if (!term || typeof term !== "object") return term;
    const armedAt = term.armedAt || term.startsAt || null;
    let endsAt = term.endsAt || null;
    if (!endsAt && term.lastDay) endsAt = parseDay(term.lastDay).getTime() + DAY_MS; // legacy shape
    if (armedAt && endsAt && endsAt - armedAt > BLOCK_MS) {
      changed = true;
      return { ...term, armedAt, endsAt: armedAt + BLOCK_MS };
    }
    if (!armedAt && endsAt) { changed = true; return { ...term, armedAt: endsAt - BLOCK_MS, endsAt }; }
    return term;
  };

  if (s.detox && typeof s.detox === "object") {
    const next = {};
    for (const [domain, term] of Object.entries(s.detox)) next[domain] = clampTerm(term);
    patch.detox = next;
  }
  if (s.ytBlock) patch.ytBlock = clampTerm(s.ytBlock);

  if (s.policyVersion !== POLICY_VERSION) { patch.policyVersion = POLICY_VERSION; changed = true; }
  if (changed || Object.keys(patch).length) await sset(patch);

  // scrub any stray legacy keys from older builds
  await chrome.storage.local.remove(["sundayAllowed", "sundayUnlock", "sundayCountdown"]);
}

/* ------------------------------ tracking ---------------------------- */
async function getCurrent() {
  const { cur } = await ssGet(["cur"]);
  return cur || null;
}
async function setCurrent(cur) { await ssSet({ cur }); }

async function activeTabInfo() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (!tab || !tab.url) return null;
    const domain = domainOf(tab.url);
    if (!domain) return null;
    return { domain, url: tab.url, title: tab.title || "", tabId: tab.id };
  } catch (e) { return null; }
}

async function switchCurrent(next) {
  await flush();
  if (next) await setCurrent({ ...next, since: Date.now() });
  else await setCurrent(null);
  await updateBadge(next ? next.domain : null);
}

async function flush() {
  const cur = await getCurrent();
  if (!cur) return;
  const now = Date.now();
  const elapsed = now - (cur.since || now);
  cur.since = now;
  await setCurrent(cur);

  const s = await sget(["trackingEnabled", "stats", "hours", "prod", "pathRules", "studyHabit"]);
  if (s.trackingEnabled === false) return;
  if (elapsed <= 0 || elapsed > MAX_GAP_MS) return; // sleep/lock gap: discarded

  const idleState = await chrome.idle.queryState(IDLE_SECONDS).catch(() => "active");
  if (idleState !== "active") return;

  const secs = Math.round(elapsed / 1000);
  if (secs <= 0) return;
  const date = dayKey(now);
  const mins = secs / 60;

  const stats = s.stats || {};
  stats[date] = stats[date] || {};
  stats[date][cur.domain] = (stats[date][cur.domain] || 0) + secs;
  // keep last 90 days
  const cutoff = addDaysKey(date, -STATS_DAYS);
  for (const k of Object.keys(stats)) if (k < cutoff) delete stats[k];

  const hours = s.hours && s.hours.week === mondayKey(date) ? s.hours : { week: mondayKey(date), days: {} };
  hours.days[date] = hours.days[date] || new Array(24).fill(0);
  hours.days[date][new Date(now).getHours()] += mins;

  const prod = s.prod && s.prod.week === mondayKey(date) ? s.prod : { week: mondayKey(date), goal: {}, total: {} };
  const kind = kindForUrl(cur.url, s.pathRules || []);
  let crossedCompletion = false;
  if (kind === "productive") {
    const prevTotal = prod.total[date] || 0;
    prod.total[date] = prevTotal + mins;
    if (GOAL_WINDOW.includes(new Date(now).getHours())) {
      prod.goal[date] = (prod.goal[date] || 0) + mins;
    }
    if (prevTotal < 10 && prod.total[date] >= 10) crossedCompletion = true;
  }

  await sset({ stats, hours, prod });
  if (crossedCompletion) await recordCompletion("auto");
  await updateBadge(cur.domain);
}

async function isDomainLocked(domain) {
  if (!domain) return false;
  const s = await sget(["blocklist", "detox", "ytBlock"]);
  const now = effNow();
  if ((s.blocklist || []).some((b) => b.domain === domain)) return true;
  if (s.detox && s.detox[domain] && s.detox[domain].endsAt > now) return true;
  if (domain.endsWith("youtube.com") && s.ytBlock && s.ytBlock.endsAt > now) return true;
  return false;
}

async function updateBadge(domain) {
  try {
    if (!domain) { await chrome.action.setBadgeText({ text: "" }); return; }
    const s = await sget(["stats"]);
    const today = (s.stats || {})[todayKey()] || {};
    const secs = today[domain] || 0;
    await chrome.action.setBadgeText({ text: secs >= 60 ? fmtMin(secs) : "" });
    const locked = await isDomainLocked(domain);
    await chrome.action.setBadgeBackgroundColor({ color: locked ? "#f43f5e" : "#4f46e5" });
  } catch (e) { /* badge is best-effort */ }
}

/* --------------------------- block rules ---------------------------- */
function siteBlockRule(id, domain) {
  return {
    id,
    priority: 1,
    action: { type: "block" },
    condition: {
      urlFilter: `||${domain}^`,
      resourceTypes: ["main_frame", "sub_frame", "xmlhttprequest", "other"]
    }
  };
}

async function cleanupExpired() {
  const s = await sget(["detox", "ytBlock"]);
  const now = effNow();
  const patch = {};
  if (s.detox) {
    const next = {};
    let changed = false;
    for (const [d, term] of Object.entries(s.detox)) {
      if (term && term.endsAt > now) next[d] = term; else changed = true;
    }
    if (changed) patch.detox = next;
  }
  if (s.ytBlock && s.ytBlock.endsAt <= now) patch.ytBlock = null;
  if (Object.keys(patch).length) await sset(patch);
  return patch;
}

/* Rebuilds ALL dynamic rules from storage. Note what is absent:
   there is no day-of-week branch anywhere. 7/7, always.
   Passes are serialized: two callers can never run overlapping
   updateDynamicRules calls (Chromium rejects an update whose ids
   collide with rules the other pass has not removed yet). */
let rulesQueue = Promise.resolve();
function syncRules() {
  const pass = rulesQueue.then(syncRulesNow);
  rulesQueue = pass.catch(() => {}); // a failed pass must not wedge the queue
  return pass;
}
async function syncRulesNow() {
  await cleanupExpired();
  const s = await sget(["blocklist", "detox", "ytBlock", "blockedChannels"]);
  const now = effNow();
  const rules = [];

  (s.blocklist || []).slice(0, MAX_BLOCKLIST).forEach((b, i) => {
    if (b && b.domain) rules.push(siteBlockRule(RID.site + i, b.domain));
  });

  Object.keys(s.detox || {})
    .filter((d) => s.detox[d] && s.detox[d].endsAt > now)
    .forEach((d, i) => rules.push(siteBlockRule(RID.detox + i, d)));

  if (s.ytBlock && s.ytBlock.endsAt > now) {
    rules.push({
      id: RID.youtube,
      priority: 1,
      action: { type: "block" },
      condition: {
        regexFilter: "^https://(www\\.|m\\.|music\\.)youtube\\.com/",
        resourceTypes: ["main_frame", "sub_frame", "xmlhttprequest", "other"]
      }
    });
  }

  (s.blockedChannels || []).slice(0, MAX_CHANNELS).forEach((c, i) => {
    const handle = String((c && c.handle) || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (!handle) return;
    rules.push({
      id: RID.channel + i,
      priority: 1,
      action: { type: "block" },
      condition: {
        regexFilter: `^https://(www\\.|m\\.)youtube\\.com/${handle}(?:[/?#]|$)`,
        resourceTypes: ["main_frame"]
      }
    });
  });

  const existing = await chrome.declarativeNetRequest.getDynamicRules();
  // Remove first, then add: re-adding a rule ID in the same call where it's
  // removed can be rejected by Chromium ("does not have a unique ID").
  if (existing.length) {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: existing.map((r) => r.id)
    });
  }
  if (rules.length) {
    await chrome.declarativeNetRequest.updateDynamicRules({ addRules: rules });
  }
}

async function pushBlockLog(entry) {
  const s = await sget(["blockLog"]);
  const log = [{ ...entry, at: effNow(), policy: POLICY_VERSION }, ...(s.blockLog || [])].slice(0, BLOCKLOG_MAX);
  await sset({ blockLog: log });
}

/* ------------------------------ reviews ----------------------------- */
function summarizeDay(dayStats) {
  const entries = Object.entries(dayStats || {})
    .map(([domain, secs]) => ({ domain, minutes: Math.round(secs / 60) }))
    .filter((e) => e.minutes >= 1)
    .sort((a, b) => b.minutes - a.minutes);
  const total = entries.reduce((a, e) => a + e.minutes, 0);
  return { entries, total, top5: entries.slice(0, 5) };
}

function computeDetoxCandidates(dayStats, rules) {
  const { entries } = summarizeDay(dayStats);
  return entries.slice(0, 3).filter(
    (e) => e.minutes >= DETOX_MIN_MINUTES && isUselessForDetox(e.domain, rules)
  );
}

function computePreview(dayStats, rules, detoxState) {
  const candidates = computeDetoxCandidates(dayStats, rules);
  const active = Object.keys(detoxState || {}).filter((d) => detoxState[d].endsAt > effNow());
  if (!candidates.length) {
    return "At midnight: nothing crosses the bar. No detox would be armed (needs a top-3 time sink with 30+ focused minutes).";
  }
  const names = candidates.map((c) => `${c.domain} (${c.minutes}m)`).join(", ");
  if (active.length) {
    return `At midnight: ${names} would qualify, but a detox is already running (${active.join(", ")}). Terms stay at 24 hours.`;
  }
  return `Blocked at midnight for 24 hours: ${names} — each was a top-3 time sink with 30+ focused minutes.`;
}

async function armDetox(candidates, reviewDate) {
  if (!candidates.length) return [];
  const s = await sget(["detox"]);
  const detox = s.detox || {};
  const now = effNow();
  const armed = [];
  for (const c of candidates) {
    if (detox[c.domain] && detox[c.domain].endsAt > now) continue;
    detox[c.domain] = {
      armedAt: now,
      endsAt: now + BLOCK_MS,
      reason: `Top-3 time sink · ${c.minutes} focused min on ${reviewDate}`,
      minutes: c.minutes,
      reviewDate
    };
    armed.push(c.domain);
    await pushBlockLog({
      kind: "detox", target: c.domain, durationMs: BLOCK_MS, locked: true,
      reason: detox[c.domain].reason,
      inputs: { focusedMinutes: c.minutes, thresholdMinutes: DETOX_MIN_MINUTES, reviewDate }
    });
  }
  if (armed.length) {
    await sset({ detox });
    await syncRules();
    notify("ft-detox", "Focus Tracker · 24h detox armed",
      `${armed.join(", ")} blocked for exactly 24 hours. The clock is the only unlock.`);
  }
  return armed;
}

/* Reviews every closed day with >= 1 focused minute. Catch-up safe:
   days are never lost if the machine was off at midnight. */
async function ensureReviews() {
  const s = await sget(["stats", "reviews", "pathRules", "detox", "detoxAppliedFor", "digestEnabled"]);
  const stats = s.stats || {};
  const reviews = s.reviews || {};
  const today = todayKey();
  const closedDays = Object.keys(stats).filter((d) => d < today).sort();
  let newest = null;

  for (const date of closedDays) {
    if (reviews[date]) { newest = date; continue; }
    const { entries, total, top5 } = summarizeDay(stats[date]);
    if (total < 1) continue;
    const waster = entries.find((e) => isUselessForDetox(e.domain, s.pathRules || [])) || null;
    reviews[date] = {
      date, totalMinutes: total, top5,
      waster: waster ? waster.domain : null,
      wasterMinutes: waster ? waster.minutes : 0,
      candidates: computeDetoxCandidates(stats[date], s.pathRules || []).map((c) => c.domain),
      preview: computePreview(stats[date], s.pathRules || [], s.detox || {}),
      ai: [], aiAttempts: 0, createdAt: effNow()
    };
    newest = date;
  }

  // keep 14 days of reviews
  const keepFrom = addDaysKey(today, -REVIEW_DAYS);
  for (const k of Object.keys(reviews)) if (k < keepFrom) delete reviews[k];
  await sset({ reviews });

  // Detox is armed once, from the newest review only.
  if (newest && reviews[newest] && s.detoxAppliedFor !== newest) {
    const candidates = computeDetoxCandidates(stats[newest], s.pathRules || []);
    await armDetox(candidates, newest);
    await sset({ detoxAppliedFor: newest });

    if (s.digestEnabled) {
      await sset({ digestPending: { date: newest, armedAt: effNow() } });
      await scheduleDigest();
    }
    // optional AI round for the closed day
    const ai = (await sget(["aiSettings"])).aiSettings;
    if (ai && ai.enabled) { runAiRound(newest).catch(() => {}); }
  }
  return reviews;
}

/* --------------------------- morning digest -------------------------- */
async function scheduleDigest() {
  const next8 = new Date();
  next8.setHours(8, 0, 0, 0);
  if (next8.getTime() <= Date.now()) next8.setDate(next8.getDate() + 1);
  await chrome.alarms.create("digest", { when: next8.getTime() });
}
async function fireDigest() {
  const s = await sget(["digestPending", "reviews", "detox"]);
  const p = s.digestPending;
  if (!p) return;
  await sset({ digestPending: null });
  if (effNow() - (p.armedAt || 0) > 36 * 60 * 60 * 1000) return; // stale: stay silent
  const r = (s.reviews || {})[p.date];
  if (!r) return;
  const active = Object.keys(s.detox || {}).filter((d) => s.detox[d].endsAt > effNow());
  notify("ft-digest", "Yesterday, in one line",
    `${r.totalMinutes}m focused · top sink ${r.top5[0] ? r.top5[0].domain : "—"}` +
    (active.length ? ` · 24h detox: ${active.join(", ")}` : "") + ` · ${r.preview}`);
}

/* ------------------------------ YouTube ------------------------------ */

/* The shared keyword brain. The SAME Allowed / Good / Blocked lists that
   decide what is hidden on the page also decide how the tracker counts
   what you actually watched. Compiled once, refreshed on any list change. */
let ytfCompiled = null;
function compileYtf(stored) {
  const D = self.FOCUS_DEFAULTS, E = self.FocusEngine;
  if (!D || !E) return null;
  const s = stored || {};
  return E.compile({
    allowed: s.ytfAllowed || D.allowed,
    good: s.ytfGood || D.good,
    blocked: s.ytfBlocked || D.blocked
  });
}
ytfCompiled = compileYtf(null); // defaults are live immediately, even before storage answers
async function loadYtf() {
  try { ytfCompiled = compileYtf(await chrome.storage.sync.get(["ytfAllowed", "ytfGood", "ytfBlocked"])); }
  catch (e) { /* keep the last good compile */ }
}

function classifyVideo(title, channel, isShorts, verdicts) {
  const key = String(channel || "").toLowerCase();
  if (verdicts && verdicts[key] === "useful") return "edu";
  if (verdicts && verdicts[key] === "useless") return "waste";
  if (isShorts) return "shorts"; // Shorts are always waste
  const t = String(title || "").toLowerCase();
  if (PASSIVE_WORDS.some((w) => t.includes(w))) return "passive"; // checked BEFORE educational
  const kw = ytfCompiled
    ? self.FocusEngine.classifyText(`${t} ${key}`, ytfCompiled)
    : { allowed: false, good: false, blocked: false };
  if (kw.allowed) return "other"; // Allowed always wins — same rule as on the page
  if (kw.blocked) return "waste";
  if (ENTERTAINMENT_WORDS.some((w) => t.includes(w))) return "waste";
  if (EDU_WORDS.some((w) => t.includes(w)) || kw.good) return "edu";
  return "other";
}

/* "Shielded today": what YouTube Focus hid or blocked for you, reported by
   the content script in small batches. Pure counters — no titles, no URLs. */
async function recordShield(hidden, shorts) {
  const h = Math.max(0, Math.min(500, Math.round(hidden || 0)));
  const sh = Math.max(0, Math.min(500, Math.round(shorts || 0)));
  if (!h && !sh) return;
  const s = await sget(["shield"]);
  const shield = s.shield || {};
  const date = todayKey();
  shield[date] = shield[date] || { hidden: 0, shorts: 0 };
  shield[date].hidden += h;
  shield[date].shorts += sh;
  const keepFrom = addDaysKey(date, -SHIELD_DAYS);
  for (const k of Object.keys(shield)) if (k < keepFrom) delete shield[k];
  await sset({ shield });
}

function mediaBuckets(dayMedia, verdicts) {
  const buckets = { edu: 0, waste: 0, shorts: 0, passive: 0, other: 0 };
  const videos = Object.values((dayMedia && dayMedia.videos) || {});
  for (const v of videos) {
    const kind = classifyVideo(v.title, v.channel, v.isShorts, verdicts);
    buckets[kind] += v.seconds || 0;
  }
  return buckets;
}

async function armYoutubeBlock(buckets, date) {
  const s = await sget(["ytBlock", "media"]);
  if (s.ytBlock && s.ytBlock.endsAt > effNow()) return false; // can arm, never lift
  const now = effNow();
  const lastVideos = Object.values(((s.media || {})[date] || {}).videos || {})
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, 6)
    .map((v) => ({ title: v.title, channel: v.channel, seconds: v.seconds }));
  const ytBlock = {
    armedAt: now, endsAt: now + BLOCK_MS,
    reason: `Entertainment ${Math.round(buckets.waste / 60)}m / ${YT_ENT_LIMIT_MIN}m · Shorts ${Math.round(buckets.shorts / 60)}m / ${YT_SHORTS_LIMIT_MIN}m`
  };
  await sset({ ytBlock });
  await pushBlockLog({
    kind: "youtube-40-20", target: "youtube.com", durationMs: BLOCK_MS, locked: true,
    reason: ytBlock.reason,
    inputs: { bucketsSec: buckets, limitsMin: { entertainment: YT_ENT_LIMIT_MIN, shorts: YT_SHORTS_LIMIT_MIN }, lastVideos }
  });
  await syncRules();
  notify("ft-yt", "YouTube blocked for 24 hours", ytBlock.reason + " · No skip. The clock decides.");
  try {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab && tab.id) chrome.tabs.sendMessage(tab.id, { type: "yt-blocked", endsAt: ytBlock.endsAt }, () => void chrome.runtime.lastError);
  } catch (e) { /* toast is best-effort */ }
  return true;
}

async function checkYoutubeThresholds(date) {
  const s = await sget(["media", "channelVerdicts", "prod", "theaterNudge"]);
  const buckets = mediaBuckets((s.media || {})[date], s.channelVerdicts || {});
  if (buckets.waste >= YT_ENT_LIMIT_MIN * 60 || buckets.shorts >= YT_SHORTS_LIMIT_MIN * 60) {
    await armYoutubeBlock(buckets, date);
  }
  // Learning-theater nudge: lots of input, almost no practice.
  const prodTotal = ((s.prod || {}).total || {})[date] || 0;
  if (buckets.edu + buckets.passive >= 30 * 60 && prodTotal < 5 && s.theaterNudge !== date) {
    await sset({ theaterNudge: date });
    notify("ft-theater", "Build one small thing for 15 minutes",
      "30+ minutes of learning videos, under 5 of practice. That build is the real lesson.");
  }
  return buckets;
}

async function handleMediaReport(msg) {
  if (!msg || !msg.playing) return; // playback honesty: paused/ended/background never accrues
  const s = await sget(["trackingEnabled", "media"]);
  if (s.trackingEnabled === false) return;
  const date = todayKey();
  const media = s.media || {};
  media[date] = media[date] || { videos: {} };
  const key = `${msg.title || ""}::${msg.channel || ""}`;
  const prev = media[date].videos[key] || {
    title: msg.title || "(untitled)", channel: msg.channel || "", isShorts: !!msg.isShorts,
    seconds: 0, firstAt: effNow()
  };
  prev.seconds += Math.min(30, Math.max(1, msg.seconds || 15));
  prev.updatedAt = effNow();
  prev.isShorts = !!msg.isShorts;
  media[date].videos[key] = prev;
  const keepFrom = addDaysKey(date, -MEDIA_DAYS);
  for (const k of Object.keys(media)) if (k < keepFrom) delete media[k];
  await sset({ media });
  await checkYoutubeThresholds(date);
}

/* --------------------------- study reminder -------------------------- */
const REMINDER_TONES = [
  (d) => `Gentle nudge: ${d}. Ten real minutes beats a perfect plan.`,
  (d) => `Study time. ${d} — open the lesson, set a timer, start ugly.`,
  (d) => `Direct: ${d}. The streak will not keep itself.`,
  (d) => `Firm: ${d}. This is the third missed day. Fifteen minutes, now.`,
  (d) => `Firmer: ${d}. Watching a video about focus does not count. Build.`,
  (d) => `Last warning: ${d}. One session today resets everything.`,
  (d) => `Final message (day 7): ${d}. Reminders stop here. Any real session restarts them.`
];

async function armReminder() {
  await chrome.alarms.clear("study-reminder");
  const s = await sget(["studyHabit"]);
  const h = s.studyHabit;
  if (!h || !h.enabled || h.level >= 7) return;
  const targetMin = (h.completions || []).length >= 3
    ? Math.max(0, (median(h.completions) || 17 * 60) - 15)
    : 17 * 60;
  const now = new Date();
  const fire = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, targetMin, 0, 0);
  if (h.lastDone === todayKey() || fire.getTime() <= now.getTime()) fire.setDate(fire.getDate() + 1);
  await chrome.alarms.create("study-reminder", { when: fire.getTime() });
}

async function recordCompletion(source) {
  const s = await sget(["studyHabit"]);
  const h = s.studyHabit || { enabled: false, completions: [], streak: 0, lastDone: null, missed: 0, level: 0 };
  const today = todayKey();
  if (h.lastDone === today) return h;
  h.streak = h.lastDone === addDaysKey(today, -1) ? (h.streak || 0) + 1 : 1;
  h.lastDone = today;
  h.completions = [...(h.completions || []), minuteOfDay(Date.now())].slice(-10);
  h.missed = 0;
  h.level = 0;
  await sset({ studyHabit: h });
  await armReminder();
  return h;
}

async function fireReminder() {
  const s = await sget(["studyHabit"]);
  const h = s.studyHabit;
  if (!h || !h.enabled) return;
  const today = todayKey();
  if (h.lastDone === today) { await armReminder(); return; } // a completed day is never nudged
  const hour = new Date().getHours();
  h.missed = (h.missed || 0) + 1;
  h.level = Math.min(7, (h.level || 0) + 1);
  h.lastNudgeDate = today;
  await sset({ studyHabit: h });
  if (hour < 21) { // silent after 21:00, but the miss still counts
    const tone = REMINDER_TONES[h.level - 1] || REMINDER_TONES[0];
    notify("ft-reminder", "Focus Tracker · study", tone(`streak ${h.streak || 0} · today is not done yet`));
  }
  if (h.level < 7) await armReminder(); // after the final message, only a completion re-arms
}

/* --------------------------------- AI -------------------------------- */
function buildAiPrompt(date, ctx) {
  const top = ctx.top.map((e) => `${e.domain} ${e.minutes}m`).join(", ");
  const yt = ctx.ytBuckets;
  const hourly = ctx.hourly.map((m, h) => (m >= 1 ? `${pad(h)}:${Math.round(m)}` : null)).filter(Boolean).join(" ");
  return [
    "You are a terse, kind focus coach. Numbers only were shared with you; no titles or URLs exist.",
    `Day ${date}: total focused ${ctx.total} minutes.`,
    `Top domains by minutes: ${top || "none"}.`,
    `Biggest time sink: ${ctx.waster || "none"}.`,
    `YouTube split (minutes): educational ${Math.round(yt.edu / 60)}, passive self-help ${Math.round(yt.passive / 60)}, entertainment ${Math.round(yt.waste / 60)}, shorts ${Math.round(yt.shorts / 60)}, browsing ${Math.round(yt.other / 60)}.`,
    `Productive minutes in the 17:00-19:59 study window: ${Math.round(ctx.goalMinutes)} of ${GOAL_TARGET_MIN} target.`,
    `Armed blocks: ${ctx.armed.join(", ") || "none"}. Every automatic block lasts exactly 24 hours and cannot be lifted early.`,
    `Hourly focused minutes: ${hourly || "none"}.`,
    "Reply with: 1) one honest observation, 2) the single highest-leverage change for tomorrow, 3) one sentence of proportionate encouragement. Max 110 words. No guilt, no hustle clichés."
  ].join("\n");
}

async function fetchWithTimeout(url, options) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), AI_TIMEOUT_MS);
  try { return await fetch(url, { ...options, signal: ctrl.signal }); }
  finally { clearTimeout(t); }
}

async function callProvider(id, settings, prompt) {
  const def = AI_PROVIDERS[id];
  if (!def) throw new Error(`unknown provider ${id}`);
  const key = (settings.keys || {})[id];
  if (!key) throw new Error("no API key saved");
  const model = (settings.models || {})[id] || def.model;
  const endpoint = id === "custom" ? settings.customEndpoint : def.endpoint;
  if (!endpoint) throw new Error("no endpoint configured");

  if (def.kind === "anthropic") {
    const res = await fetchWithTimeout(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model, max_tokens: 320, messages: [{ role: "user", content: prompt }] })
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return ((data.content || []).map((c) => c.text || "").join("")).trim();
  }
  const res = await fetchWithTimeout(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, max_tokens: 320, messages: [{ role: "user", content: prompt }] })
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return (((data.choices || [])[0] || {}).message || {}).content?.trim() || "";
}

async function aiContext(date) {
  const s = await sget(["stats", "reviews", "media", "channelVerdicts", "prod", "hours", "detox", "ytBlock"]);
  const { entries, total } = summarizeDay((s.stats || {})[date]);
  const review = (s.reviews || {})[date] || {};
  const armed = [
    ...Object.keys(s.detox || {}).filter((d) => s.detox[d].endsAt > effNow()),
    ...(s.ytBlock && s.ytBlock.endsAt > effNow() ? ["youtube.com"] : [])
  ];
  return {
    total, top: entries.slice(0, 6), waster: review.waster || null,
    ytBuckets: mediaBuckets((s.media || {})[date], s.channelVerdicts || {}),
    goalMinutes: ((s.prod || {}).goal || {})[date] || 0,
    hourly: ((s.hours || {}).days || {})[date] || new Array(24).fill(0),
    armed
  };
}

async function runAiRound(date) {
  const s = await sget(["aiSettings", "reviews"]);
  const settings = s.aiSettings;
  if (!settings || !settings.enabled) return { ok: false, error: "Cloud AI review is off." };
  const reviews = s.reviews || {};
  const review = reviews[date] || { date, ai: [], aiAttempts: 0 };
  if ((review.aiAttempts || 0) >= AI_MAX_ATTEMPTS && (review.ai || []).some((a) => a.text)) {
    return { ok: false, error: "Retry limit reached for this day." };
  }
  const enabledIds = Object.keys(AI_PROVIDERS).filter((id) => settings.active && settings.active[id]);
  if (!enabledIds.length) return { ok: false, error: "No provider enabled. Tick one and save its key." };

  const prompt = buildAiPrompt(date, await aiContext(date));
  review.aiAttempts = (review.aiAttempts || 0) + 1;
  let anyText = false;
  for (const id of enabledIds) {
    try {
      const text = await callProvider(id, settings, prompt);
      review.ai = [...(review.ai || []), { provider: AI_PROVIDERS[id].name, text, at: effNow() }];
      if (text) anyText = true;
    } catch (err) {
      review.ai = [...(review.ai || []), { provider: AI_PROVIDERS[id].name, error: String(err && err.message || err), at: effNow() }];
    }
  }
  reviews[date] = review; // commentary lives inside the review: data clears can never erase it
  await sset({ reviews });
  if (anyText) {
    notify("ft-ai", "The AIs commented on your day", "Open Focus Tracker → More to read it.");
    if (settings.autoSave) { try { await saveReportFile(date); } catch (e) { /* report is best-effort */ } }
    await applyScrubPolicy(date);
  }
  return { ok: true, review };
}

async function applyScrubPolicy(closedDate) {
  const s = await sget(["aiSettings", "stats", "media"]);
  const policy = (s.aiSettings || {}).scrub || "immediate";
  if (policy === "manual") return;
  const stats = s.stats || {};
  const media = s.media || {};
  const today = todayKey();
  if (policy === "immediate") {
    if (closedDate < today) { delete stats[closedDate]; delete media[closedDate]; }
  } else if (policy === "days3") {
    const keepFrom = addDaysKey(today, -3);
    for (const k of Object.keys(stats)) if (k < keepFrom) delete stats[k];
    for (const k of Object.keys(media)) if (k < keepFrom) delete media[k];
  }
  await sset({ stats, media });
}

function buildReportMarkdown(date, review, ctx) {
  const lines = [];
  lines.push(`# Focus report — ${date}`);
  lines.push("");
  lines.push(`- Total focused: **${ctx.total} minutes**`);
  lines.push(`- Study window (17:00–19:59): **${Math.round(ctx.goalMinutes)} / ${GOAL_TARGET_MIN} minutes**`);
  lines.push(`- Biggest time sink: **${ctx.waster || "none"}**`);
  lines.push(`- Armed blocks (24h, locked): ${ctx.armed.join(", ") || "none"}`);
  lines.push("");
  lines.push("## Top domains");
  for (const e of ctx.top) lines.push(`- ${e.domain} — ${e.minutes}m`);
  lines.push("");
  lines.push("## YouTube split (minutes)");
  lines.push(`- educational ${Math.round(ctx.ytBuckets.edu / 60)} · passive ${Math.round(ctx.ytBuckets.passive / 60)} · entertainment ${Math.round(ctx.ytBuckets.waste / 60)} · shorts ${Math.round(ctx.ytBuckets.shorts / 60)} · browsing ${Math.round(ctx.ytBuckets.other / 60)}`);
  if (review && review.preview) { lines.push(""); lines.push("## Midnight preview"); lines.push(review.preview); }
  const ai = (review && review.ai || []).filter((a) => a.text);
  if (ai.length) {
    lines.push(""); lines.push("## AI commentary (numbers-only input)");
    for (const a of ai) { lines.push(""); lines.push(`### ${a.provider}`); lines.push(a.text); }
  }
  lines.push("");
  lines.push(`_Generated locally by Focus Tracker ${POLICY_VERSION} · policy: 24h locked blocks, 7/7, no early lift._`);
  return lines.join("\n");
}

async function saveReportFile(date) {
  const s = await sget(["aiSettings", "reviews"]);
  const folder = ((s.aiSettings || {}).folder || "focus-reports").replace(/[\\/:*?"<>|]+/g, "-");
  const md = buildReportMarkdown(date, (s.reviews || {})[date], await aiContext(date));
  const url = "data:text/markdown;charset=utf-8," + encodeURIComponent(md);
  await chrome.downloads.download({ url, filename: `${folder}/${date}-focus-report.md`, saveAs: false });
  return { ok: true, filename: `${folder}/${date}-focus-report.md` };
}

/* ---------------------------- clear history -------------------------- */
/* Analysis-first: reviews run BEFORE anything is deleted, so no
   closed day escapes its review or its detox. */
async function clearHistory() {
  await ensureReviews();
  const s = await sget(["stats", "media", "aiSettings"]);
  const today = todayKey();
  const stats = {};
  if ((s.stats || {})[today]) stats[today] = s.stats[today]; // today always survives
  const scrub = (s.aiSettings || {}).scrub || "immediate";
  const media = {};
  if (scrub === "manual") Object.assign(media, s.media || {});
  else if ((s.media || {})[today]) media[today] = s.media[today];
  await sset({ stats, media });
  // Kept, always: reviews (+AI), hours, prod, detox, ytBlock, verdicts, blockLog.
  return { ok: true };
}

/* ------------------------------ getState ----------------------------- */
function totalsForRange(stats, dates) {
  const out = {};
  for (const d of dates) {
    for (const [domain, secs] of Object.entries(stats[d] || {})) out[domain] = (out[domain] || 0) + secs;
  }
  return Object.entries(out)
    .map(([domain, secs]) => ({ domain, minutes: Math.round(secs / 60) }))
    .filter((e) => e.minutes >= 1)
    .sort((a, b) => b.minutes - a.minutes);
}

async function getState() {
  await touchClock();
  await cleanupExpired();
  const s = await getAll();
  const cur = await getCurrent();
  const today = todayKey();
  const stats = s.stats || {};
  const weekDates = [];
  const monday = mondayKey(today);
  for (let i = 0; i < 7; i++) weekDates.push(addDaysKey(monday, i));
  const last7 = [];
  for (let i = 6; i >= 0; i--) last7.push(addDaysKey(today, -i));

  const todayList = totalsForRange(stats, [today]);
  const weekList = totalsForRange(stats, last7);
  const allList = totalsForRange(stats, Object.keys(stats));
  const perDayTotals = last7.map((d) => ({
    date: d,
    minutes: Object.values(stats[d] || {}).reduce((a, v) => a + Math.round(v / 60), 0)
  }));
  const siteWeek = {};
  for (const e of weekList) {
    siteWeek[e.domain] = last7.map((d) => Math.round(((stats[d] || {})[e.domain] || 0) / 60));
  }

  const dayMedia = (s.media || {})[today] || { videos: {} };
  const bucketsSec = mediaBuckets(dayMedia, s.channelVerdicts || {});
  const ytBuckets = Object.fromEntries(Object.entries(bucketsSec).map(([k, v]) => [k, Math.round(v / 60)]));
  const lastVideos = Object.values(dayMedia.videos || {})
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, 8)
    .map((v) => ({
      title: v.title, channel: v.channel, isShorts: v.isShorts,
      minutes: Math.max(1, Math.round(v.seconds / 60)),
      kind: classifyVideo(v.title, v.channel, v.isShorts, s.channelVerdicts || {})
    }));

  const reviews = s.reviews || {};
  const reviewDates = Object.keys(reviews).sort();
  const latestReview = reviewDates.length ? reviews[reviewDates[reviewDates.length - 1]] : null;
  const yesterday = addDaysKey(today, -1);
  const ySummary = summarizeDay(stats[yesterday]);

  const now = effNow();
  const habit = s.studyHabit || {};
  const nextNudgeMinute = (habit.completions || []).length >= 3
    ? Math.max(0, (median(habit.completions) || 1020) - 15) : 17 * 60;

  // suggestions (local, explainable, no shame)
  const suggestions = [];
  const biggest = [...weekList].find((e) => isUselessForDetox(e.domain, s.pathRules || []));
  if (biggest) suggestions.push({ title: `Biggest sink this week: ${biggest.domain}`, detail: `${biggest.minutes}m in 7 days. One 24h detox needs 30m in a single top-3 day.` });
  const goalMin = Math.round(((s.prod || {}).goal || {})[today] || 0);
  if (goalMin < GOAL_TARGET_MIN) suggestions.push({ title: "The 5–8 PM window is the lever", detail: `${goalMin} of ${GOAL_TARGET_MIN} productive minutes. One pre-decided 25-minute block closes most of the gap.` });
  if ((s.blocklist || []).length) suggestions.push({ title: "Guards run seven days a week", detail: "2.0 removed the Sunday exemption. If a guarded site shows 0 minutes, the boundary is doing its job." });
  const prodWeek = weekList.filter((e) => kindForUrl(`https://${e.domain}/`, s.pathRules || []) === "productive")
    .reduce((a, e) => a + e.minutes, 0);
  if (prodWeek > 0) suggestions.push({ title: "Productive time this week", detail: `${prodWeek}m across productive paths. Protect the window where it happened.` });

  return {
    policy: { version: POLICY_VERSION, blockMs: BLOCK_MS, calendarExemptions: 0 },
    now, today,
    trackingEnabled: s.trackingEnabled !== false,
    current: cur ? { domain: cur.domain, url: cur.url, title: cur.title } : null,
    todayList, weekList, allList, perDayTotals, siteWeek,
    todayTotal: todayList.reduce((a, e) => a + e.minutes, 0),
    hours: (s.hours && s.hours.days) || {},
    hourWeek: monday,
    goal: { minutes: goalMin, target: GOAL_TARGET_MIN, window: "17:00–19:59" },
    productiveToday: Math.round(((s.prod || {}).total || {})[today] || 0),
    yesterday: { total: ySummary.total, top: ySummary.top5[0] || null },
    suggestions,
    yt: { buckets: ytBuckets, entLimit: YT_ENT_LIMIT_MIN, shortsLimit: YT_SHORTS_LIMIT_MIN, lastVideos },
    ytBlock: s.ytBlock && s.ytBlock.endsAt > now ? s.ytBlock : null,
    detox: Object.entries(s.detox || {})
      .filter(([, t]) => t && t.endsAt > now)
      .map(([domain, t]) => ({ domain, ...t })),
    blocklist: s.blocklist || [],
    blockedChannels: s.blockedChannels || [],
    channelVerdicts: s.channelVerdicts || {},
    pathRules: s.pathRules || [],
    reviews, latestReview,
    todayPreview: computePreview(stats[today], s.pathRules || [], s.detox || {}),
    blockLog: s.blockLog || [],
    habit: {
      enabled: !!habit.enabled,
      streak: habit.streak || 0,
      lastDone: habit.lastDone || null,
      missed: habit.missed || 0,
      level: habit.level || 0,
      doneToday: habit.lastDone === today,
      nextNudge: `${pad(Math.floor(nextNudgeMinute / 60))}:${pad(nextNudgeMinute % 60)}`
    },
    aiSettings: {
      enabled: !!(s.aiSettings && s.aiSettings.enabled),
      active: (s.aiSettings || {}).active || {},
      models: (s.aiSettings || {}).models || {},
      customEndpoint: (s.aiSettings || {}).customEndpoint || "",
      folder: (s.aiSettings || {}).folder || "focus-reports",
      autoSave: !!(s.aiSettings && s.aiSettings.autoSave),
      scrub: (s.aiSettings || {}).scrub || "immediate",
      providers: Object.entries(AI_PROVIDERS).map(([id, p]) => ({ id, name: p.name, model: p.model, hasKey: !!((s.aiSettings || {}).keys || {})[id] }))
    },
    digestEnabled: !!s.digestEnabled,
    suite: SUITE_VERSION,
    shield: ((await sget(["shield"])).shield || {})[today] || { hidden: 0, shorts: 0 },
    limits: { maxBlocklist: MAX_BLOCKLIST, maxChannels: MAX_CHANNELS, maxPathRules: MAX_PATH_RULES }
  };
}

/* ------------------------------ messaging ---------------------------- */
/* Deliberately absent: any "lift", "unblock-now" or "skip" message for
   automatic blocks. removeBlock only ever touches authored rules. */
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    try {
      switch (msg && msg.type) {
        case "getState":
          sendResponse({ ok: true, state: await getState() });
          break;

        case "media-report":
          await handleMediaReport(msg);
          sendResponse({ ok: true });
          break;

        case "setTracking":
          await sset({ trackingEnabled: !!msg.enabled });
          if (!msg.enabled) { const c = await getCurrent(); if (c) { c.since = Date.now(); await setCurrent(c); } }
          sendResponse({ ok: true });
          break;

        case "addBlock": {
          const domain = cleanDomainInput(msg.domain);
          if (!isValidDomain(domain)) { sendResponse({ ok: false, error: "That doesn't look like a domain (e.g. reddit.com)." }); break; }
          const s = await sget(["blocklist"]);
          const list = s.blocklist || [];
          if (list.some((b) => b.domain === domain)) { sendResponse({ ok: false, error: `${domain} is already guarded — seven days a week.` }); break; }
          if (list.length >= MAX_BLOCKLIST) { sendResponse({ ok: false, error: `Guard list is full (${MAX_BLOCKLIST}). Remove one first.` }); break; }
          list.push({ domain, kind: msg.kind || "custom", addedAt: Date.now() });
          await sset({ blocklist: list });
          await syncRules();
          sendResponse({ ok: true });
          break;
        }

        case "removeBlock": {
          const domain = cleanDomainInput(msg.domain);
          const s = await sget(["blocklist", "detox", "ytBlock"]);
          const now = effNow();
          if (s.detox && s.detox[domain] && s.detox[domain].endsAt > now) {
            sendResponse({ ok: false, error: "Locked by policy. Detox terms end by clock only.", locked: true });
            break;
          }
          if (domain === "youtube.com" && s.ytBlock && s.ytBlock.endsAt > now) {
            sendResponse({ ok: false, error: "Locked by policy. The 24h YouTube term ends by clock only.", locked: true });
            break;
          }
          await sset({ blocklist: (s.blocklist || []).filter((b) => b.domain !== domain) });
          await syncRules();
          sendResponse({ ok: true });
          break;
        }

        case "addChannel": {
          let handle = String(msg.handle || "").trim();
          const m = handle.match(/@[\w.-]+/);
          handle = m ? m[0] : (handle.startsWith("@") ? handle : `@${handle}`);
          const s = await sget(["blockedChannels"]);
          const list = s.blockedChannels || [];
          if (list.some((c) => c.handle.toLowerCase() === handle.toLowerCase())) { sendResponse({ ok: false, error: "Channel already blocked." }); break; }
          if (list.length >= MAX_CHANNELS) { sendResponse({ ok: false, error: `Channel limit reached (${MAX_CHANNELS}).` }); break; }
          list.unshift({ handle, name: msg.name || handle.slice(1), addedAt: Date.now() });
          await sset({ blockedChannels: list });
          await syncRules();
          sendResponse({ ok: true });
          break;
        }

        case "removeChannel": {
          const s = await sget(["blockedChannels"]);
          await sset({ blockedChannels: (s.blockedChannels || []).filter((c) => c.handle !== msg.handle) });
          await syncRules();
          sendResponse({ ok: true });
          break;
        }

        case "judgeChannel": {
          const key = String(msg.channel || "").toLowerCase();
          const verdict = msg.verdict === "useful" ? "useful" : "useless";
          const s = await sget(["channelVerdicts"]);
          const verdicts = { ...(s.channelVerdicts || {}), [key]: verdict };
          await sset({ channelVerdicts: verdicts });
          await checkYoutubeThresholds(todayKey()); // re-count: can arm the block, never lift it
          sendResponse({ ok: true });
          break;
        }

        case "addRule": {
          const pattern = String(msg.pattern || "").trim().toLowerCase()
            .replace(/^https?:\/\//, "").replace(/^www\./, "");
          const kind = ["productive", "waste", "neutral"].includes(msg.kind) ? msg.kind : "neutral";
          if (!pattern.includes(".")) { sendResponse({ ok: false, error: "Pattern needs a domain, e.g. site.com/lessons/*" }); break; }
          const s = await sget(["pathRules"]);
          const rules = s.pathRules || [];
          if (rules.some((r) => r.pattern === pattern)) { sendResponse({ ok: false, error: "That pattern already exists." }); break; }
          if (rules.length >= MAX_PATH_RULES) { sendResponse({ ok: false, error: `Rule limit reached (${MAX_PATH_RULES}).` }); break; }
          rules.push({ pattern, kind });
          await sset({ pathRules: rules });
          sendResponse({ ok: true });
          break;
        }

        case "removeRule": {
          const s = await sget(["pathRules"]);
          await sset({ pathRules: (s.pathRules || []).filter((r) => r.pattern !== msg.pattern) });
          sendResponse({ ok: true });
          break;
        }

        case "forgetSite": {
          const s = await sget(["stats"]);
          const stats = s.stats || {};
          for (const d of Object.keys(stats)) delete stats[d][msg.domain];
          await sset({ stats });
          sendResponse({ ok: true });
          break;
        }

        case "markDone": {
          const habit = await recordCompletion("manual");
          sendResponse({ ok: true, habit });
          break;
        }

        case "setReminder": {
          const s = await sget(["studyHabit"]);
          const habit = { ...(s.studyHabit || {}), enabled: !!msg.enabled };
          await sset({ studyHabit: habit });
          await armReminder();
          sendResponse({ ok: true });
          break;
        }

        case "setDigest":
          await sset({ digestEnabled: !!msg.enabled });
          sendResponse({ ok: true });
          break;

        case "saveAiSettings": {
          const s = await sget(["aiSettings"]);
          const prev = s.aiSettings || {};
          const next = {
            ...prev,
            enabled: !!msg.settings.enabled,
            active: msg.settings.active || {},
            models: msg.settings.models || {},
            customEndpoint: String(msg.settings.customEndpoint || ""),
            folder: String(msg.settings.folder || "focus-reports"),
            autoSave: !!msg.settings.autoSave,
            scrub: ["immediate", "days3", "manual"].includes(msg.settings.scrub) ? msg.settings.scrub : "immediate",
            keys: { ...(prev.keys || {}) }
          };
          for (const [id, key] of Object.entries(msg.settings.keys || {})) {
            if (key) next.keys[id] = String(key).trim(); // blank field = keep existing key
          }
          await sset({ aiSettings: next });
          sendResponse({ ok: true });
          break;
        }

        case "askAI": {
          await ensureReviews();
          const date = msg.date || addDaysKey(todayKey(), -1);
          const s = await sget(["reviews"]);
          if (!(s.reviews || {})[date]) {
            // allow an on-demand round for a day that has stats but no review yet
            const st = await sget(["stats"]);
            if (!(st.stats || {})[date]) { sendResponse({ ok: false, error: "No data for that day yet." }); break; }
            await sset({ reviews: { ...(s.reviews || {}), [date]: { date, ai: [], aiAttempts: 0, onDemand: true, createdAt: effNow() } } });
          }
          const result = await runAiRound(date);
          sendResponse(result.ok ? { ok: true } : result);
          break;
        }

        case "saveReport": {
          const r = await saveReportFile(msg.date || addDaysKey(todayKey(), -1));
          sendResponse(r);
          break;
        }

        case "clearHistory":
          await clearHistory();
          sendResponse({ ok: true });
          break;

        case "ytf-shield":
          await recordShield(msg.hidden, msg.shorts);
          sendResponse({ ok: true });
          break;

        default:
          sendResponse({ ok: false, error: "Unknown message." });
      }
    } catch (err) {
      sendResponse({ ok: false, error: String(err && err.message || err) });
    }
  })();
  return true; // async response
});

/* --------------------------- browser events -------------------------- */
chrome.tabs.onActivated.addListener(async () => { await switchCurrent(await activeTabInfo()); });
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo) => {
  if (changeInfo.url || changeInfo.status === "complete") {
    const info = await activeTabInfo();
    if (info && info.tabId === tabId) await switchCurrent(info);
  }
});
chrome.tabs.onRemoved.addListener(async () => { await switchCurrent(await activeTabInfo()); });
chrome.windows.onFocusChanged.addListener(async (winId) => {
  if (winId === chrome.windows.WINDOW_ID_NONE) { await flush(); await setCurrent(null); }
  else await switchCurrent(await activeTabInfo());
});
chrome.storage.onChanged.addListener((changes, area) => {
  // any keyword-list edit (options page, import, sync from another device) re-teaches the classifier
  if (area === "sync" && (changes.ytfAllowed || changes.ytfGood || changes.ytfBlocked)) loadYtf();
});
chrome.idle.onStateChanged.addListener(async (state) => {
  if (state !== "active") await flush();
  else { const c = await getCurrent(); if (c) { c.since = Date.now(); await setCurrent(c); } }
});

async function scheduleMidnight() {
  const next = new Date();
  next.setHours(24, 0, 5, 0);
  await chrome.alarms.create("midnight", { when: next.getTime() });
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  try {
    if (alarm.name === "tick") { await touchClock(); await flush(); }
    else if (alarm.name === "midnight") { await ensureReviews(); await scheduleMidnight(); await syncRules(); }
    else if (alarm.name === "digest") { await fireDigest(); }
    else if (alarm.name === "study-reminder") { await fireReminder(); }
    else if (alarm.name === "resync") { await touchClock(); await cleanupExpired(); await syncRules(); }
  } catch (e) { /* alarms retry naturally on next cycle */ }
});

/* Single-flight boot: Chromium evaluates this file and THEN dispatches the
   queued install/startup event, so boot() would otherwise run twice at once.
   That race made two syncRules passes collide ("Rule with id N does not have
   a unique ID"). Concurrent callers now await the same pass; a later event
   triggers a fresh one. */
let bootPromise = null;
function boot() {
  if (!bootPromise) bootPromise = doBoot().finally(() => { bootPromise = null; });
  return bootPromise;
}

async function doBoot() {
  const s = await sget(["lastSeenAt"]);
  lastSeenAt = s.lastSeenAt || 0;
  await touchClock();
  await loadYtf();            // Suite: the shared keyword brain
  await ensureDefaults();
  await migrate();            // 2.0 policy: purge Sunday, clamp terms to 24h
  await cleanupExpired();
  await syncRules();          // 7/7 — there is no day check
  await ensureReviews();      // catch-up: closed days are never lost
  await chrome.idle.setDetectionInterval(IDLE_SECONDS);
  await chrome.alarms.create("tick", { periodInMinutes: 0.5 });
  await chrome.alarms.create("resync", { periodInMinutes: 360 });
  await scheduleMidnight();
  await armReminder();
  await switchCurrent(await activeTabInfo());
}

chrome.runtime.onInstalled.addListener(boot);
chrome.runtime.onStartup.addListener(boot);
boot();
