/* Focus Tracker 2.0 — popup controller.
   Talks to background.js over runtime messages. There is intentionally
   NO control here that can lift an automatic block: the worker does not
   expose one, and armed terms render as "Locked", not as buttons. */
"use strict";

const $ = (sel) => document.querySelector(sel);
const view = $("#view");

/* CSP-safe favicon fallback: inline onerror handlers are blocked by the
   extension's script-src policy, so listen in the capture phase instead. */
view.addEventListener("error", (e) => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement) || !img.dataset.favicon) return;
  const letter = document.createElement("span");
  letter.textContent = img.dataset.favicon;
  img.replaceWith(letter);
}, true);

let state = null;
let tab = "today";
let range = "today";
let openSite = null;
let pendingRemove = null; // domain awaiting second click
let removeTimer = null;
let clearStep = 0;
let toastTimer = null;
let undoFn = null;
let ytf = null;            // YouTube Focus settings (chrome.storage.sync)
let pendingLoosen = null;  // a protection awaiting its second, deliberate click
let loosenTimer = null;

/* ------------------- YouTube Focus settings (sync) ------------------- */
const YTF_DEFAULTS = (globalThis.FOCUS_DEFAULTS || {}).settings || {};
const YTF_MODE_RANK = { off: 0, balanced: 1, strict: 2 };
function loadYtf() {
  return new Promise((resolve) => {
    try {
      chrome.storage.sync.get(["ytfSettings"], (s) => {
        void chrome.runtime.lastError;
        resolve({ ...YTF_DEFAULTS, ...((s && s.ytfSettings) || {}) });
      });
    } catch (e) { resolve({ ...YTF_DEFAULTS }); }
  });
}
function saveYtf(next) {
  return new Promise((resolve) => chrome.storage.sync.set({ ytfSettings: next }, () => { void chrome.runtime.lastError; resolve(); }));
}
function armLoosen(key) {
  pendingLoosen = key;
  render();
  clearTimeout(loosenTimer);
  loosenTimer = setTimeout(() => { pendingLoosen = null; render(); }, 4000);
}

const send = (msg) =>
  new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (res) => {
      void chrome.runtime.lastError;
      resolve(res || { ok: false, error: "No response from the worker." });
    });
  });

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function fmt(min) {
  min = Math.max(0, Math.round(min || 0));
  if (min < 60) return `${min}m`;
  return `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, "0")}m`;
}
/* Escaped text first, markup second — esc() must never see the <small> tags. */
function bigTime(min) {
  const base = esc(fmt(min));
  return min >= 60 ? base.replace(" ", "<small>") + "</small>" : base;
}
function fmtShort(min) {
  min = Math.max(0, Math.round(min || 0));
  return min < 60 ? `${min}m` : `${Math.floor(min / 60)}h${String(min % 60).padStart(2, "0")}`;
}
function countdown(endsAt) {
  const ms = endsAt - (state ? state.now : Date.now());
  if (ms <= 0) return "expired";
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}
function timeAgo(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
    " · " + d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}
const DAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
function dayLabel(dateKey) {
  const [y, m, d] = dateKey.split("-").map(Number);
  return DAY_SHORT[(new Date(y, m - 1, d).getDay() + 6) % 7];
}
function isLockedDomain(domain) {
  if (!state) return false;
  if (state.detox.some((t) => t.domain === domain)) return true;
  if (domain.endsWith("youtube.com") && state.ytBlock) return true;
  return false;
}
function isGuarded(domain) {
  return state && (state.blocklist.some((b) => b.domain === domain) || isLockedDomain(domain));
}

/* ------------------------------- toast ------------------------------ */
function toast(text, sub, undo) {
  $("#toastText").textContent = text;
  $("#toastSub").textContent = sub || "";
  undoFn = undo || null;
  $("#toastUndo").classList.toggle("hidden", !undo);
  $("#toastClose").classList.toggle("hidden", !!undo);
  $("#toast").classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, 7000);
}
function hideToast() { $("#toast").classList.add("hidden"); undoFn = null; }
$("#toastClose").addEventListener("click", hideToast);
$("#toastUndo").addEventListener("click", async () => {
  if (undoFn) await undoFn();
  hideToast();
  await refresh();
});

/* ------------------------------ refresh ----------------------------- */
async function refresh() {
  const res = await send({ type: "getState" });
  if (!res.ok) { view.innerHTML = `<p class="dim loading">${esc(res.error || "Could not load state.")}</p>`; return; }
  state = res.state;
  ytf = await loadYtf();
  renderHeader();
  render();
}
function renderHeader() {
  const on = state.trackingEnabled;
  $("#trackingSwitch").classList.toggle("on", on);
  $("#trackingSwitch").setAttribute("aria-checked", String(on));
  $("#trackingLabel").textContent = on ? "ON" : "OFF";
  $("#pausedBanner").classList.toggle("hidden", on);
}

/* --------------------------- tracking toggle ------------------------ */
$("#trackingSwitch").addEventListener("click", () => {
  if (!state) return;
  if (state.trackingEnabled) {
    $("#pauseInput").value = "";
    $("#pauseConfirm").disabled = true;
    $("#pauseOverlay").classList.remove("hidden");
    setTimeout(() => $("#pauseInput").focus(), 30);
  } else {
    send({ type: "setTracking", enabled: true }).then(refresh);
    toast("Tracking resumed", "Focus time counts again on the active tab.");
  }
});
$("#resumeBtn").addEventListener("click", () => send({ type: "setTracking", enabled: true }).then(refresh));
$("#pauseInput").addEventListener("input", (e) => {
  $("#pauseConfirm").disabled = e.target.value.trim().toUpperCase() !== "PAUSE";
});
$("#pauseInput").addEventListener("keydown", (e) => { if (e.key === "Enter" && !$("#pauseConfirm").disabled) $("#pauseConfirm").click(); });
const closePause = () => $("#pauseOverlay").classList.add("hidden");
$("#pauseCancel").addEventListener("click", closePause);
$("#pauseCancelTop").addEventListener("click", closePause);
$("#pauseConfirm").addEventListener("click", async () => {
  await send({ type: "setTracking", enabled: false });
  closePause();
  await refresh();
  toast("Tracking paused", "A locked block is not paused. Terms run on the clock.");
});

