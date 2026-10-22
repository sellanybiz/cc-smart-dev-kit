/**
 * The shape every portal page shares: the head, the header and its two status pills, the
 * private bar, the page's own body, and the footer.
 *
 * The pages themselves live in `views.ts` and are plain strings, so what is served is what
 * the test reads: no templating language, and every value from the machine goes through
 * `escapeHtml` — a model id, a unit name or a path is text, never markup.
 */

import { COMMAND } from "../build-info";
import type { PortalFacts } from "./facts";

/** A value as HTML text. Everything from the machine goes through here. */
export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** The icon at the top left, the same shape on every page. */
const MARK = `<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3"></rect><path d="M7 10l3 2-3 2"></path><path d="M12 15h5"></path></svg>`;

/** The lock, for the private bar and a protected branch. */
export const LOCK_ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"></rect><path d="M8 11V8a4 4 0 0 1 8 0v3"></path></svg>`;

/** The pages in the header, in order. */
export const PAGES = [
  { href: "/", id: "overview", label: "Overview" },
  { href: "/slots", id: "slots", label: "Slots" },
  { href: "/health", id: "health", label: "Health" },
  { href: "/machine", id: "machine", label: "Machine" },
  { href: "/settings", id: "settings", label: "Settings" },
] as const;

export type PageId = (typeof PAGES)[number]["id"] | null;

/** The pieces of the shell a page does not decide: what the header shows. */
export interface Shell {
  bun: string;
  csrf: string;
  facts: PortalFacts;
}

function header(shell: Shell, active: PageId): string {
  const { router } = shell.facts;
  // No router to name (no gateway config): a plain pill, never a port that nothing listens on.
  let state = `<span class="pill plain"><span>Gateway not set up</span></span>`;
  if (router?.up) {
    state = `<span class="pill ok"><span aria-hidden="true">✓</span><span>Router running</span><span class="mono">127.0.0.1:${router.port}</span></span>`;
  } else if (router !== null) {
    state = `<span class="pill bad"><span aria-hidden="true">✗</span><span>Router not answering</span><span class="mono">127.0.0.1:${router.port}</span></span>`;
  }
  const nav = PAGES.map(
    (page) =>
      `<a href="${page.href}"${page.id === active ? ' aria-current="page"' : ""}>${page.label}</a>`,
  ).join("");
  return `<header class="top">
<div class="wrap">
<div class="brand">${MARK}<span class="name">cc-smart-dev-kit</span><span class="ver">${escapeHtml(shell.facts.version)}</span></div>
<div class="row chips">${state}<span class="pill plain">Bun ${escapeHtml(shell.bun)}</span></div>
<nav class="pages" aria-label="Portal">${nav}</nav>
<div class="row theme"><button type="button" class="themebtn" data-theme-toggle>Dark</button></div>
</div>
</header>
<div class="privatebar">
<div class="wrap">
<span>${LOCK_ICON}On this computer only. Any program or account on this machine can open it.</span>
<span>Never open this page in the Chrome profile Claude drives (its own, <span class="mono">claude-code</span>): Claude could reach its buttons.</span>
</div>
</div>`;
}

function footer(shell: Shell): string {
  return `<footer class="bottom">
<div class="wrap">
<span>Portal on <span class="mono">127.0.0.1:${shell.facts.portalPort}</span>. It stays up while Claude Code runs.</span>
<span>To stop it: <span class="mono">${COMMAND} portal stop</span></span>
<span>Keys are never shown in full.</span>
<a href="/privacy">How this page stays private</a>
</div>
</footer>`;
}

/** One whole page: the shell, and the body the caller built. */
export function layout(options: {
  active: PageId;
  body: string;
  shell: Shell;
  title: string;
}): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="ccsdk-csrf" content="${escapeHtml(options.shell.csrf)}">
<meta name="referrer" content="no-referrer">
<title>cc-smart-dev-kit — ${escapeHtml(options.title)}</title>
<link rel="icon" href="/assets/icon.svg" type="image/svg+xml">
<script src="/assets/theme.js"></script>
<link rel="stylesheet" href="/assets/portal.css">
<script src="/assets/portal.js" defer></script>
</head>
<body>
${header(options.shell, options.active)}
<main class="wrap">
${options.body}
</main>
${footer(options.shell)}
</body>
</html>
`;
}

/** A page with no session and no shell: the link is dead, or the portal stopped. */
export function barePage(options: { body: string; title: string }): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>cc-smart-dev-kit — ${escapeHtml(options.title)}</title>
<link rel="icon" href="/assets/icon.svg" type="image/svg+xml">
<script src="/assets/theme.js"></script>
<link rel="stylesheet" href="/assets/portal.css">
</head>
<body>
<header class="top"><div class="wrap"><div class="brand">${MARK}<span class="name">cc-smart-dev-kit</span></div></div></header>
<main class="wrap">
${options.body}
</main>
</body>
</html>
`;
}

/** A command, with a copy button. The copy text is the command itself. */
export function command(text: string, label: string): string {
  return `<div class="cmd"><code>${escapeHtml(text)}</code><button type="button" data-copy="${escapeHtml(text)}" aria-label="${escapeHtml(label)}">Copy</button></div>`;
}

/**
 * A switch: `role="switch"`, 44px tall, and its label stays put. A `disabled` one is a value
 * a page shows but does not change here (a row the project sets): it carries no action, so
 * nothing in the markup invites a change the server would refuse.
 */
export function switchButton(options: {
  action: string;
  body?: Record<string, unknown>;
  confirm?: string;
  disabled?: boolean;
  id: string;
  label: string;
  on: boolean;
  reload?: boolean;
}): string {
  const body =
    options.body === undefined ? "" : ` data-body="${escapeHtml(JSON.stringify(options.body))}"`;
  const confirm =
    options.confirm === undefined ? "" : ` data-confirm="${escapeHtml(options.confirm)}"`;
  const inside = `<span class="track" aria-hidden="true"><span class="knob"></span></span><span data-switch-label>${options.on ? "On" : "Off"}</span>`;
  const id = escapeHtml(options.id);
  if (options.disabled === true) {
    return `<button type="button" role="switch" aria-checked="${options.on}" aria-labelledby="${id}" class="switch" disabled>${inside}</button>`;
  }
  return `<button type="button" role="switch" aria-checked="${options.on}" aria-labelledby="${id}" class="switch" data-action="${escapeHtml(options.action)}"${body}${confirm}${options.reload === true ? " data-reload" : ""} data-toggle>${inside}</button>`;
}

/** One `✓` / `✗` / `·` / `!` line of a list like doctor's. */
export function checkLine(mark: string, text: string, tone: string): string {
  return `<li class="${tone}"><span class="mark ${tone === "fail" ? "badmark" : ""}" aria-hidden="true">${mark}</span><span class="wrap-any">${escapeHtml(text)}</span></li>`;
}

/**
 * A meter. Its width comes from `data-percent`, which `portal.js` turns into a width: the
 * policy allows no `style` attribute in the markup, and no script may be inline, so the
 * one thing that has to be a number stays an attribute.
 */
export function meter(percent: number, warn: boolean): string {
  const value = Math.max(0, Math.min(100, Math.round(percent)));
  return `<div class="meter${warn ? " warn" : ""}" aria-hidden="true"><div class="fill${warn ? " warn" : ""}" data-percent="${value}"></div><div class="mark" data-mark="85"></div></div>`;
}
