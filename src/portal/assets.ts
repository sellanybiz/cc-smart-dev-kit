/**
 * What the portal's pages are made of: one stylesheet, and the browser scripts.
 *
 * Both are served from the portal itself (`/assets/…`), never from the internet, because the
 * Content-Security-Policy allows this machine and nothing else: no web font, no CDN. The
 * type is a local stack — the same shapes the design uses, from what a Linux or macOS
 * desktop already has.
 *
 * Dark is the default. `theme.js` is loaded in the head, before anything is painted, so a
 * person who chose light never sees a dark flash; the choice lives in `localStorage`, in a
 * `try` block, because a browser with storage switched off must still get a working page.
 */

/** The colour tokens, and every rule the pages use. */
export const PORTAL_CSS = `:root {
  color-scheme: dark;
  --bg: #14161a;
  --surface: #1b1e24;
  --surface-2: #21252b;
  --text: #e8e9ea;
  --muted: #9ba1aa;
  --muted-2: #c3c7cd;
  --line: #2e333a;
  --line-soft: #262b31;
  --accent: #7fa8f0;
  --accent-strong: #a9c6f7;
  --accent-ink: #10131a;
  --chip-bg: #1d2a44;
  --chip-line: #7fa8f0;
  --ok: #8fe3ac;
  --warn: #e9b57c;
  --bad: #f28f7e;
  --warn-bg: #2a1f16;
  --warn-line: #6b4a2a;
  --warn-soft: #3a2a18;
  --warn-text: #f0b37e;
  --warn-strong: #e08a4a;
  --dashed: #4a5058;
  --disabled-bg: #262b31;
  --disabled-line: #343a42;
  --disabled-text: #8a9098;
  --code-bg: #0e1013;
  --code-text: #e8e9ea;
  --code-line: #444a52;
  --code-btn: #22262c;
  --bar-bg: #2e333a;
  --bar-fill: #7fa8f0;
  --bar-2: #4f7bcb;
  --bar-warn-bg: #3a2a18;
  --bar-warn: #e09a5a;
  --focus: #a9c6f7;
}
:root[data-theme="light"] {
  color-scheme: light;
  --bg: #f4f4f1;
  --surface: #ffffff;
  --surface-2: #f7f7f4;
  --text: #1c1d1f;
  --muted: #565961;
  --muted-2: #3a3c40;
  --line: #dad9d3;
  --line-soft: #e6e5e0;
  --accent: #1e4fa8;
  --accent-strong: #163b7e;
  --accent-ink: #ffffff;
  --chip-bg: #e3ebf8;
  --chip-line: #1e4fa8;
  --ok: #0f5c34;
  --warn: #a65a00;
  --bad: #b3261e;
  --warn-bg: #fff8f1;
  --warn-line: #e9b98e;
  --warn-soft: #fcead8;
  --warn-text: #8f4108;
  --warn-strong: #c9611a;
  --dashed: #a9a8a1;
  --disabled-bg: #e6e5e0;
  --disabled-line: #d4d3cc;
  --disabled-text: #5e6166;
  --code-bg: #1c1d1f;
  --code-text: #f4f4f1;
  --code-line: #5e6166;
  --code-btn: #2a2b2e;
  --bar-bg: #e6e5e0;
  --bar-fill: #1e4fa8;
  --bar-2: #4f7bcb;
  --bar-warn-bg: #f1ddcb;
  --bar-warn: #d9741c;
  --focus: #1e4fa8;
}
* { box-sizing: border-box; }
/* A hidden element is hidden, whatever its class says: a class with display flex beats the
   browser's own hidden rule otherwise, and a box that should be closed stays open. */
[hidden] { display: none !important; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: "IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif;
  font-size: 15px;
  line-height: 1.5;
}
a { color: var(--accent); }
a:hover { color: var(--accent-strong); }
button, input, select { font: inherit; }
:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
code, .mono, .num { font-family: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace; }
.num { font-variant-numeric: tabular-nums; }
h1 { margin: 0; font-size: 28px; line-height: 1.2; font-weight: 600; }
h2 { margin: 0; font-size: 18px; font-weight: 600; }
h3 { margin: 0; font-size: 15px; font-weight: 600; color: var(--muted-2); }
p { margin: 0; }
.wrap { max-width: 1200px; margin: 0 auto; padding: 0 24px; }
.muted { color: var(--muted); }
.small { font-size: 13px; }
.row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.row-wide { display: flex; flex-wrap: wrap; align-items: center; gap: 12px 20px; }
.spread { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 12px; }
.grow { flex: 1 1 auto; }
.wrap-any { overflow-wrap: anywhere; }

/* ── Header ─────────────────────────────────────────────────────────────── */
header.top { background: var(--surface); border-bottom: 1px solid var(--line); }
header.top .wrap {
  display: flex; flex-wrap: wrap; align-items: center; gap: 10px 16px; padding-top: 10px; padding-bottom: 10px;
}
.brand { display: flex; align-items: center; gap: 10px; }
.brand .name { font-family: "JetBrains Mono", ui-monospace, monospace; font-weight: 600; font-size: 16px; }
.brand .ver { color: var(--muted); font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 13px; }
nav.pages { display: flex; flex-wrap: wrap; gap: 2px; margin-left: auto; }
nav.pages a {
  display: inline-flex; align-items: center; min-height: 44px; padding: 0 10px;
  border-radius: 8px; color: var(--text); text-decoration: none;
}
nav.pages a[aria-current="page"] { background: var(--chip-bg); color: var(--accent-strong); font-weight: 600; }
.pill {
  display: inline-flex; align-items: center; gap: 6px; padding: 4px 8px; border-radius: 999px;
  font-size: 13px;
}
.pill.ok { background: var(--chip-bg); color: var(--accent); font-weight: 500; }
.pill.plain { background: var(--line-soft); color: var(--muted-2); font-family: "JetBrains Mono", ui-monospace, monospace; }
.pill.bad { background: var(--warn-soft); color: var(--warn-text); font-weight: 600; }
.themebtn {
  display: inline-flex; align-items: center; gap: 8px; min-height: 44px; padding: 0 10px;
  border: 1px solid var(--line); border-radius: 8px; background: var(--surface); color: var(--text);
  cursor: pointer;
}
/* ── The header at a desktop width ────────────────────────────────────────
   Brand, the two chips, the page links and the theme toggle sit on ONE row, at every width
   this block covers. They are a grid, and the links take the free column, so the toggle can
   never be pushed onto a line of its own — which is what a wrapping flex row did once the nav
   grew its sixth item: measured at 1440, the four groups and their three gaps came to about
   1206px in a 1152px wrap, and the toggle went alone to the next line (the owner's screenshot,
   040-settings-1440-dark.png). The links' padding and the columns' gap are a little tighter
   for the same reason; the 44px touch target is the links' height, and it does not change.
   Narrower than this the links wrap inside their own column, and the toggle stays in the row. */
@media (min-width: 641px) {
  header.top .wrap {
    display: grid; align-items: center; column-gap: 16px;
    grid-template-columns: auto auto minmax(0, 1fr) auto;
  }
  nav.pages { margin-left: 0; justify-content: flex-end; }
}
/* ── The header on a phone ────────────────────────────────────────────────
   Every row above is a flex row that wraps, so at 390px the brand, the router chip, the Bun
   chip, the links and the theme toggle each took a line (about 280px before the page). Here
   they become three rows: the brand and the theme toggle, the two chips, then the five links
   in equal columns — 44px tall each, the touch target size kept. The order is the CSS order
   property, so the desktop layout (and its own order) never changes. */
@media (max-width: 640px) {
  header.top .wrap { gap: 8px 12px; }
  .brand { order: 1; }
  .theme { order: 2; margin-left: auto; }
  .chips { order: 3; width: 100%; }
  nav.pages {
    order: 4; width: 100%; margin-left: 0; display: grid; gap: 4px;
    /* As many columns as the width allows, 96px each: five links (Settings included) fit
       two rows on a phone, and every one keeps its 44px touch target. */
    grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
  }
  nav.pages a { justify-content: center; padding: 0 6px; }
}
.privatebar { background: var(--code-bg); color: var(--code-text); }
.privatebar .wrap {
  display: flex; flex-wrap: wrap; align-items: center; gap: 6px 20px;
  padding-top: 8px; padding-bottom: 8px; font-size: 13px;
}
.privatebar span { display: inline-flex; align-items: center; gap: 6px; }

/* ── Layout ─────────────────────────────────────────────────────────────── */
/* main carries the wrap class too, and that class's padding rule beat the element rule
   below, so the page head sat right under the privacy strip. Qualified, this one wins. */
main.wrap { display: flex; flex-direction: column; gap: 28px; padding-top: 32px; padding-bottom: 48px; }
section { display: flex; flex-direction: column; gap: 12px; }
.pagehead { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 12px; }
.pagehead p { margin-top: 6px; color: var(--muted); }
.grid { display: grid; gap: 24px; align-items: start; }
.grid.two { grid-template-columns: repeat(auto-fit, minmax(min(460px, 100%), 1fr)); }
.grid.cards { grid-template-columns: repeat(auto-fit, minmax(min(380px, 100%), 1fr)); }
.grid.stats { grid-template-columns: repeat(auto-fit, minmax(min(220px, 100%), 1fr)); }

.card { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; }
.card.pad { padding: 20px; display: flex; flex-direction: column; gap: 14px; }
.card.warn { background: var(--warn-bg); border-color: var(--warn-line); }
.card.bad { background: var(--surface); border: 2px solid var(--warn-strong); padding: 24px; display: flex; flex-direction: column; gap: 14px; }
.card.list > * { padding: 16px 20px; border-bottom: 1px solid var(--line-soft); }
.card.list > *:last-child { border-bottom: 0; }
.card .foot {
  padding: 12px 20px; background: var(--surface-2); border-top: 1px solid var(--line-soft);
  font-size: 14px; color: var(--muted-2);
}
.stat { display: flex; flex-direction: column; gap: 2px; padding: 16px 20px; }
.stat .label { font-size: 14px; color: var(--muted); }
.stat .value { font-size: 28px; font-weight: 600; }
.stat.warn { background: var(--warn-bg); border: 1px solid var(--warn-line); border-radius: 12px; }
.stat.warn .label, .stat.warn .note { color: var(--warn-text); }
.stat.warn .value { color: var(--warn-text); }

/* ── Buttons ────────────────────────────────────────────────────────────── */
.btn {
  display: inline-flex; align-items: center; gap: 8px; min-height: 44px; padding: 0 16px;
  border: 1px solid var(--line); border-radius: 8px; background: var(--surface); color: var(--text);
  font-weight: 500; text-decoration: none; cursor: pointer;
}
.btn.primary { border-color: var(--accent); color: var(--accent); font-weight: 600; }
.btn.strong { border-color: var(--accent); background: var(--accent); color: var(--accent-ink); font-weight: 600; }
.btn.danger { border-color: var(--warn-line); color: var(--warn-text); font-weight: 600; }
.btn[disabled] { border-color: var(--disabled-line); background: var(--disabled-bg); color: var(--disabled-text); cursor: not-allowed; }
.btn.icon { min-width: 44px; padding: 0; justify-content: center; }
.switch {
  flex: none; display: inline-flex; align-items: center; gap: 10px; min-height: 44px; padding: 0 12px;
  border: 1px solid var(--dashed); border-radius: 999px; background: var(--surface);
  color: var(--muted-2); font-weight: 600; cursor: pointer;
}
.switch[aria-checked="true"] { border-color: var(--chip-line); background: var(--chip-bg); color: var(--accent-strong); }
.switch .track {
  display: inline-flex; justify-content: flex-start; width: 36px; height: 20px; padding: 2px;
  border-radius: 999px; background: var(--dashed);
}
.switch[aria-checked="true"] .track { justify-content: flex-end; background: var(--accent); }
.switch .knob { width: 16px; height: 16px; border-radius: 999px; background: var(--surface); }
:root[data-theme="light"] .switch[aria-checked="true"] .knob { background: #ffffff; }

/* ── Chips, marks, tags ─────────────────────────────────────────────────── */
.chip {
  display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border: 1px solid var(--line);
  border-radius: 6px; background: var(--surface-2); font-family: "JetBrains Mono", ui-monospace, monospace;
  font-size: 13px;
}
.chip.on { border-color: var(--chip-line); background: var(--chip-bg); color: var(--accent-strong); }
.chip.warn { border-color: var(--warn-line); background: var(--warn-soft); color: var(--warn-text); }
.chip.dashed { border-style: dashed; border-color: var(--dashed); }
.arrow { color: var(--muted); }
.ok { color: var(--ok); font-weight: 600; }
.warnmark { color: var(--warn); font-weight: 600; }
.badmark { color: var(--bad); font-weight: 600; }
.tag {
  display: inline-flex; align-items: center; padding: 4px 10px; border-radius: 999px;
  background: var(--warn-soft); color: var(--warn-text); font-weight: 600; font-size: 14px;
}
.note { font-size: 14px; color: var(--muted); }
.notice {
  display: flex; align-items: flex-start; gap: 10px; padding: 12px 16px; border-radius: 10px;
  background: var(--warn-bg); border: 1px solid var(--warn-line); color: var(--warn-text); font-size: 14px;
}
.notice.plain { background: var(--surface-2); border-color: var(--line); color: var(--muted-2); }
.confirmbox {
  display: flex; flex-direction: column; gap: 12px; padding: 16px;
  border: 2px solid var(--accent); border-radius: 10px; background: var(--chip-bg);
  color: var(--accent-strong);
}
.status-ok { border-radius: 10px; background: var(--chip-bg); color: var(--accent-strong); padding: 12px 16px; font-weight: 500; }
.status-bad { border-radius: 10px; background: var(--warn-soft); color: var(--warn-text); padding: 12px 16px; font-weight: 500; }
/* A fact, not an alarm: the token field's "nothing was pasted" answer, and the like. */
.status-info { border-radius: 10px; background: var(--surface-2); color: var(--muted-2); padding: 12px 16px; font-weight: 500; }
/* An answer box with nothing in it is not there at all: no padding of its own, and no gap in
   a card's column either. Every card carried an empty band (and a card list an empty row)
   until the script filled one. */
[data-out-for]:empty, [data-out]:empty { display: none; }
/* The box gone, the row above it is the card's last one: no separator at the card's edge. */
.card.list > *:has(+ .foot:empty) { border-bottom: 0; }

/* ── Code and commands ──────────────────────────────────────────────────── */
.cmd {
  display: flex; flex-wrap: wrap; align-items: center; gap: 8px; padding: 10px 12px;
  border-radius: 8px; background: var(--code-bg); color: var(--code-text);
}
.cmd code { flex: 1 1 240px; font-size: 13px; overflow-wrap: anywhere; }
.cmd button {
  display: inline-flex; align-items: center; gap: 6px; min-height: 44px; padding: 0 12px;
  border: 1px solid var(--code-line); border-radius: 8px; background: var(--code-btn);
  color: var(--code-text); cursor: pointer;
}

/* ── Tables, chains, logs ───────────────────────────────────────────────── */
.table { overflow-x: auto; border: 1px solid var(--line-soft); border-radius: 10px; }
.table .inner { min-width: 760px; display: flex; flex-direction: column; }
.table .head, .table .rowline {
  display: grid; gap: 12px; align-items: center; padding: 10px 16px;
}
.table .head { background: var(--surface-2); border-bottom: 1px solid var(--line-soft); font-size: 13px; font-weight: 600; color: var(--muted-2); }
.table .rowline { border-bottom: 1px solid var(--line-soft); font-size: 14px; }
.table .rowline:last-child { border-bottom: 0; }
.cols-models { grid-template-columns: minmax(250px, 2.4fr) minmax(120px, 1fr) 100px 160px; }
.cols-log { grid-template-columns: 84px 64px 1fr; font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 13px; }
.logline { padding: 6px 16px; display: grid; gap: 14px; }
.logline.warn { background: var(--warn-soft); color: var(--warn-text); }
.chain { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.chain li {
  display: flex; flex-wrap: wrap; align-items: center; gap: 12px 16px; padding: 12px 16px;
  border: 1px solid var(--line); border-radius: 10px; background: var(--surface);
}
.chain li.bad { border: 2px solid var(--warn-strong); background: var(--warn-bg); }
.chain .n {
  flex: none; width: 28px; height: 28px; border-radius: 999px; background: var(--line-soft);
  display: inline-flex; align-items: center; justify-content: center; font-weight: 600; font-size: 14px;
}
.chain .who { flex: 1 1 260px; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.chain .what { flex: 1 1 300px; min-width: 0; font-size: 14px; }
.slotpicks { display: flex; flex-wrap: wrap; gap: 8px; }
.slotpick {
  display: inline-flex; flex-direction: column; align-items: flex-start; min-height: 44px;
  min-width: 120px; padding: 8px 14px; border-radius: 10px; cursor: pointer; text-align: left;
  border: 1px solid var(--line); background: var(--surface); color: var(--text);
}
.slotpick[aria-pressed="true"] { border: 2px solid var(--accent); background: var(--chip-bg); color: var(--accent-strong); font-weight: 600; }
.slotpick span:last-child { font-size: 12px; color: var(--muted); }

/* ── Bars and meters ────────────────────────────────────────────────────── */
.meter { position: relative; height: 12px; border-radius: 999px; background: var(--bar-bg); }
.meter .fill { height: 12px; border-radius: 999px; background: var(--bar-fill); }
.meter .fill.warn { background: var(--bar-warn); }
.meter.warn { background: var(--bar-warn-bg); }
.meter .mark { position: absolute; top: -4px; width: 2px; height: 20px; background: var(--warn-text); }
.stack { display: flex; height: 14px; border-radius: 999px; overflow: hidden; background: var(--bar-bg); gap: 2px; }
.stack .a { background: var(--bar-fill); }
.stack .b { background: var(--bar-2); }

/* ── Lists ──────────────────────────────────────────────────────────────── */
.checks { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px 24px; grid-template-columns: repeat(auto-fit, minmax(min(460px, 100%), 1fr)); }
/* The mark's own column, and a text column that may shrink to nothing: a long path (a Chrome
   profile folder, a backend URL) wraps inside its box and can never widen the box past its
   column, or overlap the column beside it. */
.checks li { display: grid; grid-template-columns: 16px minmax(0, 1fr); gap: 0 10px; align-items: start; padding: 6px 0; }
.checks li.fail { padding: 6px 10px; margin: 0 -10px; border-radius: 8px; background: var(--warn-soft); color: var(--warn-text); }
.checks .mark { width: 16px; font-weight: 700; }
.kv { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(150px, 100%), 1fr)); gap: 12px; }
.kv .item { display: flex; flex-direction: column; }
.kv .label { font-size: 13px; color: var(--muted); }
.kv .value { font-weight: 600; }
.tile {
  display: flex; flex-direction: column; gap: 4px; padding: 16px 20px; min-height: 44px;
  background: var(--surface); border: 1px solid var(--line); border-radius: 12px;
  color: var(--text); text-decoration: none;
}
.tile b { color: var(--accent); font-weight: 600; }
footer.bottom { border-top: 1px solid var(--line); background: var(--surface); }
footer.bottom .wrap {
  display: flex; flex-wrap: wrap; gap: 6px 24px; padding-top: 16px; padding-bottom: 16px;
  font-size: 13px; color: var(--muted);
}
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

/* ── Layout helpers ──────────────────────────────────────────────────────
   The policy allows no style attribute in the markup, so every small layout choice is a
   class here. They say one thing each, and a page's own look stays in the rules above. */
.col { display: flex; flex-direction: column; }
.col.g4 { gap: 4px; }
.col.g2 { gap: 2px; }
.col.g8 { gap: 8px; }
.w140 { width: 140px; }
/* A small basis, so a long line shrinks instead of pushing the control beside it down. */
.fill1 { flex: 1 1 200px; min-width: 0; }
.flex1 { flex: 1 1 160px; }
.tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(260px, 100%), 1fr)); gap: 16px; }
.end { justify-content: flex-end; }
.scrollx { overflow-x: auto; }
.minw520 { min-width: 520px; }
.minw760 { min-width: 760px; }
.h1sm { font-size: 24px; }
.h2sm { font-size: 15px; }
.warncolor { color: var(--warn-text); }
.search {
  min-height: 44px; width: 240px; max-width: 100%; padding: 0 12px;
  border: 1px solid var(--line); border-radius: 8px; background: var(--surface); color: var(--text);
}
.bold { font-weight: 600; }
.tap { min-height: 44px; }
.warnrow { display: grid; grid-template-columns: 84px 64px 1fr; gap: 12px; align-items: center; }
.footnote { padding: 12px 20px; font-size: 14px; }

/* ── The Settings page, and the Project card ─────────────────────────────
   One row per setting: the words, the control, and the tag saying where the value comes
   from. The three tag words are the design's own: yours, this project, default. */
.setrow { display: flex; flex-wrap: wrap; align-items: center; gap: 12px 16px; }
.src { flex: none; padding: 4px 10px; border-radius: 999px; font-size: 13px; font-weight: 500; }
/* The link to the Project card, under a row the project sets: a touch target of its own, not
   a 20px line of text under a switch. */
.setrow .projectlink { display: inline-flex; align-items: center; min-height: 44px; }
.src.personal { background: var(--chip-bg); color: var(--accent); }
.src.project { background: var(--warn-soft); color: var(--warn-text); }
.src.default { background: var(--line-soft); color: var(--muted-2); }
.rulebox {
  display: flex; align-items: flex-start; gap: 10px; flex-basis: 100%;
  padding: 10px 12px; border: 1px solid var(--warn-line); border-radius: 8px;
  background: var(--warn-bg); color: var(--warn-text); font-size: 14px;
}
.ruleicon { display: inline-flex; flex: none; margin-top: 2px; }
/* The module's own answer for this project, on its own line under the rule. */
.rulemore { display: block; margin-top: 4px; }
.segment {
  display: inline-flex; flex-wrap: wrap; gap: 4px; padding: 4px;
  border: 1px solid var(--line); border-radius: 10px; background: var(--surface-2);
}
.segment button {
  display: inline-flex; align-items: center; min-height: 44px; padding: 0 14px;
  border: 1px solid transparent; border-radius: 8px; background: transparent;
  color: var(--muted-2); font-weight: 500; cursor: pointer;
}
.segment button[aria-pressed="true"] {
  border-color: var(--accent); background: var(--chip-bg); color: var(--accent-strong); font-weight: 600;
}
.segment button[disabled] { color: var(--disabled-text); cursor: not-allowed; }
.segment button[aria-pressed="true"][disabled] {
  border-color: var(--dashed); background: var(--disabled-bg); color: var(--muted-2);
}
.events label { display: inline-flex; align-items: center; gap: 8px; min-height: 44px; font-size: 14px; }
.events input { width: 18px; height: 18px; accent-color: var(--accent); }
.numrow { gap: 8px; }
.numinput {
  min-height: 44px; width: 96px; padding: 0 12px; border: 1px solid var(--line); border-radius: 8px;
  background: var(--surface); color: var(--text);
  font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 14px; text-align: right;
}
.switch[disabled] {
  border-color: var(--disabled-line); background: var(--disabled-bg); color: var(--disabled-text);
  cursor: not-allowed;
}
.switch[disabled] .track { background: var(--disabled-text); }
.note {
  padding: 12px 16px; border: 1px solid var(--line-soft); border-radius: 10px;
  background: var(--surface-2); font-size: 14px; color: var(--muted-2);
}

/* ── The Project card's form ───────────────────────────────────────────── */
.fields { display: flex; flex-wrap: wrap; gap: 16px; }
.field { flex: 1 1 240px; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.field label { font-size: 13px; font-weight: 500; }
.field input, .chipinput {
  min-height: 44px; padding: 0 12px; border: 1px solid var(--line); border-radius: 8px;
  background: var(--surface); color: var(--text);
  font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 13px;
}
.field input { width: 100%; font-size: 14px; }
.baserow { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 12px; }
.chipinput { width: 150px; }
.lockchip { gap: 6px; min-height: 44px; padding: 0 4px 0 10px; }
.lockchip .chipinput { width: 120px; border: 0; background: transparent; padding: 0 4px; }
/* 44 x 44 like every other icon button (the .btn.icon rule): the protected branch's ✕
   was 36 wide. */
.lockchip .btn.icon { border: 0; background: transparent; }
.btn.dashed { border-style: dashed; border-color: var(--dashed); color: var(--muted-2); font-weight: 500; }
/* min-width: 0: the box sits in a column, and its pre scrolls on its own line rather than
   widening the column it is in. */
.codebox { border: 1px solid var(--line-soft); border-radius: 10px; overflow: hidden; min-width: 0; }
.codehead {
  display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 10px;
  padding: 6px 6px 6px 14px; background: var(--surface-2); border-bottom: 1px solid var(--line-soft);
}
/* A box with no file name of its own is one row: the code, then its Copy button on the code's
   own background, not a head of its own with nothing in it but the button. */
.codebox.oneline { display: flex; align-items: center; background: var(--code-bg); }
.codebox.oneline pre { flex: 1 1 auto; min-width: 0; }
.codebox.oneline .codehead { order: 2; flex: none; padding: 0 6px; background: transparent; border-bottom: 0; }
/* On a phone the button would take the code's width and cut even a short command: the code
   keeps the whole row and the button goes under it, at the right. */
@media (max-width: 640px) {
  .codebox.oneline { flex-wrap: wrap; }
  .codebox.oneline pre { flex-basis: 100%; padding: 14px 10px; }
  .codebox.oneline .codehead { width: 100%; justify-content: flex-end; padding: 0 6px 6px; }
}
.codehead code { font-size: 13px; }

/* ── The Browser card's five steps ────────────────────────────────────────
   A real ordered list: one column, numbered, each step's sentence first and then the address
   or command it needs, in a code box of its own. Never the doctor's own .checks grid: read as
   columns the steps went left, right, left, right, they carried no numbers, and the narrow
   column squeezed the last one ("Save it.", "✓ done") into a sliver. The long address stays
   one line and scrolls inside its box instead of breaking in the middle of a word. */
ol.guide { margin: 0; padding-left: 26px; }
ol.guide > li { padding-left: 2px; }
ol.guide > li + li { margin-top: 14px; }
ol.guide > li > span { display: block; }
ol.guide .codebox { margin-top: 8px; }
.codehead .btn { min-height: 44px; padding: 0 12px; font-weight: 500; }
.codebox pre {
  margin: 0; padding: 14px 16px; background: var(--code-bg); color: var(--code-text);
  font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 13px; line-height: 1.6;
  overflow-x: auto;
}
`;