/* ------------------------------- tabs ------------------------------- */
$("#tabs").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-tab]");
  if (!btn) return;
  tab = btn.dataset.tab;
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === tab));
  render();
});

/* ------------------------------ renders ----------------------------- */
function render() {
  if (!state) return;
  if (tab === "today") view.innerHTML = renderToday();
  else if (tab === "sites") view.innerHTML = renderSites();
  else if (tab === "blocks") view.innerHTML = renderBlocks();
  else view.innerHTML = renderMore();
}

function renderToday() {
  const s = state;
  const goalPct = Math.min(100, (s.goal.minutes / s.goal.target) * 100);
  const cur = s.current;
  const topWaste = s.todayList.find((e) => !isGuarded(e.domain)) || null;
  const nextMove = s.goal.minutes < 25
    ? "Open one productive lesson, then build for 15 minutes. Practice before another video."
    : s.productiveToday >= 10
      ? "Today already counts. One more short build rep turns it into proof."
      : "Ten productive minutes completes the day. Pick the smallest real task and start it.";
  return `
    <div class="row-between">
      <span class="label">${esc(dayLabel(s.today))} · ${esc(s.today)}</span>
      <span class="pill ${s.trackingEnabled ? "mint" : "sand"}"><span class="live-dot"></span>${s.trackingEnabled ? "tracking live" : "paused"}</span>
    </div>

    <div class="card hero-card" style="margin-top:9px">
      <p class="label">Focused today</p>
      <p class="big-time">${bigTime(s.todayTotal)}</p>
      <p class="sub">${s.todayList.length} sites · idle-aware · 0 bytes sent</p>
      <div style="border-top:1px solid var(--line);margin-top:9px;padding-top:8px">
        <div class="row-between"><span class="sub" style="margin:0">5–8 PM productive goal</span><span class="mono" style="font-size:9px;color:var(--mint)">${s.goal.minutes}/${s.goal.target}m</span></div>
        <div class="bar"><div style="width:${goalPct}%"></div></div>
        <p class="hint">Only productive path rules count. Window ${esc(s.goal.window)}.</p>
      </div>
    </div>

    <div class="card">
      <p class="label">Right now</p>
      ${cur ? `
      <div class="row" style="gap:8px;margin-top:7px">
        <span class="fav">${esc(cur.domain.charAt(0).toUpperCase())}</span>
        <div class="grow">
          <p class="site-name">${esc(cur.domain)} ${isLockedDomain(cur.domain) ? "🔒" : ""}</p>
          <p class="chan-sub"><span class="live-dot"></span> focused window ${isLockedDomain(cur.domain) ? "· this site is locked" : ""}</p>
        </div>
        <span class="mono dim" style="font-size:9px">${fmtShort((s.todayList.find((e) => e.domain === cur.domain) || {}).minutes || 0)} today</span>
      </div>` : `<p class="sub">No web tab in focus right now.</p>`}
    </div>

    <div class="card brand-card">
      <p class="label" style="color:var(--brand)">Next best move</p>
      <p style="font-size:11.5px;line-height:1.5;margin-top:5px">${esc(nextMove)}</p>
    </div>

    <div class="card">
      <div class="row-between">
        <div>
          <p style="font-size:11px;font-weight:600">${s.habit.doneToday ? "Done for today" : `Study nudge · ${esc(s.habit.nextNudge)}`}</p>
          <p class="sub" style="margin-top:2px">${s.habit.doneToday ? "A completed day is never nudged." : s.habit.enabled ? "Learned from your median completion, minus 15 minutes." : "Reminders are off (More tab). The day still completes at 10 productive minutes."}</p>
        </div>
        <span class="pill sand">🔥 ${s.habit.streak}</span>
      </div>
      <button class="btn primary ${s.habit.doneToday ? "done" : ""}" data-action="markDone">${s.habit.doneToday ? "✓ Marked done today" : "Mark today done"}</button>
    </div>

    <div class="card">
      <p class="sub" style="margin:0"><b style="color:#d6dae3">Yesterday ·</b> ${fmt(s.yesterday.total)} tracked${s.yesterday.top ? ` · top ${esc(s.yesterday.top.domain)} (${s.yesterday.top.minutes}m)` : ""}.</p>
      ${s.shield && (s.shield.hidden || s.shield.shorts || s.shield.adult) ? `<p class="hint">🛡️ YouTube Focus shielded you today: ${s.shield.hidden} video${s.shield.hidden === 1 ? "" : "s"} hidden · ${s.shield.shorts} Short${s.shield.shorts === 1 ? "" : "s"} blocked · ${s.shield.adult || 0} 18+ blocked.</p>` : ""}
      ${topWaste ? `<p class="hint">Watching: ${esc(topWaste.domain)} — a top-3 day at 30m+ arms a locked 24h detox at midnight.</p>` : ""}
    </div>
    ${renderShieldReport(s)}`;
}

