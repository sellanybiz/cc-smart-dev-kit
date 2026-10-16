/**
 * Playwright MCP init page — a person's click on an upload control opens the normal file
 * picker, while Claude's click is still answered with `browser_file_upload`.
 *
 * WHY THIS EXISTS
 *   The MCP gives every tab a `filechooser` listener, and while a page has one, Playwright
 *   turns on Chrome's file-chooser interception: Chrome never shows its picker, it reports
 *   the request, and the MCP waits for `browser_file_upload`. Right for Claude — and it
 *   leaves a person who clicks "Attach" in that window with nothing at all.
 *
 * WHAT IT DOES
 *   The MCP loads this file for every tab (`--init-page`, passed by `browser/launcher.ts`)
 *   and calls its default export with the tab's page. The MCP's own `filechooser` listeners
 *   stay on while Claude is acting — a public Playwright call is running, or one ended less
 *   than HOLD_AFTER_MS ago — and come off otherwise, which turns the interception off.
 *   - They go back on from `onApiCallBegin`, which Playwright runs right BEFORE it sends a
 *     call. So the picker that Claude's own click opens is always held: the two messages
 *     reach Chrome in that order.
 *   - HOLD_AFTER_MS covers pages that open the picker a moment after the click, once a
 *     menu has closed for example.
 *   - A picker held for Claude stays usable after the hold ends: `setFiles` writes the
 *     files onto the input itself.
 *
 *   It reads one private field of playwright-core, `page._instrumentation`, as found in
 *   `@playwright/mcp` at the pinned version (`src/mcp/versions.ts`). Without it this file
 *   changes nothing — every picker stays held, as before — and says so once in the MCP log.
 *   Nothing here may throw into the MCP: a throw from an init page fails the tab.
 *
 * The MCP loads the built copy of this file on its own, outside this plugin's module setup,
 * so it imports nothing but Node's own modules. `src/entries/browser-picker.ts` makes the
 * bundle the launcher writes beside the profile (`cliPaths().browserPickerFile`).
 */
import { clearTimeout, setTimeout } from "node:timers";

/** How long after Claude's last browser call the picker stays held for it. */
export const HOLD_AFTER_MS = 2000;

/** What this needs from a tab: the Playwright page, or a fake in the tests. */
export interface PickerPage {
  isClosed(): boolean;
  listeners(event: "filechooser"): unknown[];
  off(event: "filechooser", listener: unknown): unknown;
  on(event: "filechooser", listener: unknown): unknown;
}

export interface PickerTimers<Timer> {
  clear(timer: Timer): void;
  start(run: () => void, ms: number): Timer;
}

export interface PickerHold {
  /** A tab the MCP has just set up, its own listeners already on. */
  addPage(page: PickerPage): void;
  /** Playwright is about to send a public call. `method` is its protocol name. */
  callBegan(zone: unknown, method: unknown): void;
  callEnded(zone: unknown): void;
}

/**
 * The hold itself, with no Playwright in it: which tabs there are, which calls are
 * running, and when to put the MCP's listeners on or take them off.
 */
export function createPickerHold<Timer>(
  timers: PickerTimers<Timer>,
  holdAfterMs: number = HOLD_AFTER_MS,
): PickerHold {
  /** Each tab, with the MCP's own `filechooser` listeners as they were at its setup. */
  const pages = new Map<PickerPage, unknown[]>();
  /** The public calls running now. A call can report its start twice; a Set counts it once. */
  const running = new Set<unknown>();
  /** The MCP's listeners are on when it sets a tab up, so its first tab starts held. */
  let held = true;
  let release: null | { timer: Timer } = null;

  function apply(page: PickerPage, listeners: unknown[], hold: boolean): void {
    if (page.isClosed()) {
      pages.delete(page);
      return;
    }
    for (const listener of listeners) {
      if (hold) page.on("filechooser", listener);
      else page.off("filechooser", listener);
    }
  }

  function setHeld(hold: boolean): void {
    if (held === hold) return;
    held = hold;
    for (const [page, listeners] of pages) apply(page, listeners, hold);
  }

  function stopRelease(): void {
    if (release === null) return;
    timers.clear(release.timer);
    release = null;
  }

  /** Lets go after `holdAfterMs`, unless a call begins first — `callBegan` stops it. */
  function startRelease(): void {
    stopRelease();
    release = {
      timer: timers.start(() => {
        release = null;
        setHeld(false);
      }, holdAfterMs),
    };
  }

  return {
    addPage(page) {
      const listeners = page.listeners("filechooser");
      pages.set(page, listeners);
      // A tab opened while the hold is off (a link a person opened) joins it at once.
      if (!held) apply(page, listeners, false);
      else if (running.size === 0 && release === null) startRelease();
    },
    callBegan(zone, method) {
      // Putting listeners on or off is itself a call: following it would never end.
      if (method === "updateSubscription" || running.has(zone)) return;
      running.add(zone);
      stopRelease();
      setHeld(true);
    },
    callEnded(zone) {
      if (!running.delete(zone)) return;
      if (running.size === 0) startRelease();
    },
  };
}

