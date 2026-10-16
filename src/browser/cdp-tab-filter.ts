/**
 * The tab filter: it sits between ONE session's Playwright and the ONE Chrome every Claude
 * session shares, and makes that session see only its own pages. Stock Playwright, joined
 * over CDP (Chrome's debugging protocol), adopts every page in the browser, so session B
 * would drive session A's tab (microsoft/playwright#42961).
 *
 * A page is this session's when its `Target.createTarget` made it, when it opened from one
 * of this session's pages or frames (a popup names its opener in `targetInfo.openerId` —
 * measured in the project this was ported from for `window.open`, `noopener`, `target=_blank`
 * and `rel=noopener`), or when it lives in a browser context this session created. Everything
 * else is another session's, a worker the whole profile shares, or a tab the person opened:
 * this session never hears of it, and the filter lets go of it at once. It also turns
 * downloads on in the shared browser, which Playwright does not do over CDP
 * (`sendDownloadBehavior`).
 *
 * Pure: no sockets, no timers. One instance per client connection, which has one
 * connection to Chrome of its own, so command ids and session ids pass through unchanged.
 * `cdp-tab-filter-server.ts` does the I/O.
 */

/**
 * The first id the filter gives its own commands, far above any id Playwright reaches
 * (it counts up from 1). Chrome reads ids as 32-bit integers, so they must stay under
 * 2_147_483_648 — a billion commands away.
 */
export const FILTER_COMMAND_ID_START = 1_000_000_000;

/** Chrome's own code for a message on a session it does not know. */
const SESSION_NOT_FOUND = -32001;
/** The code every other refusal carries — Chrome's generic server error. */
const REFUSED = -32000;
/** Chrome's own words for a target it does not know: a foreign page looks like no page. */
const NO_TARGET = "No target with given id found";

/** What one message in turns into. Each list goes out in order. */
export interface FilterOutput {
  /** Ids of the filter's own commands that Chrome answered in this message. */
  answered: number[];
  /**
   * Ids of the closes sent for a page that became this session's after its client left
   * (`closeOwnPages`). The ending connection waits for their answers too.
   */
  closing: number[];
  /** Lines for the launcher's log — something arrived that was not CDP. */
  log: string[];
  toBrowser: string[];
  toClient: string[];
}

export interface CdpTabFilterOptions {
  /**
   * Where Chrome saves downloads: Playwright's own downloads folder. Over CDP that is its
   * `artifactsDir`, which the MCP sets to `<output dir>/traces` — the same for every session.
   */
  downloadsPath: string;
}

type Json = Record<string, unknown>;

interface TargetInfo {
  browserContextId: string | undefined;
  openerId: string | undefined;
  targetId: string;
  type: string;
}

interface Command {
  id: number;
  method: string;
  params: Json;
  raw: string;
  sessionId: string | undefined;
}

/** A session the client knows: one of its targets, or a browser session it opened. */
type ClientSession = { kind: "browser" } | { kind: "target"; targetId: string };

/** What to do with Chrome's answer to a client command. */
type AnswerRule =
  | { kind: "attach"; targetId: string }
  | { kind: "browser-session" }
  | { kind: "context" }
  | { kind: "contexts" }
  | { kind: "create" }
  | { kind: "targets" };

/** A session Chrome attached to a held page, and the session it hangs off. */
interface AttachedSession {
  id: string;
  parent: string | undefined;
}

/** A page that appeared while a create was in flight: it may be the page being created. */
interface HeldTarget {
  info: TargetInfo;
  /** Everything Chrome said about it so far, in order: the client gets it all if it is ours. */
  messages: string[];
  sessions: AttachedSession[];
}

/** Storage types whose clearing signs people out. */
const SIGN_OUT_STORAGE_TYPES = new Set(["all", "cookies"]);

/**
 * All a browser session (`Target.attachToBrowserTarget`) may do: attach to and detach from
 * this session's own pages and frames. Playwright's `context.newCDPSession(page)` needs
 * exactly that (it attaches through a browser session of its own); anything else sent
 * there — `Fetch.enable`, `Tracing.start`, `Target.setAutoAttach` — reaches every page in
 * the browser.
 */
const BROWSER_SESSION_COMMANDS = new Set(["Target.attachToTarget", "Target.detachFromTarget"]);