function renderShieldReport(s) {
  const totals = s.shieldTotals || { hidden: 0, shorts: 0, adult: 0, cats: {} };
  const cats = totals.cats || {};
  const defs = [
    ["education", "Education", "var(--mint)"],
    ["memory_cognitive", "Memory", "#c084fc"],
    ["self_improvement", "Self-help", "var(--brand)"],
    ["entertainment", "Entertainment", "var(--sand)"],
    ["unknown", "Unknown", "rgba(255,255,255,0.35)"],
    ["adult_18plus", "18+", "var(--coral)"]
  ];
  const totalCats = defs.reduce((a, d) => a + (cats[d[0]] || 0), 0);
  const activeDays = (s.shield7 || []).filter((d) =>
    d.hidden || d.shorts || d.adult || defs.some(([k]) => (d.cats || {})[k])
  ).length;
  if (!totals.hidden && !totals.shorts && !totals.adult && !totalCats) {
    return `
    <div class="card" id="shieldReport">
      <div class="row-between"><p class="label">7-day classifier report</p><span class="mono dim" style="font-size:8px">on-device</span></div>
      <p class="hint">No shield activity in the last 7 days. Open YouTube with the classifier on and this fills in.</p>
    </div>`;
  }
  const seg = defs.map(([key, , color]) =>
    totalCats ? `<i style="width:${((cats[key] || 0) / totalCats) * 100}%;background:${color}"></i>` : ""
  ).join("");
  const legend = defs.map(([key, label, color]) =>
    `<div><i style="background:${color}"></i>${label}<b>${cats[key] || 0}</b></div>`
  ).join("");
  return `
    <div class="card" id="shieldReport">
      <div class="row-between"><p class="label">7-day classifier report</p><span class="mono dim" style="font-size:8px">filtered tiles</span></div>
      <div class="metric4">
        <div class="metric"><p>Hidden</p><b>${totals.hidden}</b></div>
        <div class="metric"><p>Shorts</p><b>${totals.shorts}</b></div>
        <div class="metric"><p>18+</p><b style="color:var(--coral)">${totals.adult}</b></div>
        <div class="metric"><p>Days</p><b>${activeDays}/7</b></div>
      </div>
      ${totalCats
        ? `<div class="stacked">${seg}</div><div class="legend">${legend}</div>`
        : `<p class="hint">Category counters start after the next YouTube visit with the classifier on.</p>`}
      <p class="hint">Category mix of hidden/blocked tiles. Counters only — no titles or URLs.</p>
    </div>`;
}

function renderSites() {
  const s = state;
  const list = range === "today" ? s.todayList : range === "7d" ? s.weekList : s.allList;
  const total = list.reduce((a, e) => a + e.minutes, 0);
  const rows = list.map((e) => {
    const pct = total ? Math.round((e.minutes / total) * 100) : 0;
    const locked = isLockedDomain(e.domain);
    const opened = openSite === e.domain;
    const week = s.siteWeek[e.domain] || [];
    const maxW = Math.max(1, ...week);
    return `
    <div class="site-row">
      <button class="site-main" data-action="toggleSite" data-domain="${esc(e.domain)}">
        <span class="fav"><img src="_favicon/?pageUrl=${encodeURIComponent("https://" + e.domain)}&size=32" alt="" data-favicon="${esc(e.domain.charAt(0).toUpperCase())}"></span>
        <span class="grow">
          <span class="site-name">${esc(e.domain)} ${locked ? "🔒" : ""}${s.current && s.current.domain === e.domain ? ' <span class="live-dot"></span>' : ""}</span>
          <span class="bar thin" style="display:block"><div style="width:${Math.max(3, pct)}%"></div></span>
        </span>
        <span class="site-meta"><span class="site-time">${fmtShort(e.minutes)}</span><br><span class="site-pct">${pct}%</span></span>
      </button>
      ${opened ? `
      <div class="site-detail">
        <div class="mini-bars">${week.map((v, i) => `<span class="mb ${i === 6 ? "today" : ""}"><i style="height:${Math.max(4, (v / maxW) * 32)}px"></i><span>${esc(dayLabel(s.perDayTotals[i].date)[0])}</span></span>`).join("")}</div>
        <p class="hint">${fmt(week.reduce((a, b) => a + b, 0))} in the last 7 days.</p>
        <div class="row gap" style="margin-top:7px">
          <button class="btn flex1" style="padding:6px" data-action="blockSite" data-domain="${esc(e.domain)}">🔒 Block</button>
          <button class="btn ghost" style="padding:6px 9px" data-action="forgetSite" data-domain="${esc(e.domain)}">Forget</button>
        </div>
      </div>` : ""}
    </div>`;
  }).join("");

  const maxDay = Math.max(1, ...s.perDayTotals.map((d) => d.minutes));
  const heatRows = Object.keys(s.hours).sort().slice(-7).map((date) => {
    const cells = (s.hours[date] || []).map((m) =>
      `<i style="background:rgba(129,140,248,${Math.min(0.95, 0.05 + m / 45).toFixed(2)})" title="${date} · ${Math.round(m)}m"></i>`).join("");
    return `<div class="heat-row"><b>${esc(dayLabel(date))}</b><div class="heat-grid">${cells}</div></div>`;
  }).join("");

  const ruleRows = s.pathRules.map((r) => `
    <div class="rule-row">
      <span class="rule-pattern grow">${esc(r.pattern)}</span>
      ${r.seeded ? '<span class="tag">seeded</span>' : ""}
      <span class="tag ${r.kind === "productive" ? "mint" : r.kind === "waste" ? "coral" : ""}">${esc(r.kind)}</span>
      <button class="x" data-action="removeRule" data-pattern="${esc(r.pattern)}" aria-label="Remove rule">✕</button>
    </div>`).join("");

  return `
    <div class="seg">
      ${["today", "7d", "all"].map((r) => `<button data-action="setRange" data-range="${r}" class="${range === r ? "active" : ""}">${r === "today" ? "Today" : r === "7d" ? "7 days" : "All time"}</button>`).join("")}
    </div>
    <div class="row-between" style="margin-bottom:8px">
      <p style="font-size:12px"><b style="font-size:16px">${fmt(total)}</b> <span class="dim">${range === "today" ? "today" : range === "7d" ? "last 7 days" : "all time"}</span></p>
      <span class="mono dim" style="font-size:8.5px">${list.length} sites · 90d ledger</span>
    </div>
    ${rows || '<p class="dim" style="padding:14px 0;text-align:center">Nothing tracked yet. Browse something worth counting.</p>'}

    <div class="card" style="margin-top:10px">
      <div class="row-between"><p class="label">Last 7 days</p><span class="mono dim" style="font-size:8px">focused minutes</span></div>
      <div class="week-chart">${s.perDayTotals.map((d, i) => `
        <span class="wc ${i === 6 ? "today" : ""}"><span class="mono" style="font-size:7px;color:var(--faint)">${i === 6 ? fmtShort(d.minutes) : ""}</span><i style="height:${Math.max(3, (d.minutes / maxDay) * 52)}px"></i><span>${esc(dayLabel(d.date))}</span></span>`).join("")}
      </div>
    </div>

    <div class="card">
      <div class="row-between"><p class="label">Week rhythm</p><span class="mono dim" style="font-size:8px">survives clears</span></div>
      <div class="heat">${heatRows || '<p class="hint">No hourly data yet this week.</p>'}</div>
    </div>

    ${s.suggestions.length ? `<p class="label" style="margin:4px 0 7px">Suggestions · on-device</p>
    ${s.suggestions.map((sg) => `<div class="card" style="padding:9px 11px"><p style="font-size:10.5px;font-weight:600">${esc(sg.title)}</p><p class="sub" style="margin-top:2px">${esc(sg.detail)}</p></div>`).join("")}` : ""}

    <div class="card">
      <div class="row-between"><p class="label">Study rules</p><span class="mono dim" style="font-size:8px">${s.pathRules.length}/${s.limits.maxPathRules}</span></div>
      <div style="margin-top:8px">${ruleRows || '<p class="hint">No rules yet. Bare domain = whole site; * matches anything; longest pattern wins.</p>'}</div>
      <form class="form" id="ruleForm">
        <input class="field mono" id="rulePattern" placeholder="domain[/path/*]" style="font-size:9.5px" />
        <select class="field" id="ruleKind">
          <option value="productive">productive</option>
          <option value="waste">waste</option>
          <option value="neutral">neutral</option>
        </select>
        <button class="btn" style="padding:6px 10px" type="submit">Add</button>
      </form>
      <p class="hint">Productive minutes are the only ones counted in the 5–8 PM goal. Seeded defaults stay deleted once removed.</p>
    </div>`;
}

