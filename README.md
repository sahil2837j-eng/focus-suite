# Focus Suite 3.2 — Time Tracker + YouTube Focus + Content Classifier

**Focus Time Tracker (v1.8)** and **YouTube Focus (v1.1)** merged into a single
Manifest V3 extension with one popup, one YouTube content script, one keyword
brain — and the **2.0 block policy** carried through: every automatic block is
**exactly 24 hours**, enforced **7 days a week**, and the clock is the only unlock.
The Sunday exemption is deleted.

3.2 adds a local **Classifier Inspector** and **teachable channel verdicts**:
paste any title/channel/URL to see the category, confidence, scores, and exact
signals, and make the existing 👍/👎 channel marks show or hide that channel in
the YouTube feed. 3.1 added the **on-device content classifier** for education,
memory training, self-improvement, entertainment, and **18+**. The default
**Only useful** feed keeps learning and Allowed topics, hides entertainment,
and hard-blocks 18+ content. No video download, no model call, no network.

## Demo

<img src="assets/showcase.gif" alt="Focus Suite 3.2 showcase — Today, Sites and Blocks" width="100%">

*The 12-second tour: real popup, seeded local state, no network.*

<img src="assets/proof.gif" alt="Focus Suite 3.2 proof — the 24-hour automatic term and YouTube Focus" width="100%">

*The proof: the 24-hour automatic term and the YouTube Focus card, on the real popup.*

## Install (nothing to paste)

1. Unzip somewhere permanent (e.g. `~/extensions/focus-suite`). Icons are included.
2. `chrome://extensions` → **Developer mode** → **Load unpacked** → pick the folder.
3. Pin the clock icon.

### Switching over from the two old extensions