/** Page actions that can start a download: the download setting goes out again before each. */
const DOWNLOAD_STARTERS = new Set([
  "Input.dispatchKeyEvent",
  "Input.dispatchMouseEvent",
  "Input.dispatchTouchEvent",
  "Page.navigate",
  "Page.navigateToHistoryEntry",
  "Page.reload",
]);

export class CdpTabFilter {
  private readonly answerRules = new Map<string, AnswerRule>();
  /** `Browser.close` answers that wait for the page closes it sent. */
  private readonly browserCloses: { reply: string; waiting: Set<number> }[] = [];
  /** Own pages a close was already sent for. */
  private readonly closeSent = new Set<string>();
  /** Set by `closeOwnPages`: from then on, a page that becomes this session's closes at once. */
  private clientGone = false;
  /** Own top-level pages that already have focus emulation. */
  private readonly focused = new Set<string>();
  private readonly held = new Map<string, HeldTarget>();
  private readonly heldSessions = new Map<string, string>();
  private inFlightCreates = 0;
  /** Sessions the filter let go of: Chrome's detach for each is swallowed. */
  private readonly letGo = new Set<string>();
  private nextId = FILTER_COMMAND_ID_START;
  /** The download setting sent when the connection opened: a refusal of it is logged. */
  private openingDownloadId: number | undefined;
  private out = emptyOutput();
  private readonly ownCommands = new Set<number>();
  private readonly ownContexts = new Set<string>();
  /** The top-level pages among `ownTargets` — what closes when the session ends. */
  private readonly ownPages = new Set<string>();
  /**
   * This session's targets: pages, their frames and workers. Never taken back: Chrome
   * never reuses a target id, so a page that is gone costs one failed close at the end.
   */
  private readonly ownTargets = new Set<string>();
  /** Close commands Chrome has not answered yet. */
  private readonly pendingCloses = new Set<number>();
  private readonly sessions = new Map<string, ClientSession>();

  constructor(private readonly options: CdpTabFilterOptions) {}

  /** `Target.createTarget` commands Chrome has not answered yet. */
  get createsInFlight(): number {
    return this.inFlightCreates;
  }

  /**
   * Close this session's own top-level pages — for when its client goes away. Frames and
   * workers close with their page. From then on a page that becomes this session's — a
   * create or a popup still on its way — closes at once (`FilterOutput.closing`): no one
   * else would ever close it. `awaitIds` are the close commands still unanswered, earlier
   * ones (`Browser.close`) included; `fromBrowser` reports each one's answer.
   */
  closeOwnPages(): { awaitIds: number[]; toBrowser: string[] } {
    this.out = emptyOutput();
    this.clientGone = true;
    this.closePages();
    return { awaitIds: [...this.pendingCloses], toBrowser: this.out.toBrowser };
  }

  /** A message Chrome sent. */
  fromBrowser(raw: string): FilterOutput {
    this.out = emptyOutput();
    const message = parseObject(raw);
    if (message === undefined) {
      this.out.log.push(
        `dropped a message from Chrome that is not a JSON object (${String(raw.length)} characters)`,
      );
      return this.out;
    }
    const sessionId = readString(message, "sessionId");
    const id = message.id;
    if (typeof id === "number") {
      this.onAnswer(message, id, sessionId, raw);
      return this.out;
    }
    const method = readString(message, "method");
    if (method === undefined) {
      this.out.log.push("dropped a message from Chrome that is neither an answer nor an event");
      return this.out;
    }
    const params = message.params;
    this.onEvent(method, isJson(params) ? params : {}, sessionId, raw);
    return this.out;
  }

  /** A message the client (this session's Playwright) sent. */
  fromClient(raw: string): FilterOutput {
    this.out = emptyOutput();
    const message = parseObject(raw);
    const id = message?.id;
    const method = message?.method;
    if (message === undefined || typeof id !== "number" || typeof method !== "string") {
      // Never forwarded: a message the filter cannot read, it cannot vouch for.
      this.out.log.push(
        `dropped a message from Playwright that is not a CDP command (${String(raw.length)} characters)`,
      );
      return this.out;
    }
    const params = message.params;
    this.onCommand({
      id,
      method,
      params: isJson(params) ? params : {},
      raw,
      sessionId: readString(message, "sessionId"),
    });
    return this.out;
  }

  /** What goes to Chrome the moment the connection opens, before anything the client sent. */
  openingCommands(): string[] {
    this.out = emptyOutput();
    this.openingDownloadId = this.sendDownloadBehavior();
    return this.out.toBrowser;
  }