function renderBlocks() {
  const s = state;
  const b = s.yt.buckets;
  const adult = b.adult || 0;
  const entTotal = b.waste + adult;
  const ytTotal = b.edu + b.passive + entTotal + b.shorts + b.other;
  const seg = (v, color) => ytTotal ? `<i style="width:${(v / ytTotal) * 100}%;background:${color}"></i>` : "";

  const videoRows = s.yt.lastVideos.map((v) => `
    <div class="video-row">
      <div class="grow">
        <p class="chan-name">${esc(v.title)}</p>
        <p class="chan-sub">${esc(v.channel || "unknown channel")} · ${v.minutes}m · ${v.kind}${v.isShorts ? " · shorts" : ""}</p>
      </div>
      <button class="judge" title="Useful channel" data-action="judge" data-verdict="useful" data-channel="${esc(v.channel || "")}">👍</button>
      <button class="judge" title="Useless channel" data-action="judge" data-verdict="useless" data-channel="${esc(v.channel || "")}">👎</button>
    </div>`).join("");

  const guardRows = s.blocklist.map((g) => {
    const armed = pendingRemove === g.domain;
    return `
    <div class="block-row">
      <div class="row-between">
        <p class="block-name">🛡️ ${esc(g.domain)} <span class="tag">${esc(g.kind || "custom")}</span> <span class="tag">7/7</span></p>
        <button class="mini-btn ${armed ? "armed" : ""}" data-action="removeBlock" data-domain="${esc(g.domain)}">${armed ? "Sure?" : "Remove"}</button>
      </div>
      <p class="noexpiry">persistent guard · every day of the week · two-step remove</p>
    </div>`;
  }).join("");

  const detoxRows = s.detox.map((t) => `
    <div class="block-row" style="border-color:rgba(251,113,133,0.22)">
      <div class="row-between">
        <p class="block-name">🔒 ${esc(t.domain)} <span class="tag coral">auto-detox</span> <span class="tag">24h</span></p>
        <button class="mini-btn locked" data-action="lockedTry">Locked</button>
      </div>
      <p class="block-reason">${esc(t.reason || "")}</p>
      <p class="countdown">lifts in ${countdown(t.endsAt)} · clock only · no early lift</p>
    </div>`).join("");

  const chanRows = s.blockedChannels.map((c) => `
    <div class="chan-row">
      <span class="fav" style="background:rgba(244,63,94,0.12);color:var(--coral)">▶</span>
      <div class="grow"><p class="chan-name">${esc(c.handle)}</p><p class="chan-sub">feed hidden · watch pages redirect home</p></div>
      <span class="tag coral">hidden</span>
      <button class="x" data-action="removeChannel" data-handle="${esc(c.handle)}" aria-label="Remove channel">✕</button>
    </div>`).join("");

  const next = [...s.detox, ...(s.ytBlock ? [{ domain: "youtube.com", endsAt: s.ytBlock.endsAt }] : [])]
    .sort((a, b2) => a.endsAt - b2.endsAt)[0];

  return `
    ${renderYtfCard()}
    <div class="card">
      <div class="row-between"><p class="label">YouTube today</p><span class="pill coral">🔒 1-day term</span></div>
      <div class="stacked">${seg(b.edu, "rgba(74,222,128,0.85)")}${seg(b.passive, "rgba(129,140,248,0.85)")}${seg(entTotal, entTotal >= s.yt.entLimit || b.shorts >= s.yt.shortsLimit ? "#fb7185" : "rgba(243,214,166,0.85)")}${seg(b.shorts + b.other, "rgba(255,255,255,0.25)")}</div>
      <div class="legend">
        <div><i style="background:var(--mint)"></i>Educational<b>${b.edu}m</b></div>
        <div><i style="background:var(--brand)"></i>Self-help trap<b>${b.passive}m</b></div>
        <div><i style="background:var(--sand)"></i>Entertainment / 18+<b>${entTotal}m</b></div>
        <div><i style="background:rgba(255,255,255,0.35)"></i>Shorts + browsing<b>${b.shorts + b.other}m</b></div>
      </div>
      ${adult ? `<p class="hint" style="color:var(--coral)">🔞 ${adult}m classified 18+ today. Hard-blocked; 18+ is never revealable.</p>` : ""}
      <div class="metric3">
        <div class="metric"><p>Ent+18+ / ${s.yt.entLimit}m</p><b style="color:${entTotal >= s.yt.entLimit ? "var(--coral)" : "inherit"}">${entTotal}m</b></div>
        <div class="metric"><p>Shorts / ${s.yt.shortsLimit}m</p><b style="color:${b.shorts >= s.yt.shortsLimit ? "var(--coral)" : "inherit"}">${b.shorts}m</b></div>
        <div class="metric"><p>Status</p><b style="color:${s.ytBlock ? "var(--coral)" : "var(--mint)"}">${s.ytBlock ? "LOCKED" : "safe"}</b></div>
      </div>
      ${s.ytBlock ? `<div class="card locked-card" style="margin:9px 0 0;padding:9px">
        <div class="row-between"><p style="font-size:10.5px;font-weight:600;color:var(--coral)">youtube.com is blocked</p><span class="mono" style="font-size:9px;color:var(--coral)">${countdown(s.ytBlock.endsAt)}</span></div>
        <p class="block-reason">${esc(s.ytBlock.reason || "")} · armed for exactly 24 hours.</p>
      </div>` : `<p class="hint">Cross 40m entertainment + 18+ or 20m Shorts and youtube.com locks for exactly 24 hours. No skip exists.</p>`}
      ${videoRows ? `<p class="label" style="margin:10px 0 6px">Judge recent videos · per channel, forever</p>${videoRows}` : ""}
    </div>

    <div class="card">
      <div class="row-between"><p class="label">Blocked sites</p><span class="mono dim" style="font-size:8px">${s.blocklist.length + s.detox.length} rules</span></div>
      <div style="margin-top:8px">${detoxRows}${guardRows || '<p class="hint">No persistent guards. Add one below — it applies every day, Sundays included.</p>'}</div>
      <form class="form" id="blockForm">
        <input class="field" id="blockDomain" placeholder="add a site, e.g. reddit.com" />
        <button class="btn" style="padding:6px 10px" type="submit">Block</button>
      </form>
      <p class="hint">No Sunday toggle exists. Custom guards remove in two clicks; automatic blocks cannot be lifted at all.</p>
    </div>

    <div class="card">
      <div class="row-between"><p class="label">Blocked YouTube channels</p><span class="mono dim" style="font-size:8px">${s.blockedChannels.length}/${s.limits.maxChannels}</span></div>
      <div style="margin-top:8px">${chanRows || '<p class="hint">Paste an @handle or a channel link. Their videos vanish from feeds, search and Shorts.</p>'}</div>
      <form class="form" id="channelForm">
        <input class="field" id="channelInput" placeholder="@handle or channel link" />
        <button class="btn" style="padding:6px 10px" type="submit">Add</button>
      </form>
    </div>

    <div class="card">
      <div class="row-between"><p class="label">Next automatic unlock</p><span class="mono" style="font-size:8px;color:var(--coral)">no early lift</span></div>
      ${next ? `
        <div class="row-between" style="margin-top:7px"><span style="font-size:11px">${esc(next.domain)}</span><span class="mono" style="font-size:12px;color:var(--coral)">${countdown(next.endsAt)}</span></div>
        <div class="bar coral-bar"><div style="width:${Math.min(100, Math.max(2, (1 - (next.endsAt - s.now) / 86400000) * 100))}%"></div></div>
        <p class="hint">The 24-hour term runs across every day, Sunday included.</p>`
      : `<p class="sub">No expiring blocks right now. Persistent guards stay until you remove them.</p>`}
    </div>`;
}

