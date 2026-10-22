/* Focus Suite 3.0 — yt-defaults.js
   Default YouTube Focus settings + keyword lists. Assigned to globalThis so
   it is safe if injected twice, and shared by: the content script, the
   service worker (importScripts), the popup and the options page. */
(function (root) {
  "use strict";
  root.FOCUS_DEFAULTS = {
    settings: {
      hideHomeRecs: true,
      hideSidebar: true,
      blockShorts: true,
      mode: "balanced", // off | balanced | strict
      queryPassMode: "allowed+good", // allowed+good | allowed | never
      queryPassStillBlocks: false
    },
    // Always shown. Keeps Pakistani dramas working; also the escape hatch for false positives.
    allowed: [
      "drama", "pakistani drama", "pak drama", "pakistani serial", "geo entertainment",
      "geo tv", "geo har pal", "ary digital", "hum tv", "green entertainment",
      "ary digital hd", "failsafe", "chain reaction", "chemical reaction"
    ],
    // Strict mode shows only these (plus Allowed).
    good: [
      "self improvement", "improve", "improvement", "discipline", "focus", "focused",
      "productivity", "productive", "habit", "motivation", "routine", "coding", "programming",
      "software", "developer", "python", "javascript", "art", "artist", "artistic", "drawing",
      "painting", "sketch", "design", "book", "books", "reading", "study", "studying", "learn",
      "tutorial", "course", "lecture", "documentation"
    ],
    // Hidden in Balanced and Strict.
    blocked: [
      "hentai", "porn", "xxx", "nsfw", "18+", "sexy", "erotic", "nude", "naked", "onlyfans",
      "funny", "funnier", "funniest", "comedy", "comedian", "stand-up", "prank", "joke", "troll",
      "meme", "fail", "roast", "reaction", "gossip", "celebrity", "celebrities", "cringe",
      "tiktok", "clickbait"
    ]
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
