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
  display: flex; flex-wrap: wrap; align-items: center; gap: 10px 24px; padding-top: 10px; padding-bottom: 10px;
}
.brand { display: flex; align-items: center; gap: 10px; }
.brand .name { font-family: "JetBrains Mono", ui-monospace, monospace; font-weight: 600; font-size: 16px; }
.brand .ver { color: var(--muted); font-family: "JetBrains Mono", ui-monospace, monospace; font-size: 13px; }
nav.pages { display: flex; flex-wrap: wrap; gap: 4px; margin-left: auto; }
nav.pages a {
  display: inline-flex; align-items: center; min-height: 44px; padding: 0 14px;
  border-radius: 8px; color: var(--text); text-decoration: none;
}
nav.pages a[aria-current="page"] { background: var(--chip-bg); color: var(--accent-strong); font-weight: 600; }
.pill {
  display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px;
  font-size: 13px;
}
.pill.ok { background: var(--chip-bg); color: var(--accent); font-weight: 500; }
.pill.plain { background: var(--line-soft); color: var(--muted-2); font-family: "JetBrains Mono", ui-monospace, monospace; }
.pill.bad { background: var(--warn-soft); color: var(--warn-text); font-weight: 600; }
.themebtn {
  display: inline-flex; align-items: center; gap: 8px; min-height: 44px; padding: 0 12px;
  border: 1px solid var(--line); border-radius: 8px; background: var(--surface); color: var(--text);
  cursor: pointer;
}
.privatebar { background: var(--code-bg); color: var(--code-text); }
.privatebar .wrap {
  display: flex; flex-wrap: wrap; align-items: center; gap: 6px 20px;
  padding-top: 8px; padding-bottom: 8px; font-size: 13px;
}
.privatebar span { display: inline-flex; align-items: center; gap: 6px; }

/* ── Layout ─────────────────────────────────────────────────────────────── */
main { display: flex; flex-direction: column; gap: 28px; padding-top: 32px; padding-bottom: 48px; }
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
.checks li { display: flex; gap: 10px; padding: 6px 0; }
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

  function say(node, ok, list) {
    if (!node) return;
    node.textContent = "";
    node.className = ok ? "status-ok" : "status-bad";
    node.appendChild(document.createTextNode(ok ? "\\u2713 " : "\\u2717 "));
    node.appendChild(document.createTextNode((list && list[0]) || (ok ? "Done." : "It did not work.")));
    if (list && list.length > 1) {
      var more = document.createElement("div");
      more.appendChild(lines(list.slice(1)));
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
    var button = event.target.closest("[data-copy]");
    if (!button) return;
    var text = button.getAttribute("data-copy");
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
    var out = document.querySelector("[data-out-for='" + name + "']");
    busy(button, true);
    post("/api/" + name, body).then(function (data) {
      busy(button, false);
      say(out, !!data.ok, data.lines);
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
    var timer = setInterval(function () { if (!paused) location.reload(); }, 5000);
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

  // ── The Slots page ──────────────────────────────────────────────────────
  var slotsRoot = document.querySelector("[data-slots]");
  if (slotsRoot) {
    var slot = slotsRoot.getAttribute("data-slot") || "scout";
    var chains = {};
    try { chains = JSON.parse(slotsRoot.getAttribute("data-chains") || "{}"); } catch (error) { chains = {}; }
    var tested = {};
    try { tested = JSON.parse(slotsRoot.getAttribute("data-tested") || "{}"); } catch (error) { tested = {}; }

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
        role.textContent = roleOf(index, chain.length);
        who.appendChild(id); who.appendChild(role);
        var what = document.createElement("span"); what.className = "what";
        var state = tested[slot + "\\u0000" + target];
        var mark = document.createElement("span");
        if (state === "good") { mark.className = "ok"; mark.textContent = "\\u2713 tested, it answered"; }
        else if (state === "bad") { mark.className = "badmark"; mark.textContent = "\\u2717 it did not answer as it should \\u2014 Save is off until every target passes"; }
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

    var roleOf = function (index, length) {
      if (index === 0) return slot === "opus" || slot === "fable" ? "the Claude model itself, always first" : "answers first";
      if (slot === "opus" || slot === "fable") return "answers only at the plan limit, until the reset";
      if (index === length - 1) return "answers if the one above fails or rests";
      return "answers if the one above fails or rests";
    };

    var untestedJudge = function (chain) {
      if (slot !== "judge") return false;
      return chain.some(function (target) { return tested[slot + "\\u0000" + target] !== "blocked"; });
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
          say(out, !!data.ok, data.lines);
        });
      });
    }

    if (saveBtn) {
      saveBtn.addEventListener("click", function () {
        if (confirmBox) { confirmBox.hidden = false; return; }
        post("/api/slot.save", { slot: slot, targets: chainOf() }).then(function (data) {
          say(out, !!data.ok, data.lines);
          if (data.ok) setTimeout(function () { location.reload(); }, 700);
        });
      });
    }
    var yes = slotsRoot.querySelector("[data-confirm-yes]");
    if (yes) {
      yes.addEventListener("click", function () {
        post("/api/slot.save", { slot: slot, targets: chainOf() }).then(function (data) {
          say(out, !!data.ok, data.lines);
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