/* The YouTube Focus control card (Blocks tab). Tightening is one click;
   loosening anything takes a second, deliberate click within 4 seconds. */
function renderYtfCard() {
  if (!ytf) return "";
  const sw = (key, label, sub) => `
    <div class="row-between" style="margin-top:9px">
      <div class="grow"><p style="font-size:10.5px;font-weight:600">${label}</p>
        <p class="sub" style="margin-top:1px">${pendingLoosen === key ? '<span class="coral">Tap again to turn this protection off</span>' : sub}</p></div>
      <button class="switch ${ytf[key] ? "on" : ""}" data-action="ytfToggle" data-key="${key}" role="switch" aria-checked="${!!ytf[key]}" aria-label="${label}"><span></span></button>
    </div>`;
  const modes = [["off", "Off"], ["balanced", "Balanced"], ["strict", "Only useful"]];
  return `
    <div class="card brand-card">
      <div class="row-between"><p class="label" style="color:var(--brand)">YouTube Focus</p><span class="pill mint">on-device · no network</span></div>
      <div class="seg" style="margin:9px 0 0">
        ${modes.map(([m, l]) => `<button data-action="ytfMode" data-mode="${m}" class="${ytf.mode === m ? "active" : ""}">${pendingLoosen === "mode:" + m ? "Sure?" : l}</button>`).join("")}
      </div>
      <p class="hint" style="margin-top:6px">${ytf.mode === "off" ? "No keyword filtering. 18+ hard block and layout switches still apply." : ytf.mode === "balanced" ? "Junk and 18+ hidden; neutral videos stay." : "Only classifier-approved learning, memory, self-improvement, and Allowed keywords are shown."}</p>
      ${sw("smartFilter", "Smart content classifier", "Blocks 18+ always; identifies education, memory, self-improvement, and entertainment on-device.")}
      ${sw("hideHomeRecs", "Hide the home feed", "Replaced by “search for what you actually need”.")}
      ${sw("hideSidebar", "Hide related, end screens, autoplay", "Up-next column, chips, end-screen wall, pause overlay.")}
      ${sw("blockShorts", "Block Shorts everywhere", "Nav, shelves, cards and /shorts/ pages — the player never loads.")}
      <div class="row-between" style="margin-top:9px">
        <div class="grow"><p style="font-size:10.5px;font-weight:600">Search override</p><p class="sub" style="margin-top:1px">A matching query skips filtering for that page.</p></div>
        <select class="field" id="ytfQuery" aria-label="Search override" style="flex:0 0 auto;max-width:150px;font-size:9.5px">
          ${[["allowed+good", "Allowed + good"], ["allowed", "Allowed only"], ["never", "Never"]].map(([v, l]) => `<option value="${v}" ${ytf.queryPassMode === v ? "selected" : ""}>${l}</option>`).join("")}
        </select>
      </div>
      <button class="btn w100" data-action="ytfOptions">Edit keyword lists →</button>
      <p class="hint">One brain: the keyword lists and on-device classifier also teach the tracker what counts as waste, educational, or 18+ when you watch.</p>
    </div>`;
}

