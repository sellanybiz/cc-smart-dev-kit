/**
 * The tab filter's rules (`cdp-tab-filter.ts`): which pages a session sees, what is refused,
 * and what an ending session closes.
 *
 * Every case drives the filter as Chrome and Playwright do: `fromClient` for a command
 * Playwright sends, `fromBrowser` for an event or an answer Chrome sends.
 */
import { describe, expect, test } from "bun:test";
import { CdpTabFilter, FILTER_COMMAND_ID_START } from "./cdp-tab-filter";

const DOWNLOADS = "/tmp/cc-smart-dev-kit-test-downloads";

function filter(): CdpTabFilter {
  return new CdpTabFilter({ downloadsPath: DOWNLOADS });
}

/** The `Target.createTarget` a session sends; returns its command id. */
function create(f: CdpTabFilter, id = 1): number {
  f.fromClient(
    JSON.stringify({ id, method: "Target.createTarget", params: { url: "about:blank" } }),
  );
  return id;
}

/** Chrome's answer to `Target.createTarget`: everything the filter sent the client. */
function created(f: CdpTabFilter, id: number, targetId: string) {
  return f.fromBrowser(JSON.stringify({ id, result: { targetId } }));
}

/** Chrome's attach for a new page, before the create's answer: everything it sent back. */
function attachedAtTop(
  f: CdpTabFilter,
  sessionId: string,
  info: { browserContextId?: string; openerId?: string; targetId: string; type?: string },
) {
  return f.fromBrowser(
    JSON.stringify({
      method: "Target.attachedToTarget",
      params: {
        sessionId,
        targetInfo: { ...info, targetId: info.targetId, type: info.type ?? "page" },
      },
    }),
  );
}

/** What the filter sent to Chrome, parsed. */
function toBrowser(f: CdpTabFilter, raw: string): Record<string, unknown>[] {
  return f
    .fromClient(raw)
    .toBrowser.map((message) => JSON.parse(message) as Record<string, unknown>);
}

describe("the tab filter: one session's own pages", () => {
  test("a created page is this session's: its attach and answer reach the client", () => {
    const f = filter();
    create(f);
    // Chrome sends the attach BEFORE the create's answer; it is held, then handed over.
    expect(attachedAtTop(f, "session-1", { targetId: "T1" }).toClient).toEqual([]);
    const out = created(f, 1, "T1");
    expect(out.toClient).toHaveLength(2); // the held attach, then the answer
    expect(JSON.parse(out.toClient[0] ?? "{}")).toMatchObject({
      method: "Target.attachedToTarget",
      params: { sessionId: "session-1" },
    });
    // The page gets focus emulation: Playwright skips it over CDP, and without it a page
    // hidden behind a popup stops painting.
    expect(out.toBrowser.map((message) => JSON.parse(message))).toContainEqual({
      id: expect.any(Number),
      method: "Emulation.setFocusEmulationEnabled",
      params: { enabled: true },
      sessionId: "session-1",
    });
    // A command on the page's own session reaches Chrome unchanged.
    const forwarded = toBrowser(
      f,
      JSON.stringify({
        id: 9,
        method: "Runtime.evaluate",
        params: { expression: "1" },
        sessionId: "session-1",
      }),
    );
    expect(forwarded).toEqual([
      { id: 9, method: "Runtime.evaluate", params: { expression: "1" }, sessionId: "session-1" },
    ]);
  });

  test("another session's page is let go: resumed, then detached, and never passed on", () => {
    const f = filter();
    expect(attachedAtTop(f, "someone-else", { targetId: "T9" }).toClient).toEqual([]);
    const out = f.fromBrowser(JSON.stringify({ method: "Target.attachedToTarget" })).toClient;
    expect(out).toEqual([]);
    // A command on that session fails as if the session did not exist.
    const refused = f.fromClient(
      JSON.stringify({ id: 5, method: "Runtime.evaluate", params: {}, sessionId: "someone-else" }),
    ).toClient;
    expect(JSON.parse(refused[0] ?? "{}")).toMatchObject({
      error: { code: -32001 },
      id: 5,
    });
  });

  test("a popup of this session's page is this session's (its opener says so)", () => {
    const f = filter();
    create(f);
    attachedAtTop(f, "session-1", { targetId: "T1" });
    created(f, 1, "T1");
    const toClient = attachedAtTop(f, "session-2", { openerId: "T1", targetId: "T2" }).toClient;
    expect(toClient).toHaveLength(1);
    expect(JSON.parse(toClient[0] ?? "{}")).toMatchObject({ params: { sessionId: "session-2" } });
  });

  test("a page in a browser context this session created is this session's", () => {
    const f = filter();
    f.fromClient(JSON.stringify({ id: 1, method: "Target.createBrowserContext", params: {} }));
    f.fromBrowser(JSON.stringify({ id: 1, result: { browserContextId: "C1" } }));
    expect(
      attachedAtTop(f, "s1", { browserContextId: "C1", targetId: "T1" }).toClient,
    ).toHaveLength(1);
    // And another context's page is not.
    expect(attachedAtTop(f, "s2", { browserContextId: "C2", targetId: "T2" }).toClient).toEqual([]);
  });

  test("Target.getTargets is answered with this session's targets only", () => {
    const f = filter();
    const messages = toBrowser(
      f,
      JSON.stringify({ id: 7, method: "Target.getTargets", params: {} }),
    );
    expect(messages).toEqual([{ id: 7, method: "Target.getTargets", params: {} }]);
    const out = f.fromBrowser(
      JSON.stringify({
        id: 7,
        result: {
          targetInfos: [
            { targetId: "T1", type: "page" },
            { targetId: "OTHER", type: "page" },
          ],
        },
      }),
    ).toClient;
    expect(JSON.parse(out[0] ?? "{}")).toEqual({
      id: 7,
      result: { targetInfos: [] },
    });
  });
});