/**
 * The portal's own icon (`/assets/icon.svg`): the header's terminal glyph, nothing from the
 * internet. The page links it as `rel="icon"`, so a browser never asks for `/favicon.ico`;
 * `img-src 'self'` in the policy covers it.
 */
export const PORTAL_ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="32" height="32" fill="none" stroke="#7fa8f0" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="3"></rect><path d="M7 10l3 2-3 2"></path><path d="M12 15h5"></path></svg>
`;

/**
 * The theme, before the first paint. A separate small file, loaded in the head with no
 * `defer`: a stored light choice never shows a dark flash. `localStorage` is read in a
 * `try` block — a browser with storage switched off gets the default (dark), not an error.
 */
export const THEME_JS = `(function () {
  try {
    var want = localStorage.getItem("cc-smart-dev-kit-theme");
    if (want === "light" || want === "dark") document.documentElement.dataset.theme = want;
  } catch (error) { /* no storage: the default is dark */ }
})();
`;

/**
 * The page's own script. Nothing inline (the policy forbids it), no framework, and no
 * request anywhere but this portal. It does four jobs: the theme toggle, the CSRF token on
 * every POST, copy buttons, and the small pieces each screen needs.
 */
export const PORTAL_JS = `(function () {
  "use strict";

  /** How long typing pauses before the Project card asks the server for the plan again. */
  var PREVIEW_TYPING_MS = 300;
  var meta = document.querySelector('meta[name="ccsdk-csrf"]');
  var csrf = meta ? meta.getAttribute("content") : "";

  function post(path, body) {
    return fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json", "x-ccsdk-csrf": csrf },
      body: JSON.stringify(body || {})
    }).then(function (response) {
      return response.json().catch(function () { return { ok: false, lines: ["The portal answered something it should not have."] }; })
        .then(function (data) { data.status = response.status; return data; });
    }).catch(function () {
      // The portal stopped (its 30 minutes ran out, or someone pressed Ctrl+C): every caller
      // then draws this as a failure, and a button left on "Working…" goes back to its label.
      return { ok: false, lines: ["The portal is not running. Run cc-smart-dev-kit portal again."], status: 0 };
    });
  }

  function lines(list) {
    return (list || []).map(function (line) {
      var p = document.createElement("p");
      p.className = "small mono wrap-any";
      p.textContent = line;
      return p;
    });
  }

  // The tone is the answer's own, when it has one: "info" is a fact, not a failure (the token
  // field's "nothing was pasted, so the saved token is unchanged" is the case it exists for).
  function say(node, ok, list, tone) {
    if (!node) return;
    node.textContent = "";
    node.className = ok ? "status-ok" : tone === "info" ? "status-info" : "status-bad";
    node.appendChild(
      document.createTextNode(ok ? "\\u2713 " : tone === "info" ? "\\u00b7 " : "\\u2717 ")
    );
    node.appendChild(document.createTextNode((list && list[0]) || (ok ? "Done." : "It did not work.")));
    if (list && list.length > 1) {
      var more = document.createElement("div");
      var rest = lines(list.slice(1));
      for (var i = 0; i < rest.length; i += 1) more.appendChild(rest[i]);
      node.appendChild(more);
    }
  }

  function busy(button, on) {
    if (!button) return;
    if (on) { button.dataset.label = button.textContent; button.textContent = "Working\\u2026"; button.disabled = true; }
    else { if (button.dataset.label) button.textContent = button.dataset.label; button.disabled = false; }
  }

  // ── The theme ───────────────────────────────────────────────────────────
  var toggle = document.querySelector("[data-theme-toggle]");
  if (toggle) {
    var show = function () {
      var light = document.documentElement.dataset.theme === "light";
      toggle.textContent = light ? "Light" : "Dark";
      toggle.setAttribute("aria-label", light ? "Switch to the dark theme" : "Switch to the light theme");
    };
    toggle.addEventListener("click", function () {
      var next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
      document.documentElement.dataset.theme = next;
      try { localStorage.setItem("cc-smart-dev-kit-theme", next); } catch (error) { /* not remembered */ }
      show();
    });
    show();
  }

  // ── The URL is cleaned once the token was exchanged ─────────────────────
  if (location.search.indexOf("t=") !== -1 && window.history && window.history.replaceState) {
    window.history.replaceState(null, "", location.pathname);
  }

  // ── Meters: a width the policy keeps out of the markup ──────────────────
  Array.prototype.forEach.call(document.querySelectorAll("[data-percent]"), function (fill) {
    fill.style.width = String(Number(fill.getAttribute("data-percent"))) + "%";
  });
  Array.prototype.forEach.call(document.querySelectorAll("[data-mark]"), function (mark) {
    mark.style.left = String(Number(mark.getAttribute("data-mark"))) + "%";
  });
  Array.prototype.forEach.call(document.querySelectorAll("[data-stack-a]"), function (part) {
    part.style.width = String(Number(part.getAttribute("data-stack-a"))) + "%";
    var b = part.nextElementSibling;
    if (b && b.hasAttribute("data-stack-b")) b.style.width = String(Number(b.getAttribute("data-stack-b"))) + "%";
  });

  // ── Copy buttons ────────────────────────────────────────────────────────
  document.addEventListener("click", function (event) {
    var button = event.target.closest("[data-copy], [data-copy-node]");
    if (!button) return;
    var node = button.hasAttribute("data-copy-node")
      ? document.querySelector(button.getAttribute("data-copy-node"))
      : null;
    if (button.hasAttribute("data-copy-node") && !node) return;
    var text = node ? node.textContent || "" : button.getAttribute("data-copy");
    var done = function () {
      var was = button.textContent;
      button.textContent = "Copied";
      setTimeout(function () { button.textContent = was; }, 1200);
    };
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, function () {});
    else done();
  });

  // ── A switch or a button that calls one action ──────────────────────────
  document.addEventListener("click", function (event) {
    var button = event.target.closest("[data-action]");
    if (!button) return;
    var name = button.getAttribute("data-action");
    var body = {};
    try { body = JSON.parse(button.getAttribute("data-body") || "{}"); } catch (error) { body = {}; }
    if (button.getAttribute("data-confirm") && !window.confirm(button.getAttribute("data-confirm"))) return;
    // The message goes to the nearest box for this action (data-scope: a card, or a form
    // with more than one of them), so two cards never show each other's lines.
    var scope = button.closest("[data-scope]") || document;
    var out = scope.querySelector("[data-out-for='" + name + "']");
    busy(button, true);
    post("/api/" + name, body).then(function (data) {
      busy(button, false);
      say(out, !!data.ok, data.lines, data.tone);
      if (data.ok && button.hasAttribute("data-reload")) setTimeout(function () { location.reload(); }, 700);
      if (data.ok && button.hasAttribute("data-toggle")) {
        var on = button.getAttribute("aria-checked") !== "true";
        button.setAttribute("aria-checked", on ? "true" : "false");
        var label = button.querySelector("[data-switch-label]");
        if (label) label.textContent = on ? "On" : "Off";
      }
    });
  });

  // ── The Health page: look again every five seconds ──────────────────────
  var live = document.querySelector("[data-live]");
  if (live) {
    var paused = false;
    // The auto=1 query marks this reload as the page's own, not the person asking: the
    // portal serves the page and does NOT count it as activity, so a Health tab left open
    // cannot hold the portal (and its 30-minute idle clock) open forever. A hidden tab is not
    // reloaded at all; it looks once more when it comes back.
    var again = function () {
      if (paused || document.hidden) return;
      location.replace(location.pathname + "?auto=1");
    };
    var timer = setInterval(again, 5000);
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) again();
    });
    var pause = document.querySelector("[data-pause]");
    if (pause) {
      pause.addEventListener("click", function () {
        paused = !paused;
        pause.textContent = paused ? "Resume" : "Pause";
      });
    }

    var only = document.querySelector("[data-only-warn]");
    if (only) {
      var apply = function () {
        var on = only.checked;
        Array.prototype.forEach.call(document.querySelectorAll("[data-log-line]"), function (line) {
          line.hidden = on && line.getAttribute("data-level") !== "WARN";
        });
      };
      only.addEventListener("change", apply);
      apply();
    }
    window.addEventListener("beforeunload", function () { clearInterval(timer); });
  }

  // ── The Settings page ───────────────────────────────────────────────────
  // A row is a POST and a reload, like every switch here; the two controls a plain button
  // cannot carry (the event checkboxes and the percentage box) get their own small handlers.
  // A refused change puts the control back the way the server still sees it.
  var outFor = function (node, name) {
    var scope = node.closest("[data-scope]") || document;
    return scope.querySelector("[data-out-for='" + name + "']");
  };

  var setSetting = function (node, key, value, putBack) {
    var out = outFor(node, "workflow.set");
    post("/api/workflow.set", { key: key, value: value }).then(function (data) {
      say(out, !!data.ok, data.lines, data.tone);
      if (data.ok) setTimeout(function () { location.reload(); }, 700);
      else if (putBack) putBack();
    });
  };

  Array.prototype.forEach.call(document.querySelectorAll("[data-events]"), function (group) {
    var key = group.getAttribute("data-events");
    var boxes = group.querySelectorAll("input[type=checkbox]");
    var picked = function () {
      var chosen = [];
      Array.prototype.forEach.call(boxes, function (box) { if (box.checked) chosen.push(box.value); });
      return chosen;
    };
    var lastGood = picked();
    group.addEventListener("change", function () {
      var before = lastGood;
      var chosen = picked();
      lastGood = chosen;
      setSetting(group, key, chosen, function () {
        Array.prototype.forEach.call(boxes, function (box) {
          box.checked = before.indexOf(box.value) !== -1;
        });
      });
    });
  });

  Array.prototype.forEach.call(document.querySelectorAll("[data-setting]"), function (input) {
    var key = input.getAttribute("data-setting");
    var lastGood = input.value;
    input.addEventListener("change", function () {
      var before = lastGood;
      lastGood = input.value;
      setSetting(input, key, Number(input.value), function () {
        input.value = before;
      });
    });
  });

  // ── The Project card on Machine ─────────────────────────────────────────
  // The form is a plan, never a file: every change asks the server, which runs the same pure
  // planProjectInit the write runs, so the boxes show exactly what will be written.
  var projectRoot = document.querySelector("[data-project]");
  // No form means the plan cannot be built at all (the card says why), so only the button
  // that would reveal it is wired: nothing else on the card is there to reach for.
  var projectForm = projectRoot ? projectRoot.querySelector("[data-project-form]") : null;
  var reveal = projectRoot ? projectRoot.querySelector("[data-setup-show]") : null;
  if (reveal) {
    reveal.addEventListener("click", function () {
      if (projectForm) projectForm.hidden = false;
      reveal.hidden = true;
    });
  }
  if (projectRoot && projectForm) {
    var form = projectForm;
    var writeOut = projectRoot.querySelector("[data-out-for='project.write']");
    var filePre = projectRoot.querySelector("[data-preview-file]");
    var settingsPre = projectRoot.querySelector("[data-preview-settings]");
    var noteLine = projectRoot.querySelector("[data-preview-note]");
    var notesBox = projectRoot.querySelector("[data-preview-notes]");
    // Every answer carries the number of the question it answers: a slower, older answer
    // never overwrites a newer one on screen.
    var asked = 0;
    // The hash of the two files the plan on screen was made from. It travels with the write,
    // and the server refuses a write whose plan no longer matches the files on disk.
    var filesHash = form.getAttribute("data-files-hash") || "";

    var answerOf = function (name) {
      var node = form.querySelector("[data-answer='" + name + "']");
      return node ? node.value.trim() : "";
    };
    var guardOn = function (name) {
      var node = form.querySelector("[data-form-switch='" + name + "']");
      return !!node && node.getAttribute("aria-checked") === "true";
    };
    var answers = function () {
      var bases = {};
      Array.prototype.forEach.call(form.querySelectorAll("[data-base-row]"), function (row) {
        var prefix = row.querySelector("[data-base-prefix]").value.trim();
        var base = row.querySelector("[data-base-value]").value.trim();
        if (prefix !== "" && base !== "") bases[prefix] = base;
      });
      var protectedNames = [];
      Array.prototype.forEach.call(form.querySelectorAll("[data-protected-name]"), function (node) {
        var name = node.value.trim();
        if (name !== "") protectedNames.push(name);
      });
      return {
        answers: {
          base: answerOf("base"),
          bases: bases,
          protectedBranches: protectedNames,
          guards: {
            guardMainFolder: guardOn("guardMainFolder"),
            sessionNames: guardOn("sessionNames"),
            jobRoute: guardOn("jobRoute")
          }
        }
      };
    };

    var drawPlan = function (data, preview) {
      filePre.textContent = preview.text;
      // The settings file gets Claude Code's worktree.baseRef line, or nothing.
      settingsPre.textContent = (preview.settingsAdds || []).join("\\n");
      if (typeof data.filesHash === "string") filesHash = data.filesHash;
      // The note under the settings box comes from the server, like the boxes: one home for
      // the sentence, and it can never describe a different plan than the one drawn.
      if (data.lines && data.lines[0]) noteLine.textContent = data.lines[0];
      notesBox.textContent = "";
      (preview.notes || []).forEach(function (note) {
        var p = document.createElement("p");
        p.className = "small muted";
        p.textContent = note;
        notesBox.appendChild(p);
      });
    };

    var ask = function () {
      var mine = (asked += 1);
      post("/api/project.preview", answers()).then(function (data) {
        if (mine !== asked) return;
        if (!data.ok || !data.preview) { say(writeOut, false, data.lines, data.tone); return; }
        // A preview that worked replaces whatever the last answer said: a refusal from an
        // earlier edit must not sit under a plan that is fine now.
        writeOut.textContent = "";
        writeOut.className = "";
        drawPlan(data, data.preview);
      });
    };

    // A finished edit (a box left, a box ticked, a row added or removed) asks at once. A text
    // box asks while it is being typed in — once the typing pauses, so the preview follows the
    // words instead of waiting for the box to lose the focus, and one plan is asked for and
    // not one per keystroke. The server stays the only builder of the plan.
    var typing = null;
    var settled = function () {
      if (typing !== null) { clearTimeout(typing); typing = null; }
    };
    form.addEventListener("input", function (event) {
      var node = event.target;
      if (!node || node.tagName !== "INPUT" || node.type !== "text") return;
      settled();
      typing = setTimeout(function () { typing = null; ask(); }, PREVIEW_TYPING_MS);
    });
    form.addEventListener("change", function () { settled(); ask(); });

    var flip = function (button) {
      var on = button.getAttribute("aria-checked") === "true";
      button.setAttribute("aria-checked", on ? "false" : "true");
      var label = button.querySelector("[data-switch-label]");
      if (label) label.textContent = on ? "Off" : "On";
      ask();
    };
    Array.prototype.forEach.call(form.querySelectorAll("[data-form-switch]"), function (button) {
      button.addEventListener("click", function () { flip(button); });
    });

    // An added row is the page's own markup, taken from the template beside the list: the
    // form has one home for what a row looks like, and this script adds no markup of its own.
    var added = function (templateName) {
      var template = projectRoot.querySelector("template[" + templateName + "]");
      if (!template) return null;
      return template.content.firstElementChild
        ? template.content.firstElementChild.cloneNode(true)
        : null;
    };

    var addBase = projectRoot.querySelector("[data-add-base]");
    if (addBase) {
      addBase.addEventListener("click", function () {
        var row = added("data-base-template");
        if (!row) return;
        projectRoot.querySelector("[data-bases]").appendChild(row);
        var first = row.querySelector("input");
        if (first) first.focus();
      });
    }

    var addProtected = projectRoot.querySelector("[data-add-protected]");
    if (addProtected) {
      addProtected.addEventListener("click", function () {
        var chip = added("data-chip-template");
        if (!chip) return;
        projectRoot.querySelector("[data-protected]").insertBefore(chip, addProtected);
        var input = chip.querySelector("input");
        if (input) input.focus();
      });
    }

    form.addEventListener("click", function (event) {
      var row = event.target.closest("[data-base-row]");
      if (row) {
        if (event.target.closest("[data-remove-row]")) { row.remove(); ask(); }
        return;
      }
      var chip = event.target.closest("[data-chip]");
      if (chip && event.target.closest("[data-remove-chip]")) { chip.remove(); ask(); }
    });

    var write = projectRoot.querySelector("[data-write]");
    if (write) {
      write.addEventListener("click", function () {
        if (write.getAttribute("data-confirm") && !window.confirm(write.getAttribute("data-confirm"))) return;
        var body = answers();
        body.confirm = true;
        body.previewHash = filesHash;
        busy(write, true);
        post("/api/project.write", body).then(function (data) {
          busy(write, false);
          say(writeOut, !!data.ok, data.lines, data.tone);
          if (data.ok) setTimeout(function () { location.reload(); }, 700);
        });
      });
    }

    var cancel = projectRoot.querySelector("[data-cancel]");
    if (cancel) cancel.addEventListener("click", function () { location.reload(); });
  }

  // ── The Browser card: the token field ───────────────────────────────────
  // The token is read from the field, sent once to the same writer the command line uses, and
  // cleared from the page: no answer, no page and no log ever carries the value back.
  var tokenSave = document.querySelector("[data-token-save]");
  if (tokenSave) {
    tokenSave.addEventListener("click", function () {
      var input = document.querySelector("[data-token-input]");
      var out = document.querySelector("[data-out-for='browser.token']");
      var value = input ? input.value : "";
      busy(tokenSave, true);
      post("/api/browser.token", { token: value }).then(function (data) {
        busy(tokenSave, false);
        say(out, !!data.ok, data.lines, data.tone);
        if (input) input.value = "";
        if (data.ok) setTimeout(function () { location.reload(); }, 900);
      });
    });
  }

  // ── The Slots page ──────────────────────────────────────────────────────
  var slotsRoot = document.querySelector("[data-slots]");
  if (slotsRoot) {
    var slot = slotsRoot.getAttribute("data-slot") || "scout";
    var chains = {};
    try { chains = JSON.parse(slotsRoot.getAttribute("data-chains") || "{}"); } catch (error) { chains = {}; }
    var tested = {};
    try { tested = JSON.parse(slotsRoot.getAttribute("data-tested") || "{}"); } catch (error) { tested = {}; }
    var fallback = {};
    try { fallback = JSON.parse(slotsRoot.getAttribute("data-fallback") || "{}"); } catch (error) { fallback = {}; }

    var chainOf = function () { return (chains[slot] || []).slice(); };
    var chainList = slotsRoot.querySelector("[data-chain]");
    var modelList = slotsRoot.querySelector("[data-models]");
    var out = slotsRoot.querySelector("[data-out]");
    var saveBtn = slotsRoot.querySelector("[data-save]");
    var confirmBox = slotsRoot.querySelector("[data-confirm-save]");

    var draw = function () {
      var chain = chainOf();
      chainList.textContent = "";
      if (chain.length === 0) {
        var empty = document.createElement("p");
        empty.className = "notice plain";
        empty.textContent = "No targets. Add one from the model list below.";
        chainList.appendChild(empty);
      }
      chain.forEach(function (target, index) {
        var item = document.createElement("li");
        if (tested[slot + "\\u0000" + target] === "bad") item.className = "bad";
        var n = document.createElement("span"); n.className = "n"; n.textContent = String(index + 1);
        var who = document.createElement("span"); who.className = "who";
        var id = document.createElement("span"); id.className = "mono wrap-any"; id.textContent = target;
        var role = document.createElement("span"); role.className = "small muted";
        role.textContent = roleOf(index);
        who.appendChild(id); who.appendChild(role);
        var what = document.createElement("span"); what.className = "what";
        var state = tested[slot + "\\u0000" + target];
        var mark = document.createElement("span");
        if (state === "good") { mark.className = "ok"; mark.textContent = "\\u2713 tested, it answered"; }
        else if (state === "bad") {
          mark.className = "badmark";
          // The same rule as the note and as the command line: Save is held off for the judge
          // slot alone; another slot's chain with a failing target is refused by the CLI.
          mark.textContent = slot === "judge"
            ? "\\u2717 it did not block the test \\u2014 Save is off until every judge target shows blocked \\u2713"
            : "\\u2717 it did not answer as it should \\u2014 the command line refuses a chain like this";
        }
        else if (state === "blocked") { mark.className = "ok"; mark.textContent = "\\u2713 blocked"; }
        else { mark.className = "muted"; mark.textContent = "Not tested yet."; }
        what.appendChild(mark);
        var buttons = document.createElement("span"); buttons.className = "row";
        [["\\u2191", "up", index === 0], ["\\u2193", "down", index === chain.length - 1], ["\\u2715", "remove", false]].forEach(function (spec) {
          var b = document.createElement("button");
          b.type = "button"; b.className = "btn icon"; b.textContent = spec[0];
          b.setAttribute("aria-label", spec[1] + " " + target);
          b.disabled = !!spec[2];
          b.addEventListener("click", function () {
            var next = chainOf();
            if (spec[1] === "up") { var a = next[index - 1]; next[index - 1] = next[index]; next[index] = a; }
            if (spec[1] === "down") { var c = next[index + 1]; next[index + 1] = next[index]; next[index] = c; }
            if (spec[1] === "remove") next.splice(index, 1);
            chains[slot] = next;
            tested = {};
            draw();
          });
          buttons.appendChild(b);
        });
        item.appendChild(n); item.appendChild(who); item.appendChild(what); item.appendChild(buttons);
        chainList.appendChild(item);
      });
      if (saveBtn) saveBtn.disabled = chain.length === 0 || untestedJudge(chain);
      if (confirmBox) confirmBox.hidden = true;
      Array.prototype.forEach.call(modelList.querySelectorAll("[data-add]"), function (button) {
        var inChain = chain.indexOf(button.getAttribute("data-add")) !== -1;
        button.disabled = inChain;
        button.textContent = inChain ? "In the chain" : "Add";
      });
    };

    // The same rule for every slot: the first answers; the rest only while the slot's own
    // fallback switch is on, the command line's "gateway fallback".
    var roleOf = function (index) {
      if (index === 0) return "answers first";
      return fallback[slot] === true
        ? "answers if the one above fails or rests"
        : "kept, not used: this slot's fallback is off";
    };

    // The command line's own judge rule: a claude-... target in the judge slot is allowed and
    // never used (the router uses a judge target only after the force-push test, and a Claude
    // target cannot be tested from here), so Save waits only on the backend targets.
    var untestedJudge = function (chain) {
      if (slot !== "judge") return false;
      return chain.some(function (target) {
        return target.indexOf("claude-") !== 0 && tested[slot + "\\u0000" + target] !== "blocked";
      });
    };

    Array.prototype.forEach.call(slotsRoot.querySelectorAll("[data-pick]"), function (button) {
      button.addEventListener("click", function () {
        slot = button.getAttribute("data-pick");
        tested = {};
        Array.prototype.forEach.call(slotsRoot.querySelectorAll("[data-pick]"), function (other) {
          other.setAttribute("aria-pressed", other === button ? "true" : "false");
        });
        slotsRoot.setAttribute("data-slot", slot);
        var title = slotsRoot.querySelector("[data-slotname]");
        if (title) title.textContent = slot;
        var info = slotsRoot.querySelector("[data-slotinfo]");
        if (info) info.textContent = button.getAttribute("data-info") || "";
        var judgeNote = slotsRoot.querySelector("[data-judge-note]");
        if (judgeNote) judgeNote.hidden = slot !== "judge";
        Array.prototype.forEach.call(slotsRoot.querySelectorAll("[data-fallback-for]"), function (row) {
          row.hidden = row.getAttribute("data-fallback-for") !== slot;
        });
        draw();
      });
    });

    Array.prototype.forEach.call(modelList.querySelectorAll("[data-add]"), function (button) {
      button.addEventListener("click", function () {
        chains[slot] = chainOf().concat([button.getAttribute("data-add")]);
        tested = {};
        draw();
      });
    });

    var testBtn = slotsRoot.querySelector("[data-test]");
    if (testBtn) {
      testBtn.addEventListener("click", function () {
        busy(testBtn, true);
        post("/api/slot.test", { slot: slot, targets: chainOf() }).then(function (data) {
          busy(testBtn, false);
          tested = {};
          var results = data.results || [];
          results.forEach(function (one) {
            tested[slot + "\\u0000" + one.target] = one.verdict;
          });
          draw();
          say(out, !!data.ok, data.lines, data.tone);
        });
      });
    }

    if (saveBtn) {
      saveBtn.addEventListener("click", function () {
        if (confirmBox) { confirmBox.hidden = false; return; }
        post("/api/slot.save", { slot: slot, targets: chainOf() }).then(function (data) {
          say(out, !!data.ok, data.lines, data.tone);
          if (data.ok) setTimeout(function () { location.reload(); }, 700);
        });
      });
    }
    var yes = slotsRoot.querySelector("[data-confirm-yes]");
    if (yes) {
      yes.addEventListener("click", function () {
        post("/api/slot.save", { slot: slot, targets: chainOf() }).then(function (data) {
          say(out, !!data.ok, data.lines, data.tone);
          if (data.ok) setTimeout(function () { location.reload(); }, 700);
        });
      });
    }
    var cancel = slotsRoot.querySelector("[data-confirm-no]");
    if (cancel) cancel.addEventListener("click", function () { if (confirmBox) confirmBox.hidden = true; });

    var find = slotsRoot.querySelector("[data-find]");
    if (find) {
      find.addEventListener("input", function () {
        var needle = find.value.trim().toLowerCase();
        Array.prototype.forEach.call(modelList.querySelectorAll("[data-model-row]"), function (row) {
          row.hidden = needle !== "" && row.getAttribute("data-model").toLowerCase().indexOf(needle) === -1;
        });
      });
    }
    draw();
  }
})();
`;