  /** Make a target this session's, and `sessionId` a session the client may use. */
  private adopt(info: TargetInfo, sessionId: string): void {
    this.ownTargets.add(info.targetId);
    if (info.type === "page") this.ownPage(info.targetId);
    this.sessions.set(sessionId, { kind: "target", targetId: info.targetId });
    if (
      !this.ownPages.has(info.targetId) ||
      this.closeSent.has(info.targetId) ||
      this.focused.has(info.targetId)
    )
      return;
    // Playwright sends this to every page it launches, and skips it over CDP (`noDefaults`).
    // Without it a page hidden behind its own popup tab stops painting, and clicks there
    // time out (measured on a headed Chrome in the project this was ported from). Once per
    // page: it lasts as long as the session.
    this.focused.add(info.targetId);
    this.send("Emulation.setFocusEmulationEnabled", { enabled: true }, sessionId);
  }

  private answer(command: Command, result: Json): void {
    this.out.toClient.push(withSession({ id: command.id, result }, command.sessionId));
  }

  /** Chrome's `Target.attachedToTarget` on the root, or on a browser session the client opened. */
  private onAttachedAtTop(params: Json, parent: string | undefined, raw: string): void {
    const sessionId = readString(params, "sessionId");
    const info = readTargetInfo(params.targetInfo);
    if (sessionId === undefined || info === undefined) {
      this.out.log.push("dropped a Target.attachedToTarget without a session or target");
      return;
    }
    if (this.isOurs(info)) {
      this.adopt(info, sessionId);
      this.out.toClient.push(raw);
      return;
    }
    // Chrome sends a new page's attach BEFORE the createTarget answer, and Playwright needs
    // it in that order (`doCreateNewPage` reads its page map right after the answer). Until
    // the answer names the page, any new page may be the one being created.
    if (info.type === "page" && this.inFlightCreates > 0) {
      this.hold(info, raw, { id: sessionId, parent });
      return;
    }
    // Another session's page, a worker the whole profile shares, or the person's own tab.
    this.letGoOf(sessionId, parent);
  }

  /** Chrome's answer to a command: the filter's own, or the client's. */
  private onAnswer(message: Json, id: number, sessionId: string | undefined, raw: string): void {
    if (this.ownCommands.delete(id)) {
      // Never passed on: Playwright fails on an answer to an id it did not send.
      this.out.answered.push(id);
      const error = message.error;
      if (id === this.openingDownloadId && isJson(error)) {
        // Every resend is the same command: one line says downloads will not work.
        this.out.log.push(
          `Chrome refused to turn downloads on: ${readString(error, "message") ?? "no reason given"}`,
        );
      }
      this.pendingCloses.delete(id);
      this.settleBrowserCloses(id);
      return;
    }
    const key = answerKey(sessionId, id);
    const rule = this.answerRules.get(key);
    if (rule === undefined) {
      this.out.toClient.push(raw);
      return;
    }
    this.answerRules.delete(key);
    const result = isJson(message.result) ? message.result : undefined;
    switch (rule.kind) {
      case "attach": {
        const attached = result === undefined ? undefined : readString(result, "sessionId");
        if (attached !== undefined)
          this.sessions.set(attached, { kind: "target", targetId: rule.targetId });
        break;
      }
      case "browser-session": {
        const browserSession = result === undefined ? undefined : readString(result, "sessionId");
        if (browserSession !== undefined) this.sessions.set(browserSession, { kind: "browser" });
        break;
      }
      case "context": {
        const context = result === undefined ? undefined : readString(result, "browserContextId");
        if (context !== undefined) this.ownContexts.add(context);
        break;
      }
      case "contexts": {
        const ids = result?.browserContextIds;
        if (result === undefined || !Array.isArray(ids)) break;
        const own = ids.filter(
          (context): context is string =>
            typeof context === "string" && this.ownContexts.has(context),
        );
        this.out.toClient.push(
          withSession({ id, result: { ...result, browserContextIds: own } }, sessionId),
        );
        return;
      }
      case "create": {
        this.inFlightCreates -= 1;
        const targetId = result === undefined ? undefined : readString(result, "targetId");
        if (targetId !== undefined) {
          this.ownTargets.add(targetId);
          this.ownPage(targetId);
          this.release(targetId, true);
        }
        this.out.toClient.push(raw);
        if (this.inFlightCreates === 0) this.releaseAll();
        return;
      }
      case "targets": {
        const infos = result?.targetInfos;
        if (result === undefined || !Array.isArray(infos)) break;
        const own = infos.filter((value: unknown) => {
          const info = readTargetInfo(value);
          return info !== undefined && this.ownTargets.has(info.targetId);
        });
        this.out.toClient.push(
          withSession({ id, result: { ...result, targetInfos: own } }, sessionId),
        );
        return;
      }
    }
    this.out.toClient.push(raw);
  }