describe("the tab filter: what is refused on the shared browser", () => {
  const refused = (raw: string): string => {
    const f = filter();
    const out = f.fromClient(raw).toClient;
    return JSON.parse(out[0] ?? "{}").error?.message ?? "";
  };

  test("Browser.close closes this session's pages only", () => {
    const f = filter();
    create(f);
    attachedAtTop(f, "session-1", { targetId: "T1" });
    created(f, 1, "T1");
    const out = f
      .fromClient(JSON.stringify({ id: 4, method: "Browser.close" }))
      .toBrowser.map((message) => JSON.parse(message) as Record<string, unknown>);
    expect(out).toEqual([
      { id: out[0]?.id, method: "Target.closeTarget", params: { targetId: "T1" } },
    ]);
  });

  test("the browser's own powers are refused, with the reason", () => {
    expect(refused(JSON.stringify({ id: 1, method: "Browser.crash" }))).toBe(
      "Browser.crash is refused: every Claude session shares this browser.",
    );
    expect(refused(JSON.stringify({ id: 1, method: "Network.clearBrowserCookies" }))).toBe(
      "Network.clearBrowserCookies is refused: it would sign every Claude session out.",
    );
    expect(
      refused(
        JSON.stringify({
          id: 1,
          method: "Storage.clearDataForOrigin",
          params: { storageTypes: "cookies" },
        }),
      ),
    ).toBe(
      "Storage.clearDataForOrigin with cookies is refused: it would sign every Claude session out.",
    );
    expect(refused(JSON.stringify({ id: 1, method: "Fetch.enable", params: {} }))).toContain(
      "Fetch.enable is refused on the browser's own session",
    );
    expect(
      refused(
        JSON.stringify({ id: 1, method: "Target.closeTarget", params: { targetId: "OTHER" } }),
      ),
    ).toBe("No target with given id found");
  });

  test("Page.bringToFront and Target.activateTarget never reach Chrome: nothing is raised on the person's desktop", () => {
    const f = filter();
    create(f);
    attachedAtTop(f, "session-1", { targetId: "T1" });
    created(f, 1, "T1");
    const front = f.fromClient(JSON.stringify({ id: 2, method: "Page.bringToFront", params: {} }));
    expect(front.toBrowser).toEqual([]);
    expect(JSON.parse(front.toClient[0] ?? "{}")).toEqual({ id: 2, result: {} });
    const activate = f.fromClient(
      JSON.stringify({ id: 3, method: "Target.activateTarget", params: { targetId: "T1" } }),
    );
    expect(activate.toBrowser).toEqual([]);
    expect(JSON.parse(activate.toClient[0] ?? "{}")).toEqual({ id: 3, result: {} });
    // Another session's target: not there.
    expect(
      JSON.parse(
        f.fromClient(
          JSON.stringify({ id: 4, method: "Target.activateTarget", params: { targetId: "OTHER" } }),
        ).toClient[0] ?? "{}",
      ),
    ).toMatchObject({ error: { message: "No target with given id found" } });
  });

  test("a new page is its own window, and downloads are set before it", () => {
    const f = filter();
    const out = toBrowser(
      f,
      JSON.stringify({ id: 8, method: "Target.createTarget", params: { url: "about:blank" } }),
    );
    expect(out).toEqual([
      {
        id: FILTER_COMMAND_ID_START,
        method: "Browser.setDownloadBehavior",
        params: { behavior: "allowAndName", downloadPath: DOWNLOADS, eventsEnabled: true },
      },
      {
        id: 8,
        method: "Target.createTarget",
        params: { background: true, newWindow: true, url: "about:blank" },
      },
    ]);
  });

  test("the filter's own command ids are refused, and a browser-wide session may only attach", () => {
    expect(
      refused(JSON.stringify({ id: FILTER_COMMAND_ID_START, method: "Runtime.evaluate" })),
    ).toContain("belong to the tab filter");
    const f = filter();
    f.fromClient(JSON.stringify({ id: 1, method: "Target.attachToBrowserTarget", params: {} }));
    f.fromBrowser(JSON.stringify({ id: 1, result: { sessionId: "browser-1" } }));
    const out = f.fromClient(
      JSON.stringify({ id: 2, method: "Fetch.enable", params: {}, sessionId: "browser-1" }),
    ).toClient;
    expect(JSON.parse(out[0] ?? "{}").error.message).toContain(
      "is refused on a browser-wide session",
    );
  });

  test("a message that is not a CDP command is dropped, and said in the log", () => {
    const out = filter().fromClient("not json at all");
    expect(out.toBrowser).toEqual([]);
    expect(out.toClient).toEqual([]);
    expect(out.log[0]).toContain("dropped a message from Playwright that is not a CDP command");
  });
});