function renderMore() {
  const s = state;
  const r = s.latestReview;
  const reviewBlock = r ? `
    <div style="margin-top:7px">${(r.top5 || []).slice(0, 3).map((e, i) => `
      <div class="review-line"><span class="rn">0${i + 1}</span><span class="rd">${esc(e.domain)}</span><span class="rm">${e.minutes}m</span></div>`).join("")}
    </div>
    <div class="row-between" style="border:1px solid var(--line);border-radius:8px;padding:6px 8px;margin-top:8px">
      <span class="dim" style="font-size:9.5px">Biggest time-waster</span><span style="font-size:9.5px;color:var(--coral)">${esc(r.waster || "—")} ${r.wasterMinutes ? `· ${r.wasterMinutes}m` : ""}</span>
    </div>` : `<p class="sub">No closed day reviewed yet. The first review lands at midnight.</p>`;

  const aiNotes = (r && r.ai || []).filter((a) => a.text || a.error).slice(-4).reverse().map((a) => `
    <div class="ai-note"><span class="who">${esc(a.provider)}</span><p>${esc(a.text || ("⚠ " + a.error))}</p></div>`).join("");

  const providerForms = s.aiSettings.providers.map((p) => `
    <div class="provider">
      <label class="checkline"><input type="checkbox" data-ai-active="${p.id}" ${s.aiSettings.active[p.id] ? "checked" : ""}> ${esc(p.name)}
        <span class="keystate">${p.hasKey ? "key saved" : "no key"}</span></label>
      <input class="field" type="password" data-ai-key="${p.id}" placeholder="API key ${p.hasKey ? "(leave blank to keep)" : ""}" autocomplete="off">
      <input class="field mono" data-ai-model="${p.id}" placeholder="model" value="${esc(s.aiSettings.models[p.id] || p.model || "")}" style="font-size:9px">
    </div>`).join("");

  const logRows = s.blockLog.slice(0, 5).map((e) => `
    <div class="log-row">
      <div class="row-between"><p style="font-size:10px;font-weight:600">${esc(e.target)} <span class="tag">${esc(e.kind)}</span> ${e.locked ? "🔒" : ""}</p><span class="mono dim" style="font-size:8px">${e.durationMs ? "24h" : "—"}</span></div>
      <p class="block-reason">${esc(e.reason || "")}</p>
      <p class="mono" style="font-size:7.5px;color:var(--faint);margin-top:2px">${esc(timeAgo(e.at))} · policy ${esc(e.policy || "2.0")}</p>
    </div>`).join("");

  return `
    <div class="card">
      <div class="row-between"><p class="label">Daily review ${r ? "· " + esc(r.date) : ""}</p><span class="mono dim" style="font-size:8px">${r ? fmt(r.totalMinutes) : ""}</span></div>
      ${reviewBlock}
      <div class="card sand-card" style="margin:9px 0 0;padding:9px">
        <p class="label" style="color:var(--sand)">Midnight dry-run · today</p>
        <p style="font-size:9.5px;line-height:1.55;color:#d6dae3;margin-top:4px">${esc(s.todayPreview)}</p>
      </div>
    </div>

    <div class="card brand-card">
      <div class="row-between"><p class="label" style="color:var(--brand)">Cloud AI review · opt-in</p>
        <button class="switch ${s.aiSettings.enabled ? "on" : ""}" data-action="toggleAi" role="switch" aria-checked="${s.aiSettings.enabled}"><span></span></button></div>
      <p class="sub">Numbers only — domains and minutes, never titles or URLs — to providers you enable with your own keys. Off by default.</p>
      <div style="margin-top:8px">${providerForms}</div>
      <input class="field mono" id="aiCustomEndpoint" placeholder="Custom endpoint (e.g. http://localhost:11434/v1/chat/completions)" value="${esc(s.aiSettings.customEndpoint)}" style="width:100%;font-size:8.5px;margin-bottom:5px">
      <div class="row gap">
        <input class="field" id="aiFolder" value="${esc(s.aiSettings.folder)}" placeholder="report folder" style="font-size:9.5px">
        <select class="field" id="aiScrub">
          ${[["immediate", "scrub: after AI"], ["days3", "scrub: keep 3d"], ["manual", "scrub: manual"]].map(([v, l]) => `<option value="${v}" ${s.aiSettings.scrub === v ? "selected" : ""}>${l}</option>`).join("")}
        </select>
      </div>
      <label class="checkline" style="margin-top:7px"><input type="checkbox" id="aiAutoSave" ${s.aiSettings.autoSave ? "checked" : ""}> Auto-save markdown report after each round</label>
      <div class="row gap" style="margin-top:8px">
        <button class="btn flex1" data-action="saveAi">Save settings</button>
        <button class="btn flex1" data-action="askAi" id="askAiBtn">Ask the AIs now</button>
        <button class="btn ghost" data-action="saveReport">Report ↓</button>
      </div>
      ${aiNotes ? `<div style="margin-top:8px">${aiNotes}</div>` : `<p class="hint">Commentary is stored inside the review — clearing raw data can never erase it.</p>`}
    </div>

    <div class="card">
      <div class="row-between">
        <div><p style="font-size:11px;font-weight:600">Learned study reminder</p><p class="sub" style="margin-top:2px">Median completion − 15 min · escalates, then stops at day 7</p></div>
        <button class="switch ${s.habit.enabled ? "on" : ""}" data-action="toggleReminder" role="switch" aria-checked="${s.habit.enabled}"><span></span></button>
      </div>
      <div class="metric4">
        <div class="metric"><p>Streak</p><b>${s.habit.streak}</b></div>
        <div class="metric"><p>Last done</p><b>${s.habit.lastDone ? esc(dayLabel(s.habit.lastDone)) : "—"}</b></div>
        <div class="metric"><p>Missed</p><b>${s.habit.missed}</b></div>
        <div class="metric"><p>Next</p><b>${esc(s.habit.nextNudge)}</b></div>
      </div>
      <p class="hint">Silent after 21:00; a missed nudge still counts. A completed day is never nudged.</p>
    </div>

    <div class="card">
      <div class="row-between">
        <div><p style="font-size:11px;font-weight:600">Morning digest</p><p class="sub" style="margin-top:2px">One line after 08:00. Held if 36h stale.</p></div>
        <button class="switch ${s.digestEnabled ? "on" : ""}" data-action="toggleDigest" role="switch" aria-checked="${s.digestEnabled}"><span></span></button>
      </div>
    </div>

    <div class="card">
      <div class="row-between"><p class="label">Block-fire log</p><span class="mono dim" style="font-size:8px">last 25 kept</span></div>
      <div style="margin-top:8px">${logRows || '<p class="hint">Nothing has fired yet. When it does, the exact inputs land here.</p>'}</div>
    </div>

    <div class="card" style="border-color:rgba(251,113,133,0.16);background:rgba(244,63,94,0.04)">
      <p class="label">Clear history · analysis first</p>
      <p class="sub">Runs the catch-up review before deleting closed-day raw time. Today, reviews (+AI), hourly rhythm, active locks and verdicts survive.</p>
      <button class="btn w100 ${clearStep === 1 ? "armed" : clearStep === 2 ? "confirm-done" : ""}" data-action="clearHistory">
        ${clearStep === 0 ? "Clear closed-day history" : clearStep === 1 ? "Sure? Reviews are kept — confirm" : "✓ Cleared · raw closed days only"}
      </button>
      <p class="hint">Locked while only today's data exists.</p>
    </div>`;
}

