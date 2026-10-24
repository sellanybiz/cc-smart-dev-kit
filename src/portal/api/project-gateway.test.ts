/**
 * `GET /api/projects/<id>/gateway` (GP4b): a project's own gateway state and what its sessions
 * effectively get, from the one reader (`projectGatewayStateAsync`), with the profile its
 * address names and that profile's chains slot by slot over the machine's.
 *
 * Every file is in `tempDir()`, git runs in a clean environment, and the machine's settings and
 * gateway config are a temp home's. No test reaches a router: the answer reads files only.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cliPaths } from "../../cli/paths";
import { DEFAULT_ANTHROPIC_BASE_URL, type GatewayConfig, saveConfig } from "../../gateway/config";
import { fakeDefaults, fakeWorkflow } from "../../testing/fake-workflow";
import { cleanGitEnv, git, tempDir } from "../../testing/temp";
import { type ActionContext, portalOmnirouteContext } from "../actions";
import type { PageDataDeps } from "../page-data";
import { projectGatewayAnswerFor } from "./project-gateway";
import { addProjectRoot, forgetProjectsList } from "./projects";
import { answerApi } from "./routes";
import { testPortalContext } from "./test-context";

const PORT = 20977;
const ROUTER = `http://127.0.0.1:${PORT}`;

/** A project's id as the contract says it: 12 hex of sha256 of its root. */
function idOf(root: string): string {
  return createHash("sha256").update(root).digest("hex").slice(0, 12);
}

/** A git repo with one commit, in its own temp folder. */
function repo(label: string): string {
  const root = join(tempDir(label), "app");
  mkdirSync(root, { recursive: true });
  git(root, "init", "-q", "-b", "main");
  writeFileSync(join(root, "README.md"), "app\n");
  git(root, "add", "README.md");
  git(root, "commit", "-qm", "init");
  return root;
}