  private onCommand(command: Command): void {
    const { id, method, params, sessionId } = command;
    if (id >= FILTER_COMMAND_ID_START) {
      this.refuse(
        command,
        `Command ids from ${String(FILTER_COMMAND_ID_START)} up belong to the tab filter.`,
      );
      return;
    }
    const session = sessionId === undefined ? undefined : this.sessions.get(sessionId);
    if (sessionId !== undefined && session === undefined) {
      // Another session's page, one let go, or one still held: to this client, none exist.
      this.refuse(command, "Session with given id not found.", SESSION_NOT_FOUND);
      return;
    }
    if (session?.kind === "browser" && !BROWSER_SESSION_COMMANDS.has(method)) {
      // Only user code opens one (`browser_run_code_unsafe`); Playwright's MCP never does.
      this.refuse(
        command,
        `${method} is refused on a browser-wide session: every Claude session shares this browser, so it would reach all of them. Use page.context().newCDPSession(page) for a page of your own.`,
      );
      return;
    }
    // Checked on every session: a page session reaches these domains too.
    switch (method) {
      case "Browser.close":
        // The browser is everyone's: "close the browser" closes this session's pages only.
        this.closeForClient(command);
        return;
      case "Browser.crash":
      case "Browser.crashGpuProcess":
        this.refuse(command, `${method} is refused: every Claude session shares this browser.`);
        return;
      case "Browser.getWindowForTarget":
      case "Target.getTargetInfo": {
        // Without a target id it asks about the session's own target (Playwright's barrier).
        const targetId = readString(params, "targetId");
        if (targetId !== undefined && !this.ownTargets.has(targetId)) {
          this.refuse(command, NO_TARGET);
          return;
        }
        break;
      }
      case "Browser.setDownloadBehavior":
        // Per browser context. The default one every session shares is the filter's to set
        // (`sendDownloadBehavior`), and another session's is not this one's: answered here,
        // as Playwright's extension relay does. A context this session created is its own.
        if (!this.ownContexts.has(readString(params, "browserContextId") ?? "")) {
          this.answer(command, {});
          return;
        }
        break;
      case "Fetch.enable":
        // On a page's session it intercepts that page (Playwright's routing); on the root it
        // would pause the requests of every page in the browser.
        if (sessionId === undefined) {
          this.refuse(
            command,
            "Fetch.enable is refused on the browser's own session: it would pause the requests of every Claude session's pages and the person's own tabs.",
          );
          return;
        }
        break;
      case "Network.clearBrowserCookies":
        this.refuse(command, `${method} is refused: it would sign every Claude session out.`);
        return;
      case "Page.bringToFront":
        // The shared Chrome sits on a person's desktop: raising a window pulls it over
        // whatever they are working in. Every page of the session acts as if it had focus
        // already (`Emulation.setFocusEmulationEnabled`), so the raise adds nothing for
        // Claude: answered here, never sent. Playwright's MCP sends it on a tab switch and
        // when recording starts.
        this.answer(command, {});
        return;
      case "Storage.clearCookies": {
        const context = readString(params, "browserContextId");
        if (context === undefined || !this.ownContexts.has(context)) {
          this.refuse(
            command,
            `${method} is refused outside this session's own browser contexts: it would sign every Claude session out.`,
          );
          return;
        }
        break;
      }
      case "Storage.clearDataForOrigin":
      case "Storage.clearDataForStorageKey":
        if (clearsSignIns(params)) {
          this.refuse(
            command,
            `${method} with cookies is refused: it would sign every Claude session out.`,
          );
          return;
        }
        break;
      case "Target.activateTarget":
        // The same raise, by target id: another session's page does not exist, and the
        // session's own is answered without reaching Chrome, as Page.bringToFront is.
        if (!this.ownTargets.has(readString(params, "targetId") ?? "")) {
          this.refuse(command, NO_TARGET);
          return;
        }
        this.answer(command, {});
        return;
      case "Target.attachToTarget":
      case "Target.autoAttachRelated":
      case "Target.closeTarget":
      case "Target.exposeDevToolsProtocol":
        if (!this.ownTargets.has(readString(params, "targetId") ?? "")) {
          this.refuse(command, NO_TARGET);
          return;
        }
        break;
      case "Target.detachFromTarget":
      case "Target.sendMessageToTarget":
        if (!this.namesOwnSessionOrTarget(params)) {
          this.refuse(command, NO_TARGET);
          return;
        }
        break;
      case "Target.disposeBrowserContext": {
        const context = readString(params, "browserContextId") ?? "";
        if (!this.ownContexts.has(context)) {
          this.refuse(command, `Failed to find context with id ${context}`);
          return;
        }
        break;
      }
    }
    this.forward(command);
  }