/* ------------------------------ actions ----------------------------- */
view.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-action]");
  if (!el) return;
  const a = el.dataset.action;

  if (a === "setRange") { range = el.dataset.range; render(); }
  else if (a === "toggleSite") { openSite = openSite === el.dataset.domain ? null : el.dataset.domain; render(); }
  else if (a === "markDone") {
    if (state.habit.doneToday) { toast("Already marked done", "The streak is safe. Go do something unmeasured."); return; }
    await send({ type: "markDone" });
    await refresh();
    toast(`Day marked done · streak ${state.habit.streak}`, "Completion time saved. The next nudge learns from it.");
  }
  else if (a === "blockSite") {
    const domain = el.dataset.domain;
    if (isGuarded(domain)) { toast("Already locked", "Open the Blocks tab to see the term and the clock."); return; }
    const res = await send({ type: "addBlock", domain });
    if (!res.ok) { toast("Couldn't block", res.error); return; }
    await refresh();
    toast(`${domain} blocked`, "Effective immediately, seven days a week.");
  }
  else if (a === "forgetSite") {
    const domain = el.dataset.domain;
    await send({ type: "forgetSite", domain });
    openSite = null;
    await refresh();
    toast(`Forgot ${domain}`, "Raw minutes removed. Reviews keep their history.");
  }
  else if (a === "removeRule") {
    await send({ type: "removeRule", pattern: el.dataset.pattern });
    await refresh();
    toast("Rule deleted", "Seeded defaults stay deleted. Longest remaining pattern wins.");
  }
  else if (a === "lockedTry") {
    toast("Locked by policy", "Automatic blocks have no lift — in this popup or anywhere else. The clock decides.");
  }
  else if (a === "removeBlock") {
    const domain = el.dataset.domain;
    if (pendingRemove !== domain) {
      pendingRemove = domain;
      el.textContent = "Sure?";
      el.classList.add("armed");
      clearTimeout(removeTimer);
      removeTimer = setTimeout(() => { pendingRemove = null; render(); }, 4000);
      return;
    }
    pendingRemove = null;
    const res = await send({ type: "removeBlock", domain });
    if (!res.ok) { toast("Couldn't remove", res.error); return; }
    await refresh();
    toast(`${domain} guard removed`, "Two clicks, then a short undo window.", async () => {
      await send({ type: "addBlock", domain });
    });
  }
  else if (a === "removeChannel") {
    const handle = el.dataset.handle;
    await send({ type: "removeChannel", handle });
    await refresh();
    toast(`${handle} removed`, "Its videos return to your feeds.", async () => {
      await send({ type: "addChannel", handle });
    });
  }
  else if (a === "judge") {
    const res = await send({ type: "judgeChannel", channel: el.dataset.channel, verdict: el.dataset.verdict });
    if (!res.ok) { toast("Couldn't save verdict", res.error); return; }
    await refresh();
    toast(el.dataset.verdict === "useful" ? "Marked useful, forever" : "Marked useless, forever",
      el.dataset.verdict === "useful"
        ? "Shown in your YouTube feed now. Verdicts override keywords; 18+ stays blocked."
        : "Hidden from your YouTube feed now. Verdicts override keywords; 18+ stays blocked.");
  }
  else if (a === "ytfToggle") {
    const key = el.dataset.key;
    const turningOff = !!ytf[key];
    if (turningOff && pendingLoosen !== key) { armLoosen(key); return; } // loosening needs a 2nd click
    pendingLoosen = null;
    ytf = { ...ytf, [key]: !ytf[key] };
    await saveYtf(ytf);
    render();
    if (key === "smartFilter" && !ytf[key]) {
      toast("Classifier off", "Category filtering is off. Keyword mode still applies; 18+ stays hard-blocked.");
    } else {
      toast(ytf[key] ? "Protection on" : "Protection off", ytf[key] ? "Applies to open YouTube tabs right now." : "You can turn it back on any time — one click.");
    }
  }
  else if (a === "ytfMode") {
    const mode = el.dataset.mode;
    if (mode === ytf.mode) return;
    const loosening = YTF_MODE_RANK[mode] < YTF_MODE_RANK[ytf.mode];
    if (loosening && pendingLoosen !== "mode:" + mode) { armLoosen("mode:" + mode); return; }
    pendingLoosen = null;
    ytf = { ...ytf, mode };
    await saveYtf(ytf);
    render();
    toast(`Mode: ${mode === "strict" ? "Only useful" : mode}`, mode === "strict" ? "Only classifier-approved learning, memory, self-improvement, and Allowed keywords are shown." : mode === "balanced" ? "Junk and 18+ hidden; neutral videos stay." : "Keyword filtering is off. 18+ remains hard-blocked.");
  }
  else if (a === "ytfOptions") { chrome.runtime.openOptionsPage(); }
  else if (a === "toggleReminder") {
    await send({ type: "setReminder", enabled: !state.habit.enabled });
    await refresh();
    toast(state.habit.enabled ? "Reminders on" : "Reminders off", state.habit.enabled ? `Next nudge ${state.habit.nextNudge}, learned from your median.` : "No nudges until you turn them back on.");
  }
  else if (a === "toggleDigest") {
    await send({ type: "setDigest", enabled: !state.digestEnabled });
    await refresh();
  }
  else if (a === "toggleAi") {
    await saveAiSettings(!state.aiSettings.enabled);
    await refresh();
    toast(state.aiSettings.enabled ? "Cloud review on" : "Cloud review off",
      state.aiSettings.enabled ? "Numbers only. Your keys. Turn it off any time." : "Nothing will leave the machine.");
  }
  else if (a === "saveAi") {
    await saveAiSettings(state.aiSettings.enabled);
    await refresh();
    toast("AI settings saved", "Blank key fields keep their existing key.");
  }
  else if (a === "askAi") {
    if (!state.aiSettings.enabled) { toast("Cloud review is off", "Turn it on above first — numbers only, your keys."); return; }
    el.textContent = "Running…";
    el.disabled = true;
    await saveAiSettings(true);
    const res = await send({ type: "askAI" });
    await refresh();
    if (!res.ok) toast("AI round failed", res.error || "Check the provider key and model.");
    else toast("The AIs commented", "Stored inside the review, where a data clear can't erase it.");
  }
  else if (a === "saveReport") {
    const res = await send({ type: "saveReport" });
    if (res.ok) toast("Report saved", `Downloads/${res.filename}`);
    else toast("Couldn't save report", res.error || "");
  }
  else if (a === "clearHistory") {
    if (clearStep === 0) {
      clearStep = 1; render();
      setTimeout(() => { if (clearStep === 1) { clearStep = 0; render(); } }, 4000);
    } else if (clearStep === 1) {
      await send({ type: "clearHistory" });
      clearStep = 2;
      await refresh();
      toast("Closed days cleared · today kept", "Reviews, AI commentary and every active lock survived.");
      setTimeout(() => { clearStep = 0; render(); }, 3200);
    }
  }
});

