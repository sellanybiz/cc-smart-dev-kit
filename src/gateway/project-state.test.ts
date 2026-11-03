/**
 * The one effective-state reader (`src/gateway/project-state.ts`): the gateway state a Claude
 * Code session started in a folder really gets, and which file decides it. The Claude Code
 * facts it follows are GP0's live proofs (`.claude/research/2026-10-23-r6-proofs.md`):
 * - P3, the settings order: local > the folder's `.claude/settings.json` > the user file;
 * - P6 (re-proved on 2.1.310, `.claude/research/2026-10-25-r6-recheck.md`), the local file is
 *   read at the **main checkout's root** for every subfolder and every linked worktree, and the
 *   **starting folder's own** local file is read too: key by key the root's wins, then the
 *   folder's own, before its shared file. `.claude/settings.json` is read from the **folder the
 *   session starts in** only (so a subfolder does not read the checkout root's shared file);
 * - P1, an explicit `https://api.anthropic.com` is "off", and keeps the claude.ai login.
 *
 * Every file is in `tempDir()`; git runs through `git()` (`src/testing/temp.ts`), so the suite
 * sees no global config and no real repository.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { git, tempDir } from "../testing/temp";
import { DEFAULT_ANTHROPIC_BASE_URL, DEFAULT_PORT, type GatewayConfig, saveConfig } from "./config";
import {
  decisionWords,
  gatewayCopiesAmong,
  type ProjectStateOptions,
  projectGatewayState,
  projectGatewayStateAsync,
  urlMeaning,
} from "./project-state";

const PORT = 20999;
const ROUTER = `http://127.0.0.1:${PORT}`;

/** A temp home and the two files the reader is given: the user's settings and the config. */
function machine(): { configPath: string; home: string; settingsFile: string } {
  const home = tempDir("gp2-state-home");
  mkdirSync(join(home, ".claude"), { recursive: true });
  return {
    configPath: join(home, ".config", "cc-smart-dev-kit", "gateway.json"),
    home,
    settingsFile: join(home, ".claude", "settings.json"),
  };
}

/** A git repo in the temp folder (real git, a clean environment), with one commit. */
function repo(label: string): string {
  const root = join(tempDir(label), "app");
  mkdirSync(root, { recursive: true });
  git(root, "init", "-q", "-b", "main");
  writeFileSync(join(root, "README.md"), "app\n");
  git(root, "add", "README.md");
  git(root, "commit", "-qm", "init");
  return root;
}

/** A settings file with the content given (and a folder for it). */
function writeSettings(path: string, body: Record<string, unknown>): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify(body, null, 2)}\n`);
}

/** `{ env: { ANTHROPIC_BASE_URL: url } }`, the shape every test here writes. */
function withUrl(url: string): Record<string, unknown> {
  return { env: { ANTHROPIC_BASE_URL: url } };
}

describe("what a URL means for a project", () => {
  test("the router's root is on, with or without a trailing slash", () => {
    expect(urlMeaning(ROUTER, ROUTER)).toEqual({ profile: null, state: "on" });
    expect(urlMeaning(`${ROUTER}/`, ROUTER)).toEqual({ profile: null, state: "on" });
  });

  test("a /p/<name> URL is on, with the profile it names", () => {
    expect(urlMeaning(`${ROUTER}/p/team`, ROUTER)).toEqual({ profile: "team", state: "on" });
    expect(urlMeaning(`${ROUTER}/p/team/`, ROUTER)).toEqual({ profile: "team", state: "on" });
  });

  test("a name a URL could not carry is another address, never a profile", () => {
    expect(urlMeaning(`${ROUTER}/p/Bad_Name`, ROUTER)).toEqual({ profile: null, state: "other" });
    expect(urlMeaning(`${ROUTER}/p/`, ROUTER)).toEqual({ profile: null, state: "other" });
    expect(urlMeaning(`${ROUTER}/other`, ROUTER)).toEqual({ profile: null, state: "other" });
  });

  test("Anthropic's own address is off, with or without a trailing slash", () => {
    expect(urlMeaning(DEFAULT_ANTHROPIC_BASE_URL, ROUTER).state).toBe("off");
    expect(urlMeaning(`${DEFAULT_ANTHROPIC_BASE_URL}/`, ROUTER).state).toBe("off");
  });

  test("another gateway, the router on another port, and localhost are other", () => {
    expect(urlMeaning("http://10.0.0.5:9000", ROUTER).state).toBe("other");
    expect(urlMeaning("http://127.0.0.1:20998", ROUTER).state).toBe("other");
    expect(urlMeaning(`http://localhost:${PORT}`, ROUTER).state).toBe("other");
  });

  test("no key is default", () => {
    expect(urlMeaning(null, ROUTER)).toEqual({ profile: null, state: "default" });
  });

  test("an address with credentials in it is never shown whole", () => {
    expect(
      decisionWords({
        path: "/home/user/app/.claude/settings.local.json",
        profile: null,
        source: "personal",
        state: "other",
        url: "http://user:secret-pass@10.0.0.5:9000",
      }),
    ).not.toContain("secret-pass");
  });
});