/** Says why the hold is not followed. */
export type Warn = (problem: string) => void;

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isPickerPage(value: unknown): value is PickerPage {
  return (
    typeof value === "object" &&
    value !== null &&
    "isClosed" in value &&
    typeof value.isClosed === "function" &&
    "listeners" in value &&
    typeof value.listeners === "function" &&
    "off" in value &&
    typeof value.off === "function" &&
    "on" in value &&
    typeof value.on === "function"
  );
}

interface CallListener {
  onApiCallBegin(zone: unknown, call: unknown): void;
  onApiCallEnd(zone: unknown): void;
}

interface Instrumentation {
  listen(listener: CallListener): void;
  target: object;
}

/**
 * The connection's call reports, shared by every page, frame and locator. A Proxy that
 * answers only property reads, so it is read with `Reflect.get`, never `in`.
 */
function instrumentationOf(page: object): Instrumentation | null {
  const target: unknown = Reflect.get(page, "_instrumentation");
  if (typeof target !== "object" || target === null) return null;
  const addListener: unknown = Reflect.get(target, "addListener");
  if (typeof addListener !== "function") return null;
  return {
    listen: (listener) => {
      Reflect.apply(addListener, target, [listener]);
    },
    target,
  };
}

function methodOf(call: unknown): unknown {
  return typeof call === "object" && call !== null ? Reflect.get(call, "method") : undefined;
}

/**
 * The function the MCP calls for every tab: it ties the tab to `hold`, and the hold to
 * the connection's call reports (once per connection). Nothing escapes it — not into the
 * tab's setup, and not into a Playwright call — anything that fails goes to `warn`.
 */
export function createInitPage(hold: PickerHold, warn: Warn): (init: { page: unknown }) => void {
  const followed = new WeakSet<object>();
  const callListener: CallListener = {
    onApiCallBegin(zone, call) {
      try {
        hold.callBegan(zone, methodOf(call));
      } catch (error) {
        warn(`could not hold the picker: ${reason(error)}`);
      }
    },
    onApiCallEnd(zone) {
      try {
        hold.callEnded(zone);
      } catch (error) {
        warn(`could not follow a call's end: ${reason(error)}`);
      }
    },
  };
  return ({ page }) => {
    try {
      if (!isPickerPage(page)) {
        warn("the MCP's page has no on, off or listeners");
        return;
      }
      const instrumentation = instrumentationOf(page);
      if (instrumentation === null) {
        warn("this playwright-core has no page._instrumentation");
        return;
      }
      if (!followed.has(instrumentation.target)) {
        followed.add(instrumentation.target);
        instrumentation.listen(callListener);
      }
      hold.addPage(page);
    } catch (error) {
      warn(`could not follow the tab: ${reason(error)}`);
    }
  };
}

let warned = false;

/** One line in the MCP log (stderr — stdout carries the MCP's own messages). */
function warnOnce(problem: string): void {
  if (warned) return;
  warned = true;
  process.stderr.write(
    `[cc-smart-dev-kit-picker] ${problem} — every file picker stays held for Claude, as before\n`,
  );
}

/** Called by the MCP for every tab it sets up. */
export default createInitPage(
  createPickerHold<NodeJS.Timeout>({
    clear: (timer) => {
      clearTimeout(timer);
    },
    start: (run, ms) => {
      // The MCP must be able to exit while a hold is waiting to end.
      const timer = setTimeout(run, ms);
      timer.unref();
      return timer;
    },
  }),
  warnOnce,
);