/** A settings file with `body` in it. */
function writeSettings(path: string, body: Record<string, unknown>): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify(body, null, 2)}\n`);
}

/** A gateway config on the test's port: a worker and an opus chain, and one profile. */
function config(): GatewayConfig {
  return {
    aliases: {},
    anthropicBaseUrl: DEFAULT_ANTHROPIC_BASE_URL,
    backends: { omniroute: { apiKey: "k-1234567890", baseUrl: "http://omni.test" } },
    fallback: { "cc-smart-dev-kit-opus": false },
    port: PORT,
    profiles: {
      cheap: {
        fallback: { "cc-smart-dev-kit-scout": false },
        slots: {
          "cc-smart-dev-kit-opus": "claude",
          "cc-smart-dev-kit-scout": ["omniroute:glm-5", "omniroute:kimi-k3"],
        },
      },
    },
    slots: {
      "cc-smart-dev-kit-opus": ["omniroute:glm-5"],
      "cc-smart-dev-kit-worker": ["omniroute:deepseek-v4"],
    },
    timeouts: { firstByteMs: 1000 },
    version: 1,
  };
}

/** A temp home, its paths, and the deps one answer reads: with or without a gateway config. */
async function world(root: string, withConfig: boolean) {
  const home = tempDir("project-gateway-home");
  const paths = cliPaths({ CLAUDE_CONFIG_DIR: join(home, ".claude"), HOME: home });
  if (withConfig) saveConfig(paths.gatewayConfigFile, config());
  const env = {
    ...cleanGitEnv(),
    CLAUDE_CONFIG_DIR: paths.claudeConfigDir,
    HOME: home,
    PATH: process.env.PATH ?? "",
  };
  const ctx = testPortalContext(paths, env, () => Date.now());
  const workflow = fakeWorkflow();
  const action: ActionContext = {
    cwd: home,
    omniroute: portalOmnirouteContext(ctx),
    portal: ctx,
    projectDefaults: () => fakeDefaults(),
    workflow,
  };
  const deps: PageDataDeps = {
    action,
    doctor: async () => null,
    facts: async () => ({ platform: "linux", portalPort: 0, router: null, version: "0.0.0" }),
    found: withConfig ? { config: config() } : { error: "no gateway config yet" },
    projectDefaults: action.projectDefaults,
    workflow,
  };
  await addProjectRoot(paths, root);
  forgetProjectsList();
  return { deps, home, paths };
}

/** The answer for `root`, or the test fails with the builder's own refusal. */
async function answerOf(deps: PageDataDeps, root: string) {
  const answer = await projectGatewayAnswerFor(deps, idOf(root));
  if ("error" in answer) throw new Error(answer.error);
  return answer;
}

beforeEach(() => {
  forgetProjectsList();
});

describe("a project's gateway answer (GP4b)", () => {
  test("no file sets the key and no config: default from nothing, and on is not offered", async () => {
    const root = repo("pg-default");
    const { deps } = await world(root, false);
    const answer = await answerOf(deps, root);
    expect(answer.choice).toEqual({
      from: "nothing in this project",
      profile: null,
      source: "none",
      state: "default",
      words:
        "default: no file of this project sets a gateway address, so the machine's settings decide",
    });
    expect(answer.effective.state).toBe("default");
    expect(answer.configured).toBe(false);
    // Off and default write; on needs the gateway, and the team file never takes on.
    expect(answer.refusals.personal).toEqual({
      default: null,
      off: null,
      on: "On needs this machine's gateway, and it is not set up: set it up on Machine first.",
    });
    expect(answer.refusals.team.default).toBeNull();
    expect(answer.refusals.team.off).toBeNull();
    expect(answer.refusals.team.on).toStartWith(
      "a team file never points teammates at one person's local router",
    );
    expect(answer.personalTracked).toBe(false);
    expect(answer.writable).toBe(true);
    expect(answer.profile).toBeNull();
    expect(answer.profiles).toEqual([]);
    expect(answer.files.map((one) => [one.kind, one.holds, one.problem])).toEqual([
      ["personal", "sets nothing", false],
      ["team", "sets nothing", false],
      ["machine", "sets nothing", false],
    ]);
    expect(answer.notes).toContainEqual({
      text: "This machine's gateway is not set up (no gateway config yet), so a project can be off or default here, never on.",
      tone: "info",
    });
  });

  test("on with a profile: the profile's chains slot by slot over the machine's", async () => {
    const root = repo("pg-profile");
    const { deps, home } = await world(root, true);
    writeSettings(join(root, ".claude", "settings.local.json"), {
      env: { ANTHROPIC_BASE_URL: `${ROUTER}/p/cheap` },
    });
    const answer = await answerOf(deps, root);
    expect(answer.choice).toEqual({
      from: `the personal file ${join(root, ".claude", "settings.local.json").replace(home, "~")} (never committed)`,
      profile: "cheap",
      source: "personal",
      state: "on",
      words: `on → ${ROUTER}/p/cheap  (profile cheap)`,
    });
    expect(answer.effective).toEqual(answer.choice);
    expect(answer.configured).toBe(true);
    expect(answer.refusals.personal).toEqual({ default: null, off: null, on: null });
    expect(answer.profiles).toEqual(["cheap"]);
    expect(answer.profile).toEqual({
      exists: true,
      name: "cheap",
      slots: [
        {
          fallback: false,
          key: "cc-smart-dev-kit-scout",
          machine: null,
          name: "scout",
          own: ["omniroute:glm-5", "omniroute:kimi-k3"],
        },
        {
          fallback: true,
          key: "cc-smart-dev-kit-worker",
          machine: ["omniroute:deepseek-v4"],
          name: "worker",
          own: null,
        },
        { fallback: true, key: "cc-smart-dev-kit-judge", machine: null, name: "judge", own: null },
        { fallback: false, key: "cc-smart-dev-kit-fable", machine: null, name: "fable", own: null },
        {
          fallback: false,
          key: "cc-smart-dev-kit-opus",
          machine: ["omniroute:glm-5"],
          name: "opus",
          own: "claude",
        },
      ],
    });
  });

  test("an address naming a profile the config does not have says it answers as plain Claude", async () => {
    const root = repo("pg-missing-profile");
    const { deps } = await world(root, true);
    writeSettings(join(root, ".claude", "settings.local.json"), {
      env: { ANTHROPIC_BASE_URL: `${ROUTER}/p/gone` },
    });
    const answer = await answerOf(deps, root);
    expect(answer.profile).toMatchObject({ exists: false, name: "gone" });
    expect(answer.notes).toContainEqual({
      text: 'The router has no profile "gone": this project\'s requests answer as plain Claude. Pick another profile, or make it on the command line.',
      tone: "warn",
    });
  });

  test("the team file's off, and a project that chose default follows the machine", async () => {
    const root = repo("pg-team");
    const { deps, paths } = await world(root, true);
    writeSettings(join(root, ".claude", "settings.json"), {
      env: { ANTHROPIC_BASE_URL: DEFAULT_ANTHROPIC_BASE_URL },
    });
    const off = await answerOf(deps, root);
    expect(off.choice).toMatchObject({ source: "team", state: "off" });
    expect(off.choice.from).toContain("(committed with the project)");

    const other = repo("pg-follow");
    await addProjectRoot(paths, other);
    forgetProjectsList();
    writeSettings(paths.settingsFile, { env: { ANTHROPIC_BASE_URL: ROUTER } });
    const follows = await answerOf(deps, other);
    expect(follows.choice).toMatchObject({ source: "none", state: "default" });
    expect(follows.effective).toMatchObject({ source: "machine", state: "on" });
    expect(follows.effective.words).toBe(`on → ${ROUTER}`);
  });

  test("a personal file git tracks keeps on off the table, and says why", async () => {
    const root = repo("pg-tracked");
    const { deps } = await world(root, true);
    writeSettings(join(root, ".claude", "settings.local.json"), {});
    git(root, "add", "-f", ".claude/settings.local.json");
    const answer = await answerOf(deps, root);
    expect(answer.personalTracked).toBe(true);
    // The command refuses on there, and writes off and default: the card says they are committed.
    expect(answer.refusals.personal.on).toBe(
      `${join(root, ".claude", "settings.local.json")} is committed in this project (git tracks it), so a router address written here would be committed with it. Untrack it first: git rm --cached -- .claude/settings.local.json`,
    );
    expect(answer.refusals.personal.off).toBeNull();
    expect(answer.refusals.personal.default).toBeNull();
    expect(answer.notes).toContainEqual({
      text: "Git tracks this project's personal file (.claude/settings.local.json), so a router address written there would be committed with it: on is refused until it is untracked (git rm --cached -- .claude/settings.local.json).",
      tone: "warn",
    });
  });

  test("a file that cannot be read is unknown, and named as a fault", async () => {
    const root = repo("pg-broken");
    const { deps } = await world(root, true);
    mkdirSync(join(root, ".claude"), { recursive: true });
    writeFileSync(join(root, ".claude", "settings.local.json"), "{not json");
    const answer = await answerOf(deps, root);
    expect(answer.choice.state).toBe("unknown");
    expect(answer.files[0]?.problem).toBe(true);
    expect(answer.files[0]?.holds).toStartWith("cannot be read (");
    expect(answer.notes.filter((one) => one.tone === "bad").map((one) => one.text)).toEqual([
      "A settings file this project's sessions read cannot be read, so its gateway state is unknown: fix the file by hand, or move it aside.",
    ]);
  });

  test("a key or a helper that replaces the login is named: on and off are refused while it is there", async () => {
    const root = repo("pg-login");
    const { deps, home } = await world(root, true);
    writeSettings(join(root, ".claude", "settings.json"), { apiKeyHelper: "echo key" });
    const answer = await answerOf(deps, root);
    // The command's own refusal, in both files, for on and off; default is still written.
    const refused = `apiKeyHelper is set in ${join(root, ".claude", "settings.json").replace(home, "~")}: a gateway is never pointed at a project, and a project is never turned off, while a key or a helper replaces your own Claude login. Remove it by hand first (cc-smart-dev-kit gateway status shows it too).`;
    expect(answer.refusals.personal).toEqual({ default: null, off: refused, on: refused });
    expect(answer.refusals.team.off).toBe(refused);
    expect(answer.notes).toContainEqual({
      text: `apiKeyHelper is set in ${join(root, ".claude", "settings.json").replace(home, "~")}: it replaces your own Claude login, so this project cannot be turned on or off until it is removed by hand.`,
      tone: "warn",
    });
  });

  test("another address with a key in it is never sent whole", async () => {
    const root = repo("pg-other");
    const { deps } = await world(root, true);
    const secret = "sk-ant-secretsecretsecretsecretsecret";
    writeSettings(join(root, ".claude", "settings.local.json"), {
      env: { ANTHROPIC_BASE_URL: `https://user:${secret}@gateway.example.com` },
    });
    const answer = await answerOf(deps, root);
    expect(answer.choice.state).toBe("other");
    expect(JSON.stringify(answer)).not.toContain(secret);
    // Another gateway's address is the command's to refuse: on and off are not written over it.
    expect(answer.refusals.personal.on).toContain("is not this command's to replace");
    expect(answer.refusals.personal.off).toContain("is not this command's to replace");
  });

  test("another address reaches the page with no user name, query or fragment", async () => {
    const root = repo("pg-other-query");
    const { deps } = await world(root, true);
    writeSettings(join(root, ".claude", "settings.local.json"), {
      env: { ANTHROPIC_BASE_URL: "https://gw.example.com/v1?key=abc123def#frag" },
    });
    const answer = await answerOf(deps, root);
    expect(answer.choice.words).toBe("another address: https://gw.example.com/v1");
    expect(answer.files[0]?.holds).toBe("another address: https://gw.example.com/v1");
    expect(JSON.stringify(answer)).not.toContain("abc123def");
  });

  test("a folder that is no git project is no row: its gateway answer is the plain refusal", async () => {
    const plain = join(tempDir("pg-plain"), "notes");
    mkdirSync(plain, { recursive: true });
    const { deps, paths } = await world(repo("pg-plain-other"), true);
    await addProjectRoot(paths, plain);
    forgetProjectsList();
    const answer = await projectGatewayAnswerFor(deps, idOf(plain));
    // An added folder that is no git project is still listed only when git knows it: the list
    // folds by checkout, so a plain folder is no row and the answer is the plain refusal.
    expect(answer).toEqual({
      error: `no project has the id "${idOf(plain)}"; the list on /api/projects names them`,
    });
  });

  test("the route answers by id, and an unknown id is a 404 in words", async () => {
    const root = repo("pg-route");
    const { deps } = await world(root, true);
    const found = await answerApi(
      deps,
      new URL(`http://127.0.0.1/api/projects/${idOf(root)}/gateway`),
    );
    expect(found?.status).toBe(200);
    expect(found?.body).toMatchObject({ choice: { state: "default" } });
    const missing = await answerApi(deps, new URL("http://127.0.0.1/api/projects/abc/gateway"));
    expect(missing).toEqual({
      body: { error: 'no project has the id "abc"; the list on /api/projects names them' },
      status: 404,
    });
  });
});