describe("the tab filter: what an ending session does", () => {
  test("it closes its own pages and waits for Chrome's answers", () => {
    const f = filter();
    create(f);
    attachedAtTop(f, "session-1", { targetId: "T1" });
    created(f, 1, "T1");
    const closed = f.closeOwnPages();
    const close = JSON.parse(closed.toBrowser[0] ?? "{}") as {
      id: number;
      method: string;
      params: unknown;
    };
    expect(close.method).toBe("Target.closeTarget");
    expect(close.params).toEqual({ targetId: "T1" });
    expect(closed.awaitIds).toEqual([close.id]);
    // Chrome's answer is swallowed, never passed to a client that has gone.
    const out = f.fromBrowser(JSON.stringify({ id: close.id, result: {} }));
    expect(out.toClient).toEqual([]);
    expect(out.answered).toEqual([close.id]);
  });

  test("a page that becomes this session's after its client left closes at once", () => {
    const f = filter();
    create(f);
    f.closeOwnPages();
    const out = created(f, 1, "T1");
    // The answer is for a client that has gone (the socket drops it), and the filter closes
    // the new page: nobody else would ever close it.
    expect(out.closing).toHaveLength(1);
    expect(
      out.toBrowser.map((message) => JSON.parse(message) as Record<string, unknown>),
    ).toContainEqual({
      id: out.closing[0],
      method: "Target.closeTarget",
      params: { targetId: "T1" },
    });
  });
});