/** A gateway config on `port`, with one profile; the shape the reader reads the port from. */
function configOn(port: number): GatewayConfig {
  return {
    aliases: {},
    anthropicBaseUrl: DEFAULT_ANTHROPIC_BASE_URL,
    backends: { omniroute: { apiKey: "k-1234567890", baseUrl: "http://omni.test" } },
    port,
    profiles: { team: {} },
    slots: {},
    timeouts: { firstByteMs: 1000 },
    version: 1,
  };
}

/** The two twins of the one reader: every case below runs against each (FU1's awaited reads). */
const TWINS = [
  {
    name: "projectGatewayState",
    read: (folder: string, options: ProjectStateOptions) =>
      Promise.resolve(projectGatewayState(folder, options)),
  },
  { name: "projectGatewayStateAsync", read: projectGatewayStateAsync },
] as const;

for (const twin of TWINS) {
  /** The state a session started in `folder` gets, from the two machine files, read by `twin`. */
  const stateOf = (folder: string, files: ReturnType<typeof machine>) =>
    twin.read(folder, { configPath: files.configPath, settingsFile: files.settingsFile });

  describe(`${twin.name}: the project's gateway state (R6 P3, P6)`, () => {
    test("the personal file at the main checkout wins over the team file and the machine", async () => {
      const files = machine();
      const root = repo("gp2-wins");
      writeSettings(join(root, ".claude", "settings.local.json"), withUrl(ROUTER));
      writeSettings(join(root, ".claude", "settings.json"), withUrl(DEFAULT_ANTHROPIC_BASE_URL));
      writeSettings(files.settingsFile, withUrl(`http://127.0.0.1:${DEFAULT_PORT}`));

      const state = await stateOf(root, files);
      // The port is the default one here: the config names none, so the router is on 20100.
      expect(state.routerUrl).toBe(`http://127.0.0.1:${DEFAULT_PORT}`);
      expect(state.choice).toEqual({
        path: join(root, ".claude", "settings.local.json"),
        profile: null,
        source: "personal",
        state: "other",
        url: ROUTER,
      });
      expect(state.files.map((one) => [one.kind, one.url])).toEqual([
        ["personal", ROUTER],
        ["team", DEFAULT_ANTHROPIC_BASE_URL],
        ["machine", `http://127.0.0.1:${DEFAULT_PORT}`],
      ]);
    });

    test("a subfolder reads the personal file at the main checkout's root (P6)", async () => {
      const files = machine();
      const root = repo("gp2-subfolder");
      const sub = join(root, "packages", "web");
      mkdirSync(sub, { recursive: true });
      saveConfig(files.configPath, configOn(PORT));
      writeSettings(join(root, ".claude", "settings.local.json"), withUrl(ROUTER));
      // The subfolder's own local file comes second: the root's wins key by key (P6, 2.1.310).
      writeSettings(join(sub, ".claude", "settings.local.json"), withUrl("http://127.0.0.1:1234"));

      const state = await stateOf(sub, files);
      expect(state.choice).toEqual({
        path: join(root, ".claude", "settings.local.json"),
        profile: null,
        source: "personal",
        state: "on",
        url: ROUTER,
      });
      expect(state.files.map((one) => one.path)).toEqual([
        join(root, ".claude", "settings.local.json"),
        join(sub, ".claude", "settings.local.json"),
        join(sub, ".claude", "settings.json"),
        files.settingsFile,
      ]);
      expect(state.checkout?.root).toBe(root);
    });

    test("a subfolder's own local file decides when the root's file does not set the key (P6)", async () => {
      const files = machine();
      const root = repo("gp2-subfolder-own");
      const sub = join(root, "packages", "web");
      mkdirSync(sub, { recursive: true });
      saveConfig(files.configPath, configOn(PORT));
      writeSettings(files.settingsFile, withUrl("http://127.0.0.1:1111"));
      // The root's file sets another env key but not the URL: the key falls to the folder's own.
      writeSettings(join(root, ".claude", "settings.local.json"), {
        env: { SOME_OTHER_KEY: "x" },
      });
      writeSettings(join(sub, ".claude", "settings.local.json"), withUrl(ROUTER));

      const state = await stateOf(sub, files);
      expect(state.choice).toEqual({
        path: join(sub, ".claude", "settings.local.json"),
        profile: null,
        source: "personal",
        state: "on",
        url: ROUTER,
      });
      expect(state.effective.path).toBe(join(sub, ".claude", "settings.local.json"));
    });

    test("the starting folder's own local file beats its own shared file (P6)", async () => {
      const files = machine();
      const root = repo("gp2-own-over-team");
      const sub = join(root, "packages");
      mkdirSync(sub, { recursive: true });
      saveConfig(files.configPath, configOn(PORT));
      writeSettings(join(sub, ".claude", "settings.local.json"), withUrl(ROUTER));
      writeSettings(join(sub, ".claude", "settings.json"), withUrl(DEFAULT_ANTHROPIC_BASE_URL));

      expect((await stateOf(sub, files)).choice).toMatchObject({ source: "personal", state: "on" });
    });

    test("a linked worktree reads the main checkout's personal file (P6)", async () => {
      const files = machine();
      const root = repo("gp2-worktree");
      const worktree = join(tempDir("gp2-worktree-wt"), "wt");
      git(root, "worktree", "add", "-q", worktree, "-b", "feat/one");
      saveConfig(files.configPath, configOn(PORT));
      writeSettings(join(root, ".claude", "settings.local.json"), withUrl(ROUTER));
      writeSettings(
        join(worktree, ".claude", "settings.local.json"),
        withUrl("http://127.0.0.1:1234"),
      );

      const state = await stateOf(worktree, files);
      expect(state.choice.state).toBe("on");
      expect(state.choice.url).toBe(ROUTER);
      expect(state.checkout?.isWorktree).toBe(true);
      expect(state.checkout?.mainCheckout).toBe(root);
      expect(state.checkout?.commonDir).toBe(join(root, ".git"));
    });

    test("a linked worktree's own local file decides when the root's file does not set the key (P6)", async () => {
      const files = machine();
      const root = repo("gp2-worktree-own");
      const worktree = join(tempDir("gp2-worktree-own-wt"), "wt");
      git(root, "worktree", "add", "-q", worktree, "-b", "feat/own");
      saveConfig(files.configPath, configOn(PORT));
      writeSettings(files.settingsFile, withUrl(DEFAULT_ANTHROPIC_BASE_URL));
      // A copy of the personal file in the worktree (a `.worktreeinclude` makes one).
      writeSettings(join(worktree, ".claude", "settings.local.json"), withUrl(ROUTER));

      const state = await stateOf(worktree, files);
      expect(state.choice).toMatchObject({
        path: join(worktree, ".claude", "settings.local.json"),
        source: "personal",
        state: "on",
        url: ROUTER,
      });
      expect(state.effective.state).toBe("on");
      // The main checkout itself never reads the worktree's copy.
      expect((await stateOf(root, files)).effective).toMatchObject({
        source: "machine",
        state: "off",
      });
    });

    test("the team file is the starting folder's: a subfolder does not read the root's (P6)", async () => {
      const files = machine();
      const root = repo("gp2-team-sub");
      const sub = join(root, "packages");
      mkdirSync(sub, { recursive: true });
      saveConfig(files.configPath, configOn(PORT));
      writeSettings(join(root, ".claude", "settings.json"), withUrl(DEFAULT_ANTHROPIC_BASE_URL));
      writeSettings(files.settingsFile, withUrl(ROUTER));

      const atRoot = await stateOf(root, files);
      expect(atRoot.choice).toMatchObject({ source: "team", state: "off" });
      expect(atRoot.effective).toMatchObject({ source: "team", state: "off" });

      const inSub = await stateOf(sub, files);
      expect(inSub.choice).toMatchObject({ source: "none", state: "default" });
      // The machine's own value decides there, and the answer says so.
      expect(inSub.effective).toMatchObject({ source: "machine", state: "on", url: ROUTER });
      expect(inSub.files.find((one) => one.kind === "team")?.path).toBe(
        join(sub, ".claude", "settings.json"),
      );
    });

    test("a worktree reads its own team file, once it carries one (P6)", async () => {
      const files = machine();
      const root = repo("gp2-team-wt");
      const worktree = join(tempDir("gp2-team-wt-wt"), "wt");
      git(root, "worktree", "add", "-q", worktree, "-b", "feat/two");
      saveConfig(files.configPath, configOn(PORT));
      writeSettings(join(root, ".claude", "settings.json"), withUrl(ROUTER));
      writeSettings(
        join(worktree, ".claude", "settings.json"),
        withUrl(DEFAULT_ANTHROPIC_BASE_URL),
      );

      expect((await stateOf(worktree, files)).choice).toMatchObject({
        source: "team",
        state: "off",
      });
    });

    test("no file sets the key: default, from nothing, and nothing is guessed", async () => {
      const files = machine();
      const root = repo("gp2-default");
      const state = await stateOf(root, files);
      expect(state.choice).toEqual({
        path: null,
        profile: null,
        source: "none",
        state: "default",
        url: null,
      });
      expect(state.effective).toEqual({
        path: null,
        profile: null,
        source: "none",
        state: "default",
        url: null,
      });
    });

    test("outside git, the folder's own local file, its team file and the machine are read (P6)", async () => {
      const files = machine();
      const plain = join(tempDir("gp2-plain"), "notes");
      mkdirSync(plain, { recursive: true });
      writeSettings(join(plain, ".claude", "settings.json"), withUrl(DEFAULT_ANTHROPIC_BASE_URL));
      const state = await stateOf(plain, files);
      expect(state.checkout).toBeNull();
      expect(state.files.map((one) => one.kind)).toEqual(["personal", "team", "machine"]);
      expect(state.choice).toMatchObject({ source: "team", state: "off" });

      saveConfig(files.configPath, configOn(PORT));
      writeSettings(join(plain, ".claude", "settings.local.json"), withUrl(ROUTER));
      expect((await stateOf(plain, files)).choice).toMatchObject({
        path: join(plain, ".claude", "settings.local.json"),
        source: "personal",
        state: "on",
      });
    });

    test("a project that chose default follows the machine, and the answer says which file", async () => {
      const files = machine();
      const root = repo("gp2-follow");
      saveConfig(files.configPath, configOn(PORT));
      writeSettings(files.settingsFile, withUrl(ROUTER));
      const state = await stateOf(root, files);
      expect(state.choice.state).toBe("default");
      expect(state.effective).toEqual({
        path: files.settingsFile,
        profile: null,
        source: "machine",
        state: "on",
        url: ROUTER,
      });
    });
  });

  describe(`${twin.name}: what else the reader reports`, () => {
    test("the port and the profile names come from the config; with none, the default port", async () => {
      const files = machine();
      const root = repo("gp2-port");
      expect((await stateOf(root, files)).routerUrl).toBe(`http://127.0.0.1:${DEFAULT_PORT}`);
      expect((await stateOf(root, files)).profiles).toEqual([]);

      saveConfig(files.configPath, configOn(PORT));
      const state = await stateOf(root, files);
      expect(state.routerUrl).toBe(ROUTER);
      expect(state.profiles).toEqual(["team"]);
    });

    test("a login override is named, from every file that sets one", async () => {
      const files = machine();
      const root = repo("gp2-login");
      writeSettings(join(root, ".claude", "settings.local.json"), {
        env: { ANTHROPIC_API_KEY: "sk-test-not-a-real-key", ANTHROPIC_BASE_URL: ROUTER },
      });
      writeSettings(files.settingsFile, { apiKeyHelper: "echo key" });
      const state = await stateOf(root, files);
      expect(state.files[0]?.loginOverrides).toEqual(["ANTHROPIC_API_KEY"]);
      expect(state.files[2]?.loginOverrides).toEqual(["apiKeyHelper"]);
    });

    test("a file that cannot be read stops the chain as unknown, and the next file is not claimed", async () => {
      const files = machine();
      const root = repo("gp2-broken");
      mkdirSync(join(root, ".claude"), { recursive: true });
      writeFileSync(join(root, ".claude", "settings.local.json"), "{not json");
      writeSettings(files.settingsFile, withUrl(DEFAULT_ANTHROPIC_BASE_URL));

      const state = await stateOf(root, files);
      expect(state.choice).toMatchObject({ source: "personal", state: "unknown", url: null });
      expect(state.effective).toMatchObject({ source: "personal", state: "unknown", url: null });
      expect(state.files[0]?.problem).toContain("is not valid JSON");
      // The machine's value is reported as a fact, but it is not claimed as this project's answer.
      expect(state.files[2]?.url).toBe(DEFAULT_ANTHROPIC_BASE_URL);
    });

    test("an env that is not an object is reported too", async () => {
      const files = machine();
      const root = repo("gp2-env");
      writeSettings(join(root, ".claude", "settings.local.json"), { env: "on" });
      expect((await stateOf(root, files)).files[0]?.problem).toContain("env");
    });

    test("a base URL that is not a text is reported, not read as none", async () => {
      const files = machine();
      const root = repo("gp2-not-a-url");
      writeSettings(join(root, ".claude", "settings.local.json"), {
        env: { ANTHROPIC_BASE_URL: 42 },
      });
      const state = await stateOf(root, files);
      expect(state.files[0]?.problem).toContain("is not a text with an address in it");
      expect(state.effective.state).toBe("unknown");
    });

    test("an empty file is no key, and a byte order mark is skipped, as the writer reads them", async () => {
      const files = machine();
      const root = repo("gp2-empty-bom");
      mkdirSync(join(root, ".claude"), { recursive: true });
      writeFileSync(join(root, ".claude", "settings.local.json"), "");
      writeFileSync(
        join(root, ".claude", "settings.json"),
        `\uFEFF${JSON.stringify({ env: { ANTHROPIC_BASE_URL: DEFAULT_ANTHROPIC_BASE_URL } })}`,
      );
      const state = await stateOf(root, files);
      expect(state.files[0]?.problem).toBeNull();
      expect(state.choice).toMatchObject({ source: "team", state: "off" });
    });

    test("the personal file's git tracking is read: tracked, not tracked", async () => {
      const files = machine();
      const root = repo("gp2-tracked-reader");
      expect((await stateOf(root, files)).checkout?.personalTracked).toBe(false);
      writeSettings(join(root, ".claude", "settings.local.json"), {});
      git(root, "add", "-f", ".claude/settings.local.json");
      expect((await stateOf(root, files)).checkout?.personalTracked).toBe(true);
    });

    test("a gateway config that cannot be read is reported, and the default port is used", async () => {
      const files = machine();
      const root = repo("gp2-badconfig");
      mkdirSync(join(files.configPath, ".."), { recursive: true });
      writeFileSync(files.configPath, "{not json", { mode: 0o600 });
      const state = await stateOf(root, files);
      expect(state.configProblem).toContain("is not valid JSON");
      expect(state.routerUrl).toBe(`http://127.0.0.1:${DEFAULT_PORT}`);
    });
  });

  describe(`${twin.name}: the other worktrees' own local files (P6, 2.1.310)`, () => {
    test("each linked worktree's own file is listed, the asked folder's and a missing file left out", async () => {
      const files = machine();
      const root = repo("gf1-wtfiles");
      const one = join(tempDir("gf1-wtfiles-one"), "one");
      const two = join(tempDir("gf1-wtfiles-two"), "two");
      git(root, "worktree", "add", "-q", one, "-b", "feat/one");
      git(root, "worktree", "add", "-q", two, "-b", "feat/two");
      saveConfig(files.configPath, configOn(PORT));
      writeSettings(join(one, ".claude", "settings.local.json"), withUrl(ROUTER));
      // `two` has no file of its own: it is not listed.

      const fromRoot = await stateOf(root, files);
      expect(fromRoot.worktreeFiles.map((one) => [one.path, one.url])).toEqual([
        [join(one, ".claude", "settings.local.json"), ROUTER],
      ]);
      // Asked from `one`, its own file is in `files`, so it is not listed twice.
      const fromOne = await stateOf(one, files);
      expect(fromOne.worktreeFiles).toEqual([]);
      expect(fromOne.files.map((file) => file.path)).toContain(
        join(one, ".claude", "settings.local.json"),
      );
    });

    test("a worktree whose folder is gone, and a folder outside git, add none", async () => {
      const files = machine();
      const root = repo("gf1-wtgone");
      const gone = join(tempDir("gf1-wtgone-wt"), "gone");
      git(root, "worktree", "add", "-q", gone, "-b", "feat/gone");
      writeSettings(join(gone, ".claude", "settings.local.json"), withUrl(ROUTER));
      rmSync(gone, { force: true, recursive: true });
      expect((await stateOf(root, files)).worktreeFiles).toEqual([]);
      const plain = join(tempDir("gf1-wtplain"), "notes");
      mkdirSync(plain, { recursive: true });
      expect((await stateOf(plain, files)).worktreeFiles).toEqual([]);
    });

    test("a folder reached through a symlink to the main root does not list the root's file twice", async () => {
      const files = machine();
      const root = repo("gf1-symlink");
      const link = join(tempDir("gf1-symlink-link"), "app-link");
      symlinkSync(root, link);
      writeSettings(join(root, ".claude", "settings.local.json"), withUrl(ROUTER));
      const state = await stateOf(link, files);
      expect(state.files.filter((file) => file.kind === "personal")).toHaveLength(1);
    });
  });
}

describe("which worktree files are copies that hold a gateway address", () => {
  const file = (url: null | string, problem: null | string = null) => ({
    kind: "personal" as const,
    loginOverrides: [],
    modelKeys: [],
    path: "/home/user/wt/.claude/settings.local.json",
    problem,
    subagentOverrides: [],
    url,
  });

  test("the router's address, a profile's and another gateway's are copies", () => {
    for (const url of [ROUTER, `${ROUTER}/p/team`, "http://127.0.0.1:1234"]) {
      expect(gatewayCopiesAmong([file(url)])).toHaveLength(1);
    }
  });

  test("Anthropic's own address, no key, and a file that cannot be read are not", () => {
    expect(gatewayCopiesAmong([file(DEFAULT_ANTHROPIC_BASE_URL)])).toEqual([]);
    expect(gatewayCopiesAmong([file(null)])).toEqual([]);
    expect(gatewayCopiesAmong([file(ROUTER, "is not valid JSON")])).toEqual([]);
  });
});
