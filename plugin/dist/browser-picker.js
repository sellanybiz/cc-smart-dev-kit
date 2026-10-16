// @bun
// src/browser/picker.ts
import { clearTimeout, setTimeout } from "timers";
var HOLD_AFTER_MS = 2000;
function createPickerHold(timers, holdAfterMs = HOLD_AFTER_MS) {
  const pages = new Map;
  const running = new Set;
  let held = true;
  let release = null;
  function apply(page, listeners, hold) {
    if (page.isClosed()) {
      pages.delete(page);
      return;
    }
    for (const listener of listeners) {
      if (hold)
        page.on("filechooser", listener);
      else
        page.off("filechooser", listener);
    }
  }
  function setHeld(hold) {
    if (held === hold)
      return;
    held = hold;
    for (const [page, listeners] of pages)
      apply(page, listeners, hold);
  }
  function stopRelease() {
    if (release === null)
      return;
    timers.clear(release.timer);
    release = null;
  }
  function startRelease() {
    stopRelease();
    release = {
      timer: timers.start(() => {
        release = null;
        setHeld(false);
      }, holdAfterMs)
    };
  }
  return {
    addPage(page) {
      const listeners = page.listeners("filechooser");
      pages.set(page, listeners);
      if (!held)
        apply(page, listeners, false);
      else if (running.size === 0 && release === null)
        startRelease();
    },
    callBegan(zone, method) {
      if (method === "updateSubscription" || running.has(zone))
        return;
      running.add(zone);
      stopRelease();
      setHeld(true);
    },
    callEnded(zone) {
      if (!running.delete(zone))
        return;
      if (running.size === 0)
        startRelease();
    }
  };
}
function reason(error) {
  return error instanceof Error ? error.message : String(error);
}
function isPickerPage(value) {
  return typeof value === "object" && value !== null && "isClosed" in value && typeof value.isClosed === "function" && "listeners" in value && typeof value.listeners === "function" && "off" in value && typeof value.off === "function" && "on" in value && typeof value.on === "function";
}
function instrumentationOf(page) {
  const target = Reflect.get(page, "_instrumentation");
  if (typeof target !== "object" || target === null)
    return null;
  const addListener = Reflect.get(target, "addListener");
  if (typeof addListener !== "function")
    return null;
  return {
    listen: (listener) => {
      Reflect.apply(addListener, target, [listener]);
    },
    target
  };
}
function methodOf(call) {
  return typeof call === "object" && call !== null ? Reflect.get(call, "method") : undefined;
}
function createInitPage(hold, warn) {
  const followed = new WeakSet;
  const callListener = {
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
    }
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
var warned = false;
function warnOnce(problem) {
  if (warned)
    return;
  warned = true;
  process.stderr.write(`[cc-smart-dev-kit-picker] ${problem} \u2014 every file picker stays held for Claude, as before
`);
}
var picker_default = createInitPage(createPickerHold({
  clear: (timer) => {
    clearTimeout(timer);
  },
  start: (run, ms) => {
    const timer = setTimeout(run, ms);
    timer.unref();
    return timer;
  }
}), warnOnce);
export {
  picker_default as default
};