  /** Chrome's event: on the root, on a browser session, or on one of the client's targets. */
  private onEvent(method: string, params: Json, sessionId: string | undefined, raw: string): void {
    if (sessionId === undefined) {
      this.onTopEvent(method, params, undefined, raw);
      return;
    }
    const heldTarget = this.heldSessions.get(sessionId);
    if (heldTarget !== undefined) {
      this.held.get(heldTarget)?.messages.push(raw);
      return;
    }
    const session = this.sessions.get(sessionId);
    // A session the client never heard of: one the filter let go of, about to detach.
    if (session === undefined) return;
    if (session.kind === "browser") {
      this.onTopEvent(method, params, sessionId, raw);
      return;
    }
    if (method === "Target.attachedToTarget") {
      // A frame or worker of one of this session's targets is this session's too — so a
      // popup a cross-process frame opens (its opener is the frame) is this session's.
      const child = readString(params, "sessionId");
      const info = readTargetInfo(params.targetInfo);
      if (child !== undefined && info !== undefined) {
        this.ownTargets.add(info.targetId);
        this.sessions.set(child, { kind: "target", targetId: info.targetId });
      }
    } else if (method === "Target.detachedFromTarget") {
      const child = readString(params, "sessionId");
      if (child !== undefined) this.sessions.delete(child);
    }
    this.out.toClient.push(raw);
  }

  /** An event at the top: the root session, or a browser session the client opened. */
  private onTopEvent(method: string, params: Json, parent: string | undefined, raw: string): void {
    switch (method) {
      case "Target.attachedToTarget":
        this.onAttachedAtTop(params, parent, raw);
        return;
      case "Target.detachedFromTarget": {
        const sessionId = readString(params, "sessionId");
        if (sessionId === undefined) return;
        // The detach that follows a let-go: the client never heard of that session.
        if (this.letGo.delete(sessionId)) return;
        const heldTarget = this.heldSessions.get(sessionId);
        if (heldTarget !== undefined) {
          // A held page that went away: kept in its story, in case it turns out to be ours.
          this.heldSessions.delete(sessionId);
          const entry = this.held.get(heldTarget);
          if (entry !== undefined) {
            entry.sessions = entry.sessions.filter((session) => session.id !== sessionId);
            entry.messages.push(raw);
          }
          return;
        }
        if (this.sessions.delete(sessionId)) this.out.toClient.push(raw);
        return;
      }
      case "Target.receivedMessageFromTarget": {
        // The old, unflattened way to talk to a target: only on the client's own sessions.
        const sessionId = readString(params, "sessionId");
        if (sessionId !== undefined && this.sessions.has(sessionId)) this.out.toClient.push(raw);
        return;
      }
      case "Target.targetCrashed":
      case "Target.targetDestroyed": {
        const targetId = readString(params, "targetId");
        if (targetId === undefined) return;
        if (this.ownTargets.has(targetId)) this.out.toClient.push(raw);
        else this.held.get(targetId)?.messages.push(raw);
        return;
      }
      case "Target.targetCreated":
      case "Target.targetInfoChanged": {
        // Sent only to a client that turned on target discovery; Playwright does not.
        const info = readTargetInfo(params.targetInfo);
        if (info === undefined) return;
        if (this.isOurs(info)) {
          this.ownTargets.add(info.targetId);
          if (info.type === "page") this.ownPage(info.targetId);
          this.out.toClient.push(raw);
        } else if (info.type === "page" && this.inFlightCreates > 0) {
          this.hold(info, raw, undefined);
        }
        return;
      }
      default:
        // Browser-level events: tracing this client started, and downloads. Every session
        // turns download events on, so each hears every download in the shared context;
        // Playwright drops one whose frame is not one of its pages.
        this.out.toClient.push(raw);
    }
  }

