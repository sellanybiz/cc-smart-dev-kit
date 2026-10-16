/**
 * The Playwright MCP init page (`picker.ts`): the file picker is held for Claude while it is
 * acting, and let go for a person the rest of the time.
 */
import { describe, expect, test } from "bun:test";
import { createInitPage, createPickerHold, type PickerPage } from "./picker";

/** A tab, with the MCP's own listeners on it, as the MCP sets one up. */
function tab() {
  const listeners = [(): void => undefined];
  const on = new Set<unknown>(listeners);
  const page: PickerPage = {
    isClosed: () => false,
    listeners: () => listeners,
    off: (_event, listener) => {
      on.delete(listener);
    },
    on: (_event, listener) => {
      on.add(listener);
    },
  };
  return { held: () => on.size > 0, page };
}

/** A timer a test drives by hand. */
function timers() {
  const started: (() => void)[] = [];
  const cleared: unknown[] = [];
  return {
    cleared,
    /** Run the pending release. */
    fire: () => {
      for (const run of started.splice(0)) run();
    },
    pending: () => started.length,
    timers: {
      clear: (timer: unknown) => {
        cleared.push(timer);
      },
      start: (run: () => void) => {
        started.push(run);
        return started.length;
      },
    },
  };
}

describe("the picker hold", () => {
  test("while Claude acts the picker is held; it is let go only after the hold time", () => {
    const clock = timers();
    const hold = createPickerHold(clock.timers, 2000);
    const page = tab();
    hold.addPage(page.page);
    expect(page.held()).toBe(true);
    // A call begins: the hold stays, and its release is cancelled.
    hold.callBegan("zone-1", "page.click");
    expect(page.held()).toBe(true);
    hold.callEnded("zone-1");
    expect(page.held()).toBe(true);
    clock.fire();
    expect(page.held()).toBe(false);
  });

  test("a call that begins while the hold is off puts it back on at once", () => {
    const clock = timers();
    const hold = createPickerHold(clock.timers, 2000);
    const page = tab();
    hold.addPage(page.page);
    clock.fire();
    expect(page.held()).toBe(false);
    hold.callBegan("zone-1", "page.click");
    expect(page.held()).toBe(true);
  });

  test("the hold is put on or off by its own call, which must never be followed", () => {
    const clock = timers();
    const hold = createPickerHold(clock.timers, 2000);
    const page = tab();
    hold.addPage(page.page);
    clock.fire();
    hold.callBegan("zone-1", "updateSubscription");
    expect(page.held()).toBe(false);
  });

  test("a tab opened while the hold is off joins it off; a closed tab is dropped", () => {
    const clock = timers();
    const hold = createPickerHold(clock.timers, 2000);
    const first = tab();
    hold.addPage(first.page);
    clock.fire();
    const second = tab();
    hold.addPage(second.page);
    expect(second.held()).toBe(false);
    // A tab that is gone: its listeners are dropped, and nothing is put back on it.
    const closed = tab();
    let closedAsked = false;
    hold.addPage({
      isClosed: () => {
        closedAsked = true;
        return true;
      },
      listeners: () => closed.page.listeners("filechooser"),
      off: closed.page.off,
      on: closed.page.on,
    });
    expect(closedAsked).toBe(true);
    expect(closed.held()).toBe(true); // nothing was changed on it
  });
});

describe("the init page", () => {
  test("a page without the private instrumentation field is reported once, and nothing else happens", () => {
    const problems: string[] = [];
    const init = createInitPage(
      { addPage: () => undefined, callBegan: () => undefined, callEnded: () => undefined },
      (problem) => problems.push(problem),
    );
    init({
      page: {
        // A page the MCP gave us, whose playwright-core lacks the private field.
        isClosed: () => false,
        listeners: () => [],
        off: () => undefined,
        on: () => undefined,
      },
    });
    expect(problems).toEqual(["this playwright-core has no page._instrumentation"]);
  });

  test("a page with it: the connection's call reports are followed once, and the tab is added", () => {
    const problems: string[] = [];
    const added: unknown[] = [];
    const listened: unknown[] = [];
    const init = createInitPage(
      {
        addPage: (page) => added.push(page),
        callBegan: () => undefined,
        callEnded: () => undefined,
      },
      (problem) => problems.push(problem),
    );
    const page = {
      _instrumentation: {
        addListener: (listener: unknown) => listened.push(listener),
        other: 1,
      },
      isClosed: () => false,
      listeners: () => [],
      off: () => undefined,
      on: () => undefined,
    };
    init({ page });
    init({ page });
    expect(added).toHaveLength(2);
    expect(listened).toHaveLength(1); // one listener per connection, not per tab
    expect(problems).toEqual([]);
  });

  test("anything a tab throws goes to the warning, never into the MCP", () => {
    const problems: string[] = [];
    const init = createInitPage(
      {
        addPage: () => {
          throw new Error("the tab is gone");
        },
        callBegan: () => undefined,
        callEnded: () => undefined,
      },
      (problem) => problems.push(problem),
    );
    init({
      page: {
        _instrumentation: { addListener: () => undefined },
        isClosed: () => false,
        listeners: () => [],
        off: () => undefined,
        on: () => undefined,
      },
    });
    expect(problems).toEqual(["could not follow the tab: the tab is gone"]);
  });
});