view.addEventListener("change", async (e) => {
  if (e.target.id === "ytfQuery") {
    ytf = { ...ytf, queryPassMode: e.target.value };
    await saveYtf(ytf);
    toast("Search override updated", "Applies to your next YouTube search.");
  }
});

view.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (e.target.id === "ruleForm") {
    const res = await send({ type: "addRule", pattern: $("#rulePattern").value, kind: $("#ruleKind").value });
    if (!res.ok) { toast("Couldn't add rule", res.error); return; }
    await refresh();
    toast("Rule added", "Matched on-device. Longest pattern wins.");
  } else if (e.target.id === "blockForm") {
    const res = await send({ type: "addBlock", domain: $("#blockDomain").value });
    if (!res.ok) { toast("Couldn't block", res.error); return; }
    await refresh();
    toast("Site blocked", "Seven days a week — no Sunday toggle exists.");
  } else if (e.target.id === "channelForm") {
    const res = await send({ type: "addChannel", handle: $("#channelInput").value });
    if (!res.ok) { toast("Couldn't add channel", res.error); return; }
    await refresh();
    toast("Channel blocked", "Feed, search, Shorts and the channel page are covered.");
  }
});

async function saveAiSettings(enabled) {
  const active = {}, keys = {}, models = {};
  document.querySelectorAll("[data-ai-active]").forEach((i) => { active[i.dataset.aiActive] = i.checked; });
  document.querySelectorAll("[data-ai-key]").forEach((i) => { keys[i.dataset.aiKey] = i.value; });
  document.querySelectorAll("[data-ai-model]").forEach((i) => { models[i.dataset.aiModel] = i.value; });
  await send({
    type: "saveAiSettings",
    settings: {
      enabled, active, keys, models,
      customEndpoint: ($("#aiCustomEndpoint") || {}).value || "",
      folder: ($("#aiFolder") || {}).value || "focus-reports",
      scrub: ($("#aiScrub") || {}).value || "immediate",
      autoSave: !!($("#aiAutoSave") || {}).checked
    }
  });
}

/* ------------------------------- boot ------------------------------- */
refresh();
setInterval(() => {
  // don't clobber half-typed form input
  const focused = document.activeElement;
  if (focused && (focused.tagName === "INPUT" || focused.tagName === "SELECT") && view.contains(focused)) return;
  refresh();
}, 5000);