  private closeForClient(command: Command): void {
    const waiting = new Set(this.closePages());
    const reply = withSession({ id: command.id, result: {} }, command.sessionId);
    if (waiting.size === 0) this.out.toClient.push(reply);
    else this.browserCloses.push({ reply, waiting });
  }

  /** Send a close for an own page not already closing; the new command's id. */
  private closePage(targetId: string): number | undefined {
    if (this.closeSent.has(targetId)) return undefined;
    this.closeSent.add(targetId);
    const id = this.send("Target.closeTarget", { targetId }, undefined);
    this.pendingCloses.add(id);
    return id;
  }

  /** Send a close for each own page not already closing; the ids of the new commands. */
  private closePages(): number[] {
    const sent: number[] = [];
    for (const targetId of this.ownPages) {
      const id = this.closePage(targetId);
      if (id !== undefined) sent.push(id);
    }
    return sent;
  }

  private expectAnswer(command: Command, rule: AnswerRule): void {
    this.answerRules.set(answerKey(command.sessionId, command.id), rule);
  }

  /** Pass a client command to Chrome, with the changes some commands need. */
  private forward(command: Command): void {
    const { method, params } = command;
    if (DOWNLOAD_STARTERS.has(method)) this.sendDownloadBehavior();
    switch (method) {
      case "Target.attachToBrowserTarget":
        this.expectAnswer(command, { kind: "browser-session" });
        break;
      case "Target.attachToTarget":
        this.expectAnswer(command, {
          kind: "attach",
          targetId: readString(params, "targetId") ?? "",
        });
        break;
      case "Target.createBrowserContext":
        // The context goes when this connection goes: a session never leaves one behind.
        this.expectAnswer(command, { kind: "context" });
        this.out.toBrowser.push(rewrite(command, { ...params, disposeOnDetach: true }));
        return;
      case "Target.createTarget":
        // Its own window, shown without focus. A plain new tab lands in the window used
        // last — another session's — and a background tab is hidden and can stall.
        this.sendDownloadBehavior();
        this.expectAnswer(command, { kind: "create" });
        this.inFlightCreates += 1;
        this.out.toBrowser.push(rewrite(command, { ...params, background: true, newWindow: true }));
        return;
      case "Target.getBrowserContexts":
        this.expectAnswer(command, { kind: "contexts" });
        break;
      case "Target.getTargets":
        this.expectAnswer(command, { kind: "targets" });
        break;
    }
    this.out.toBrowser.push(command.raw);
  }

  private hold(info: TargetInfo, raw: string, session: AttachedSession | undefined): void {
    const entry = this.held.get(info.targetId) ?? { info, messages: [], sessions: [] };
    entry.info = info;
    entry.messages.push(raw);
    if (session !== undefined) {
      entry.sessions.push(session);
      this.heldSessions.set(session.id, info.targetId);
    }
    this.held.set(info.targetId, entry);
  }

  private isOurs(info: TargetInfo): boolean {
    if (this.ownTargets.has(info.targetId)) return true;
    if (info.type !== "page") return false;
    if (info.openerId !== undefined && this.ownTargets.has(info.openerId)) return true;
    return info.browserContextId !== undefined && this.ownContexts.has(info.browserContextId);
  }

  /**
   * Let go of a target: resume it, then detach. A new page waits until EVERY connection
   * that auto-attached to it resumes it or detaches (Chromium source; measured in the
   * project this was ported from: it hangs otherwise), so this is sent at once and never
   * waits on anything.
   */
  private letGoOf(sessionId: string, parent: string | undefined): void {
    this.letGo.add(sessionId);
    this.send("Runtime.runIfWaitingForDebugger", {}, sessionId);
    this.send("Target.detachFromTarget", { sessionId }, parent);
  }

  private namesOwnSessionOrTarget(params: Json): boolean {
    const sessionId = readString(params, "sessionId");
    if (sessionId !== undefined) return this.sessions.has(sessionId);
    const targetId = readString(params, "targetId");
    if (targetId !== undefined) return this.ownTargets.has(targetId);
    return true; // names neither: Chrome answers with its own error
  }

  /** Make `targetId` one of this session's top-level pages — closed at once if its client is gone. */
  private ownPage(targetId: string): void {
    this.ownPages.add(targetId);
    if (!this.clientGone) return;
    const id = this.closePage(targetId);
    if (id !== undefined) this.out.closing.push(id);
  }