1. **Back up both folders** (`focus-tracker-backup-1.8.0`, `youtube-focus`).
2. **Disable (don't delete yet) YouTube Focus** on `chrome://extensions`, so two extensions
   don't both hide the same elements.
3. Load Focus Suite. If you are upgrading the *same folder* as Focus Tracker, replace its
   files and press **Reload** — migration is automatic (Sunday flags purged, 48h terms
   clamped to 24h, reviews/stats/rules/AI commentary kept).
4. Open YouTube once. Your old keyword lists aren't readable by another extension, so either
   keep the identical defaults or retype your custom ones in **Options** (or Import JSON).
5. After a few days, delete YouTube Focus for good.

## What merged, and how

| Concern | Tracker 1.8 | YouTube Focus 1.1 | Suite 3.2 |
|---|---|---|---|
| YouTube content scripts | analyzer + blocker | one script | **analyzer (playback) + `youtube-focus.js` (everything that changes the page)** |
| Hiding | channel videos | layout, Shorts, keywords | **one MutationObserver, one 140 ms pass, one `ytf-*` class namespace** |
| Video classification | hard-coded word lists | Allowed / Good / Blocked lists | **keyword lists + on-device categories; 18+ hard-blocked, useful-only feed by default** |
| Shorts | counted as waste, 20 min limit | blocked everywhere | **blocked by default; the 20-min limit remains the backstop if you switch blocking off** |
| Settings storage | `storage.local` | `storage.sync` | **both, by purpose:** data stays local; keyword lists + toggles sync; channel verdicts stay local |
| UI | 4-tab popup | toolbar popup + options | **4-tab popup (YouTube Focus card in Blocks) + keyword options page** |
| Block terms | 2 days | n/a | **24 h, 7/7, no lift** |
| Permissions | tabs, storage, alarms, idle, favicon, DNR, notifications, downloads | storage | union of both (YouTube Focus adds nothing new) |
| Tests | empty stubs | 62 browser checks | **35 engine + 33 classifier + 34 policy/merge checks, plain Node** |

## YouTube Focus (all on-device)

- **Home** feed hidden (replaced by a "search for what you actually need" note); masthead ads hidden.
- **Sidebar/related**, chip cloud, end screens, pause overlay, autoplay countdown, miniplayer hidden.
- **Shorts** blocked: nav, shelves, cards, channel tab, `/shorts/…` pages; links are intercepted in the capture phase so the player never loads.
- **Keyword filtering** in **Off / Balanced / Only useful** on every video list.
- **On-device content classifier** — reads the video title, channel, and URL, then tags each
  tile as `education`, `memory_cognitive`, `self_improvement`, `entertainment`,
  `adult_18plus`, or `unknown`. Education, memory, and self-improvement pass; entertainment is
  hidden in Balanced and Only useful; unknown is hidden only in Only useful. The toggle lives in
  the YouTube Focus card and Options.
- **Teachable channel verdicts** — the existing 👍/👎 marks on watched channels now affect the
  feed immediately. A **useful** channel is shown even when the classifier would hide it; a
  **useless** channel is hidden even when a keyword would allow it. 18+, blocked channels, and
  Shorts still win. Verdicts persist in `storage.local` and update open tabs.
- **Classifier inspector** — Options has a local test bench with presets for memory, MIT,
  Huberman, GTA fails, Shorts, 18+, and neutral content. It shows the category, confidence,
  five score meters, exact signals, density, short-form detection, and whether the current mode
  would show or hide the item. No network request.
- **18+ hard block** — adult tiles are never revealable, a `/watch` page flagged as 18+ gets a
  full-page local shield, and known adult domains are blocked at the network layer by
  `declarativeNetRequest`. Turning the classifier off does **not** disable the 18+ block.
- **Search override** — a query that matches the right list skips filtering for that results page
  (`Allowed + good` · `Allowed only` · `Never`, plus *keep hiding hard-blocked keywords*).
- **Reveal pill** on results: "🚫 N videos hidden · M 18+ blocked — click to show".
- **Promos** (sponsored modules, merch, engagement-panel ads) hidden.

Matching rules (`yt-engine.js`): case-insensitive · left word boundary only (`focus` matches
"focusing", `art` does not match "smart") · multi-word keywords match spaces or hyphens ·
input is regex-escaped (`18+`, `c++`, `node.js`) · **Allowed always wins over Blocked** ·
**channel verdicts override keyword lists**; 18+, blocked channels, and Shorts still win.

## Focus Tracker (all local)

Honest time tracking (focused window, idle-aware, sleep gaps dropped) · nightly reviews with
catch-up · **locked 24h auto-detox** · **40/20 YouTube guard (24h)** · channel blocking ·
path-level study rules + 5–8 PM goal · learned study reminder · analysis-first clear history ·
block-fire log with exact inputs · opt-in numbers-only cloud AI review.

## New in 3.2

- **Classifier Inspector** — `options.html` now loads `content-classifier.js` and offers a local
  test bench. Presets cover memory, MIT algorithms, Huberman focus, GTA fails, a prank Short,
  18+, and neutral content. Results include the category, confidence, all five scores, exact
  signals, density, short-form detection, and the current show/hide verdict.
- **Teachable channel verdicts** — `youtube-focus.js` now reads `channelVerdicts` from
  `chrome.storage.local`. The popup's existing 👍/👎 buttons therefore change the feed
  immediately, not just the tracker's waste count. Adult, blocked-channel, and Shorts hard blocks
  remain first.
- **How it decides** — a compact five-layer explainer sits inside the inspector so the local
  heuristic is inspectable instead of opaque.
- **More tests** — 5 new classifier preset checks and 6 new policy/merge checks.

## New in 3.1

- **Content classifier** — `content-classifier.js` is DOM-free and network-free. It runs in the
  YouTube content script, the service worker, and Node tests. It classifies education, memory,
  self-improvement, entertainment, unknown, and 18+ material.
- **Useful-only default** — fresh installs start in **Only useful** mode with the classifier on.
  Existing users keep their saved mode; the classifier toggle is additive.
- **18+ shield** — 18+ tiles are hard-hidden, adult watch pages get a local block screen, and a
  permanent adult-domain DNR list runs alongside your editable guards.
- **Classifier-aware tracking** — watched education/memory counts as educational, self-improvement
  as passive, entertainment as waste, and 18+ as a separate `adult` bucket that counts toward the
  40-minute entertainment term. The popup shows "18+ blocked" separately.
- **Shielded today** — a numbers-only counter ("12 videos hidden · 3 Shorts blocked · 1 18+ blocked")
  on the Today tab.
- **Friction on loosening** — turning off a protection or lowering the mode needs a second click
  within 4 seconds; removing Blocked keywords asks for confirmation. Tightening is always one click.
- **First-paint cache** — YouTube Focus settings are cached in `localStorage` (`__ytf_state_v1`)
  so pages render already clean. Deletable any time.
- **Export / import** of keyword settings as JSON.

## Files

| File | Role |
|---|---|
| `manifest.json` | MV3 · Chrome 110+ · options page · 2 YouTube content-script entries |
| `background.js` | Service worker: tracking, 24h locks, reviews, reminder, AI, adult-domain DNR rules |
| `popup.html/css/js` | The 4-tab popup (YouTube Focus card + classifier toggle live in **Blocks**) |
| `options.html/js` | Keyword lists, classifier toggle, local Classifier Inspector, five-layer explainer, export/import |
| `yt-defaults.js` | Default settings + keyword lists (shared everywhere) |
| `yt-engine.js` | Pure, DOM-free keyword engine (shared everywhere, Node-testable) |
| `content-classifier.js` | Pure, DOM-free education / memory / self-improvement / entertainment / 18+ classifier |
| `youtube-focus.js` / `.css` | Page-changing content script: layout, Shorts, keywords, classifier tiles, 18+ watch shield |
| `youtube-analyzer.js` | Real-playback reporting every 15 s |
| `make_icons.py` | Regenerates `icons/` (pure stdlib) |
| `tests/` | `engine.test.js` (35) · `classifier.test.js` (33) · `policy.test.js` (34) — `node tests/…` |

## Known limits (honest list)

- YouTube changes its markup often. The selectors in `youtube-focus.css` / `.js` were written from
  the documented behaviour of YouTube Focus 1.1 and are the first place to look if something stops hiding.
- Settings can't be migrated automatically from the old YouTube Focus (another extension's storage
  isn't readable) — use the defaults, retype, or Import JSON.
- The classifier is a transparent keyword/domain heuristic, not a full video-understanding model.
  It can miss sarcasm, non-English titles, and deliberately vague adult content, and it can flag a
  health/education page that uses explicit vocabulary. The Allowed list is the escape hatch for
  false positives; 18+ has no reveal button.
- The network-level 18+ shield covers the curated `ADULT_DOMAINS` list. A brand-new adult domain
  not on the list is handled only by the title/channel classifier when it appears on YouTube.
- Channel verdicts filter the YouTube feed; they do not block a direct `/watch` URL. Blocked
  channels and 18+ still do.
- Firefox is not part of 3.2: the service-worker background model differs. Planned for a later release.

## Origin

The classifier and inspector were extracted from the standalone
`build-content-classification-feature` prototype. Its Next.js dashboard, Postgres
schema, swap bank, challenge gate, and API are **not** part of Focus Suite and
were not carried over. The portable pieces are `content-classifier.js`, the
Options inspector, and the five-layer explainer; everything else stays local to
the extension.

## Privacy

No account, no server, no telemetry. The classifier is entirely local: it reads the title, channel,
and URL already present in the page, and never downloads or uploads video. Tracker data is in
`chrome.storage.local`; YouTube Focus settings in `chrome.storage.sync` (your own Chrome profile).
The only network path is the optional AI round you configure yourself — numbers only.