  private refuse(command: Command, message: string, code = REFUSED): void {
    // With the session id, so Playwright fails the call it made instead of waiting forever.
    this.out.toClient.push(
      withSession({ error: { code, message }, id: command.id }, command.sessionId),
    );
  }

  /** Hand a held page to the client, or let go of it. */
  private release(targetId: string, ours: boolean): void {
    const entry = this.held.get(targetId);
    if (entry === undefined) return;
    this.held.delete(targetId);
    for (const session of entry.sessions) this.heldSessions.delete(session.id);
    if (ours) {
      for (const session of entry.sessions) this.adopt(entry.info, session.id);
      this.out.toClient.push(...entry.messages);
    } else {
      for (const session of entry.sessions) this.letGoOf(session.id, session.parent);
    }
  }

  /** No create in flight any more: every page still held is ours by its opener, or not ours. */
  private releaseAll(): void {
    for (const [targetId, entry] of this.held) this.release(targetId, this.isOurs(entry.info));
  }

  /** Send a command of the filter's own. Its answer is swallowed. */
  private send(method: string, params: Json, sessionId: string | undefined): number {
    const id = this.nextId;
    this.nextId += 1;
    this.ownCommands.add(id);
    this.out.toBrowser.push(withSession({ id, method, params }, sessionId));
    return id;
  }

  /**
   * Downloads in the shared default context go to Playwright's downloads folder, with
   * events. Over CDP Playwright never sends this (`noDefaults`), so Chrome saves to the OS
   * Downloads folder and sends no `Browser.downloadWillBegin`: the MCP never saves or
   * reports a download (playwright-core 1.63). Every session sends the same values.
   *
   * Sent when the connection opens, then again before each new page and each page action
   * that can start a download (`DOWNLOAD_STARTERS`). The setting is one per context, the
   * last one sent wins, and when the connection that sent it last closes, Chrome resets it
   * to the browser's default (Chromium source, `DevToolsDownloadManagerDelegate::
   * ResetDownloadBehavior`): another session leaving turns it off for this one until the
   * next resend. A download a page starts on its own (a timer) in that gap lands in the OS
   * Downloads folder, unreported.
   */
  private sendDownloadBehavior(): number {
    return this.send(
      "Browser.setDownloadBehavior",
      { behavior: "allowAndName", downloadPath: this.options.downloadsPath, eventsEnabled: true },
      undefined,
    );
  }

  private settleBrowserCloses(answeredId: number): void {
    for (let index = this.browserCloses.length - 1; index >= 0; index -= 1) {
      const pending = this.browserCloses[index];
      if (pending === undefined || !pending.waiting.delete(answeredId) || pending.waiting.size > 0)
        continue;
      this.browserCloses.splice(index, 1);
      this.out.toClient.push(pending.reply);
    }
  }
}

/** Command ids are only unique within a session. */
function answerKey(sessionId: string | undefined, id: number): string {
  return `${sessionId ?? ""}:${String(id)}`;
}

function clearsSignIns(params: Json): boolean {
  const types = readString(params, "storageTypes");
  if (types === undefined) return false; // Chrome refuses it without the list
  return types.split(",").some((type) => SIGN_OUT_STORAGE_TYPES.has(type.trim()));
}

function emptyOutput(): FilterOutput {
  return { answered: [], closing: [], log: [], toBrowser: [], toClient: [] };
}

function isJson(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseObject(raw: string): Json | undefined {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined; // the caller logs it
  }
  return isJson(value) ? value : undefined;
}

function readString(object: Json, key: string): string | undefined {
  const value = object[key];
  return typeof value === "string" ? value : undefined;
}

function readTargetInfo(value: unknown): TargetInfo | undefined {
  if (!isJson(value)) return undefined;
  const targetId = readString(value, "targetId");
  const type = readString(value, "type");
  if (targetId === undefined || type === undefined) return undefined;
  return {
    browserContextId: readString(value, "browserContextId"),
    openerId: readString(value, "openerId"),
    targetId,
    type,
  };
}

function rewrite(command: Command, params: Json): string {
  return withSession({ id: command.id, method: command.method, params }, command.sessionId);
}

function withSession(fields: Json, sessionId: string | undefined): string {
  return JSON.stringify(sessionId === undefined ? fields : { ...fields, sessionId });
}
