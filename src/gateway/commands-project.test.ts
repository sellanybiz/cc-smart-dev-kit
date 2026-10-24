/**
 * `gateway project …` and `gateway projects`: the per-project gateway state (D29, GP2).
 *
 * A temp HOME and config folder, real temp git projects, and fakes for the two network calls a
 * command makes (the router's health page and a backend's model list). Nothing here reaches a
 * real port, a real `~/.claude` or a real gateway; every project file is under `tempDir()`.
 *
 * The Claude Code behaviour these follow is GP0's live proofs (`.claude/research/2026-10-23-r6-proofs.md`):
 * P1 (an explicit Anthropic URL keeps the login), P3 (local > shared > user), P6 (the local file
 * is the main checkout's; the shared file is the starting folder's), P7 (a changed value
 * reaches a running session, a removed one does not).
 */
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cliPaths } from "../cli/paths";
import { restore } from "../setup/restore";
import { git, tempDir } from "../testing/temp";
import { type GatewayContext, runGateway } from "./commands";
import { DEFAULT_ANTHROPIC_BASE_URL, type GatewayConfig, saveConfig } from "./config";
import type { HealthFetch } from "./health";

const PORT = 20999;
const ROUTER = `http://127.0.0.1:${PORT}`;
const CONFIG: GatewayConfig = {
  aliases: {},
  anthropicBaseUrl: DEFAULT_ANTHROPIC_BASE_URL,
  backends: { omniroute: { apiKey: "omni-key-123456", baseUrl: "http://omni.test" } },
  port: PORT,
  profiles: {
    team: {
      slots: { "cc-smart-dev-kit-worker": ["omniroute:m1"] },
    },
  },
  slots: {},
  timeouts: { firstByteMs: 1000 },
  version: 1,
};

/** A temp machine: its home, config folder, paths, and a context whose two calls are fakes. */
function machine(options: { routerDown?: boolean } = {}) {
  const home = tempDir("gp2-project");
  const configDir = join(home, ".claude");
  mkdirSync(configDir, { recursive: true });
  const paths = cliPaths({ HOME: home, CLAUDE_CONFIG_DIR: configDir });
  mkdirSync(join(paths.gatewayConfigFile, ".."), { recursive: true });
  saveConfig(paths.gatewayConfigFile, CONFIG);
  const lines: string[] = [];
  const errors: string[] = [];
  const health: HealthFetch = async () => {
    if (options.routerDown === true) throw new TypeError("Unable to connect");
    return Response.json({
      cooling: {},
      fallbacks: 0,
      ok: true,
      port: PORT,
      requests: 0,
      uptimeSec: 1,
    });
  };
  const apiFetch: HealthFetch = async (url) =>
    url.endsWith("/v1/models")
      ? Response.json({ data: [{ id: "m1" }, { id: "glm-5.3-flash" }] })
      : new Response("not found", { status: 404 });
  const ctx: GatewayContext = {
    paths,
    bunPath: process.execPath,
    bunVersion: Bun.version,
    bundle: join(home, "router.js"),
    runner: () => ({ exitCode: 0, output: "" }),
    readStdin: () => Promise.resolve(""),
    confirm: null,
    service: "systemd",
    account: null,
    platform: "linux",
    probe: { fetch: health, now: () => 0, sleep: () => Promise.resolve() },
    apiFetch,
    print: (line) => lines.push(line),
    error: (line) => errors.push(line),
  };
  const run = (args: string[]) => runGateway(args, ctx);
  /** What a command printed, as one text (the same words a person reads on a pipe). */
  const output = () => lines.join("\n");
  const reset = () => {
    lines.length = 0;
    errors.length = 0;
  };
  return { apiFetch, configDir, ctx, errors, home, lines, output, paths, reset, run };
}

/** A git project under a temp folder, with one commit. */
function repo(label: string): string {
  const root = join(tempDir(label), "app");
  mkdirSync(root, { recursive: true });
  git(root, "init", "-q", "-b", "main");
  writeFileSync(join(root, "README.md"), "app\n");
  git(root, "add", "README.md");
  git(root, "commit", "-qm", "init");
  return root;
}

/** A settings file with exactly the content given (and a folder for it). */
function writeSettings(path: string, body: Record<string, unknown>): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify(body, null, 2)}\n`);
}

/** The JSON of a settings file, as the test reads it back. */
function settingsOf(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

/** The URL a settings file holds in `env.ANTHROPIC_BASE_URL`; null when it holds none. */
function urlOf(path: string): null | string {
  if (!existsSync(path)) return null;
  const env = settingsOf(path).env;
  if (typeof env !== "object" || env === null) return null;
  const url = (env as Record<string, unknown>).ANTHROPIC_BASE_URL;
  return typeof url === "string" ? url : null;
}

/** The `.git/info/exclude` lines of a repo. */
function excludeLines(root: string): string[] {
  const file = join(root, ".git", "info", "exclude");
  return existsSync(file) ? readFileSync(file, "utf8").split("\n") : [];
}

describe("gateway project status", () => {
  test("before anything is set: default, from nothing, and the machine's own value", async () => {
    const m = machine();
    const root = repo("gp2-status-default");
    writeSettings(m.paths.settingsFile, {
      env: { ANTHROPIC_BASE_URL: `http://127.0.0.1:${PORT}` },
    });

    expect(await m.run(["project", "status", "--folder", root])).toBe(0);
    // The machine's own value is what this project's sessions get, and the line says so.
    expect(m.output()).toContain(`  ✓ on → ${ROUTER}`);
    expect(m.output()).toContain("  · from: nothing in this project");
    expect(m.output()).toContain(
      `  · the machine's settings ${m.paths.settingsFile.replace(m.home, "~")}: on → ${ROUTER}`,
    );
    expect(m.output()).toContain(
      `  · this project sets nothing, so the machine's own settings decide (on → ${ROUTER})`,
    );
    expect(m.output()).toContain(
      "  · a session launched with --settings is not visible here: that file wins for one session",
    );
  });

  test("after `on`: on, from the personal file; both other files are shown where they differ", async () => {
    const m = machine();
    const root = repo("gp2-status-on");
    await m.run(["project", "on", "--folder", root]);
    m.reset();
    writeSettings(join(root, ".claude", "settings.json"), {
      env: { ANTHROPIC_BASE_URL: DEFAULT_ANTHROPIC_BASE_URL },
    });
    writeSettings(m.paths.settingsFile, { env: { ANTHROPIC_BASE_URL: ROUTER } });

    expect(await m.run(["project", "status", "--folder", root])).toBe(0);
    expect(m.output()).toContain(`  ✓ on → ${ROUTER}`);
    expect(m.output()).toContain(
      `  · from: the personal file ${join(root, ".claude", "settings.local.json").replace(m.home, "~")} (never committed)`,
    );
    expect(m.output()).toContain("  · the team file");
    expect(m.output()).toContain(`off → ${DEFAULT_ANTHROPIC_BASE_URL}`);
    expect(m.output()).toContain(`✓ This project's sessions use the gateway (${ROUTER}).`);
  });

  test("a URL naming a profile the config does not have is a warning with the fix", async () => {
    const m = machine();
    const root = repo("gp2-status-missing-profile");
    writeSettings(join(root, ".claude", "settings.local.json"), {
      env: { ANTHROPIC_BASE_URL: `${ROUTER}/p/gone` },
    });
    expect(await m.run(["project", "status", "--folder", root])).toBe(0);
    expect(m.output()).toContain('  ! the router has no profile "gone"');
    expect(m.output()).toContain("cc-smart-dev-kit gateway profile gone slot <slot> <targets>");
  });

  test("a subfolder of a project with a team state says the team file does not reach it (P6)", async () => {
    const m = machine();
    const root = repo("gp2-status-sub");
    const sub = join(root, "packages", "web");
    mkdirSync(sub, { recursive: true });
    writeSettings(join(root, ".claude", "settings.json"), {
      env: { ANTHROPIC_BASE_URL: DEFAULT_ANTHROPIC_BASE_URL },
    });
    expect(await m.run(["project", "status", "--folder", sub])).toBe(0);
    expect(m.output()).toContain(
      `  ! the project root's team file (${join(root, ".claude", "settings.json").replace(m.home, "~")}) holds off → https://api.anthropic.com, and a session started in a subfolder does not read it`,
    );
    expect(m.output()).toContain("  · default: no file of this project sets a gateway address");
  });

  test("a broken project file is a failure with its fix, never a guessed state", async () => {
    const m = machine();
    const root = repo("gp2-status-broken");
    mkdirSync(join(root, ".claude"), { recursive: true });
    writeFileSync(join(root, ".claude", "settings.local.json"), "{not json");
    expect(await m.run(["project", "status", "--folder", root])).toBe(1);
    expect(m.output()).toContain("  ✗ ");
    expect(m.output()).toContain("is not valid JSON");
    expect(m.output()).toContain("Fix: fix the file by hand");
  });

  test("outside a git project the status still answers, and says there is no personal file", async () => {
    const m = machine();
    const plain = join(tempDir("gp2-status-plain"), "notes");
    mkdirSync(plain, { recursive: true });
    expect(await m.run(["project", "status", "--folder", plain])).toBe(0);
    expect(m.output()).toContain(
      "  · this folder is not in a git project: it has no personal file",
    );
    expect(m.output()).toContain("  · default: no file of this project sets a gateway address");
  });

  test("a folder that does not exist is refused", async () => {
    const m = machine();
    await expect(m.run(["project", "status", "--folder", join(m.home, "gone")])).rejects.toThrow(
      "is not a folder",
    );
  });
});

describe("gateway project on", () => {
  test("writes the personal file, excludes it from git, and says what reaches a running session", async () => {
    const m = machine();
    const root = repo("gp2-on");
    const personal = join(root, ".claude", "settings.local.json");

    expect(await m.run(["project", "on", "--folder", root])).toBe(0);
    expect(urlOf(personal)).toBe(ROUTER);
    expect(excludeLines(root)).toContain("/.claude/settings.local.json");
    expect(m.output()).toContain(
      `~ ${personal.replace(m.home, "~")}: env.ANTHROPIC_BASE_URL: (none) -> "${ROUTER}"`,
    );
    expect(m.output()).toContain(
      `+ the excluded line "/.claude/settings.local.json" in ${join(root, ".git", "info", "exclude").replace(m.home, "~")} (restore takes it out)`,
    );
    expect(m.output()).toContain(
      "  A Claude Code session already running in this project uses a changed value within about a second; restart it if the file did not exist when it started.",
    );
    expect(m.output()).toContain(
      "  Every session of this project — the main checkout, its subfolders and its worktrees — reads it.",
    );
    expect(m.output()).toContain(`✓ Done. This project's sessions use the gateway (${ROUTER}).`);

    // A second run changes nothing, and adds no second exclude line.
    m.reset();
    expect(await m.run(["project", "on", "--folder", root])).toBe(0);
    expect(m.output()).toContain(
      `✓ Nothing to change. This project's sessions use the gateway (${ROUTER}).`,
    );
    expect(excludeLines(root).filter((one) => one === "/.claude/settings.local.json")).toHaveLength(
      1,
    );
  });

  test("--profile points the project's URL at a profile", async () => {
    const m = machine();
    const root = repo("gp2-on-profile");
    expect(await m.run(["project", "on", "--profile", "team", "--folder", root])).toBe(0);
    expect(urlOf(join(root, ".claude", "settings.local.json"))).toBe(`${ROUTER}/p/team`);
    expect(m.output()).toContain(
      '  The router applies the profile "team" to this project\'s requests.',
    );
  });

  test("a profile the config does not have is refused, with the command that makes it", async () => {
    const m = machine();
    const root = repo("gp2-on-no-profile");
    await expect(m.run(["project", "on", "--profile", "gone", "--folder", root])).rejects.toThrow(
      'gateway.json has no profile "gone" (profiles: team)',
    );
    expect(existsSync(join(root, ".claude", "settings.local.json"))).toBe(false);
  });

  test("a name a URL cannot carry is refused in the config's own words", async () => {
    const m = machine();
    const root = repo("gp2-on-bad-name");
    await expect(
      m.run(["project", "on", "--profile", "Bad_Name", "--folder", root]),
    ).rejects.toThrow(
      "a profile name is lower-case letters, digits and - (the /p/<name> of a project's URL), at most 64",
    );
  });

  test("--team is refused: a team file never points teammates at one person's router", async () => {
    const m = machine();
    const root = repo("gp2-on-team");
    await expect(m.run(["project", "on", "--team", "--folder", root])).rejects.toThrow(
      "a team file never points teammates at one person's local router",
    );
    expect(existsSync(join(root, ".claude", "settings.json"))).toBe(false);
  });

  test("a project file that holds another gateway's URL is refused, and nothing is written", async () => {
    const m = machine();
    const root = repo("gp2-on-foreign");
    const personal = join(root, ".claude", "settings.local.json");
    writeSettings(personal, { env: { ANTHROPIC_BASE_URL: "http://10.0.0.5:9000" } });

    await expect(m.run(["project", "on", "--folder", root])).rejects.toThrow(
      `${personal} holds http://10.0.0.5:9000 in env.ANTHROPIC_BASE_URL, which is neither this machine's router nor Anthropic's`,
    );
    expect(urlOf(personal)).toBe("http://10.0.0.5:9000");
  });

  test("a login override at any level is refused: the gateway never replaces the person's login", async () => {
    const m = machine();
    const root = repo("gp2-on-login");
    writeSettings(m.paths.settingsFile, { env: { ANTHROPIC_API_KEY: "sk-test-not-a-real-key" } });
    await expect(m.run(["project", "on", "--folder", root])).rejects.toThrow(
      "ANTHROPIC_API_KEY is set in",
    );
    await expect(m.run(["project", "on", "--folder", root])).rejects.toThrow(
      "a gateway is never pointed at a project, and a project is never turned off, while a key or a helper replaces your own Claude login",
    );
    // `off` keeps the login, and is refused for the same reason: the key would replace it.
    await expect(m.run(["project", "off", "--folder", root])).rejects.toThrow(
      "ANTHROPIC_API_KEY is set in",
    );
    // `default` writes no gateway address at all, so the key changes nothing about it.
    m.reset();
    expect(await m.run(["project", "default", "--folder", root])).toBe(0);
  });

  test("an apiKeyHelper in a project file is refused too", async () => {
    const m = machine();
    const root = repo("gp2-on-helper");
    writeSettings(join(root, ".claude", "settings.json"), { apiKeyHelper: "echo key" });
    await expect(m.run(["project", "on", "--folder", root])).rejects.toThrow(
      "apiKeyHelper is set in",
    );
  });

  test("a router that does not answer is refused: every request in the project would fail", async () => {
    const m = machine({ routerDown: true });
    const root = repo("gp2-on-down");
    await expect(m.run(["project", "on", "--folder", root])).rejects.toThrow(
      "the router does not answer",
    );
  });

  test("outside a git project it is refused, and says where the state belongs", async () => {
    const m = machine();
    const plain = join(tempDir("gp2-on-plain"), "notes");
    mkdirSync(plain, { recursive: true });
    await expect(m.run(["project", "on", "--folder", plain])).rejects.toThrow(
      `${plain} is not in a git project: a project's gateway state lives in its .claude/ folder`,
    );
  });

  test("--team in a subfolder is refused: a session there does not read the root's team file (P6)", async () => {
    const m = machine();
    const root = repo("gp2-off-team-sub");
    const sub = join(root, "packages");
    mkdirSync(sub, { recursive: true });
    await expect(m.run(["project", "off", "--team", "--folder", sub])).rejects.toThrow(
      "the team file belongs in the project's top folder",
    );
    expect(existsSync(join(sub, ".claude", "settings.json"))).toBe(false);
  });

  test("--profile without on is a wrong option: exit 2, the usage line, nothing written", async () => {
    const m = machine();
    const root = repo("gp2-off-profile");
    expect(await m.run(["project", "off", "--profile", "team", "--folder", root])).toBe(2);
    expect(m.errors.join("\n")).toContain(
      "--profile says which profile the project's URL names, so it goes with on",
    );
    expect(m.errors.join("\n")).toContain("Usage:");
    expect(existsSync(join(root, ".claude", "settings.local.json"))).toBe(false);
  });
});

describe("gateway project off and default", () => {
  test("off writes Anthropic's own address: an explicit value, never a removal", async () => {
    const m = machine();
    const root = repo("gp2-off");
    const personal = join(root, ".claude", "settings.local.json");
    expect(await m.run(["project", "off", "--folder", root])).toBe(0);
    expect(urlOf(personal)).toBe(DEFAULT_ANTHROPIC_BASE_URL);
    expect(m.output()).toContain(
      "  Anthropic's own address keeps your own Claude login: turning the gateway off does not log you out.",
    );
  });

  test("default removes the key and says a running session keeps the old value until it restarts", async () => {
    const m = machine();
    const root = repo("gp2-default");
    const personal = join(root, ".claude", "settings.local.json");
    await m.run(["project", "on", "--folder", root]);
    m.reset();

    expect(await m.run(["project", "default", "--folder", root])).toBe(0);
    expect(urlOf(personal)).toBeNull();
    expect(m.output()).toContain(
      `~ ${personal.replace(m.home, "~")}: env.ANTHROPIC_BASE_URL: "${ROUTER}" -> (none)`,
    );
    expect(m.output()).toContain(
      "  A session already running keeps the value it had until it restarts: a removed key never reaches a running session.",
    );
  });

  test("--team writes the project's own settings file, and says it is committed and reaches one folder only", async () => {
    const m = machine();
    const root = repo("gp2-off-team");
    expect(await m.run(["project", "off", "--team", "--folder", root])).toBe(0);
    const team = join(root, ".claude", "settings.json");
    expect(urlOf(team)).toBe(DEFAULT_ANTHROPIC_BASE_URL);
    // The personal file is not written, and nothing is excluded from git.
    expect(existsSync(join(root, ".claude", "settings.local.json"))).toBe(false);
    expect(excludeLines(root)).not.toContain("/.claude/settings.local.json");
    expect(m.output()).toContain(
      "  The team file is committed with the project: commit it for your teammates.",
    );
    expect(m.output()).toContain(
      "  A session reads this file only when it starts in this same folder: one started in a subfolder does not.",
    );
  });

  test("a key someone else set is left alone by default, and the output says so", async () => {
    const m = machine();
    const root = repo("gp2-default-foreign");
    const personal = join(root, ".claude", "settings.local.json");
    writeSettings(personal, { env: { ANTHROPIC_BASE_URL: "http://10.0.0.5:9000" } });
    expect(await m.run(["project", "default", "--folder", root])).toBe(0);
    expect(urlOf(personal)).toBe("http://10.0.0.5:9000");
    expect(m.output()).toContain(
      "· env.ANTHROPIC_BASE_URL stays: cc-smart-dev-kit did not set it, so it is not this command's to remove",
    );
  });
});

describe("what the output says follows the file that decides (review: M1, M2)", () => {
  test("off --team under a personal on: the personal file decides, and the output says so", async () => {
    const m = machine();
    const root = repo("gp2-decides-personal");
    await m.run(["project", "on", "--folder", root]);
    m.reset();

    expect(await m.run(["project", "off", "--team", "--folder", root])).toBe(0);
    // The verdict is the state that applies — on — not the state asked for.
    expect(m.output()).toContain(`✓ Done. This project's sessions use the gateway (${ROUTER}).`);
    expect(m.output()).toContain(
      `  ! the personal file ${join(root, ".claude", "settings.local.json").replace(m.home, "~")} (never committed) decides first: on → ${ROUTER}`,
    );
    expect(m.output()).not.toContain("go to Anthropic's own address");
  });

  test("default under a team off: the team file decides now, and the output says so", async () => {
    const m = machine();
    const root = repo("gp2-decides-team");
    await m.run(["project", "off", "--team", "--folder", root]);
    await m.run(["project", "on", "--folder", root]);
    m.reset();

    expect(await m.run(["project", "default", "--folder", root])).toBe(0);
    expect(m.output()).toContain(
      "Done. This project's sessions go to Anthropic's own address, on your own Claude login.",
    );
    expect(m.output()).toContain("decides first: off → https://api.anthropic.com");
    expect(m.output()).not.toContain("the machine's settings decide");
  });

  test("a key that stays is told before 'nothing to change', and the state that applies is the verdict", async () => {
    const m = machine();
    const root = repo("gp2-stays");
    writeSettings(join(root, ".claude", "settings.json"), {
      env: { ANTHROPIC_BASE_URL: "https://other.example" },
    });
    expect(await m.run(["project", "default", "--team", "--folder", root])).toBe(0);
    expect(m.output()).toContain(
      "· env.ANTHROPIC_BASE_URL stays: cc-smart-dev-kit did not set it, so it is not this command's to remove",
    );
    expect(m.output()).toContain(
      "! Nothing to change. This project's sessions send their requests to another address.",
    );
    expect(m.output()).not.toContain("no gateway address of its own");
    expect(urlOf(join(root, ".claude", "settings.json"))).toBe("https://other.example");
  });

  test("default on a fresh project writes nothing at all: no file, no excluded line", async () => {
    const m = machine();
    const root = repo("gp2-default-fresh");
    expect(await m.run(["project", "default", "--folder", root])).toBe(0);
    expect(existsSync(join(root, ".claude", "settings.local.json"))).toBe(false);
    expect(excludeLines(root)).not.toContain("/.claude/settings.local.json");
    expect(m.output()).not.toContain("excluded line");
  });
});

describe("the refusals the review added", () => {
  test("a personal file git already tracks is never pointed at the router", async () => {
    const m = machine();
    const root = repo("gp2-tracked");
    writeSettings(join(root, ".claude", "settings.local.json"), { permissions: { allow: [] } });
    git(root, "add", "-f", ".claude/settings.local.json");
    git(root, "commit", "-qm", "oops: a local file committed");

    await expect(m.run(["project", "on", "--folder", root])).rejects.toThrow(
      "is committed in this project (git tracks it), so a router address written here would be committed with it. Untrack it first: git rm --cached -- .claude/settings.local.json",
    );
    expect(urlOf(join(root, ".claude", "settings.local.json"))).toBeNull();
    // Status says which it is, in the words of the source line.
    m.reset();
    await m.run(["project", "status", "--folder", root]);
    expect(m.output()).not.toContain("(never committed)");
  });

  test("a login helper in the checkout root's team file counts when the command runs in a subfolder (P6)", async () => {
    const m = machine();
    const root = repo("gp2-root-helper");
    const sub = join(root, "packages", "web");
    mkdirSync(sub, { recursive: true });
    writeSettings(join(root, ".claude", "settings.json"), { apiKeyHelper: "echo key" });
    await expect(m.run(["project", "on", "--folder", sub])).rejects.toThrow(
      "apiKeyHelper is set in",
    );
  });

  test("a hand-written Anthropic address with a trailing slash is refused by the writer, in its own words, and left alone", async () => {
    const m = machine();
    const root = repo("gp2-slash");
    const personal = join(root, ".claude", "settings.local.json");
    writeSettings(personal, { env: { ANTHROPIC_BASE_URL: `${DEFAULT_ANTHROPIC_BASE_URL}/` } });
    await expect(m.run(["project", "on", "--folder", root])).rejects.toThrow(
      "set by someone else. cc-smart-dev-kit does not overwrite it",
    );
    expect(urlOf(personal)).toBe(`${DEFAULT_ANTHROPIC_BASE_URL}/`);
  });

  test("a status with a file it cannot read exits 1: the failure is not hidden by a 0", async () => {
    const m = machine();
    const root = repo("gp2-status-exit");
    mkdirSync(join(root, ".claude"), { recursive: true });
    writeFileSync(join(root, ".claude", "settings.local.json"), "{not json");
    expect(await m.run(["project", "status", "--folder", root])).toBe(1);
  });

  test("--team with status is a wrong option: exit 2", async () => {
    const m = machine();
    const root = repo("gp2-status-team");
    expect(await m.run(["project", "status", "--team", "--folder", root])).toBe(2);
    expect(m.errors.join("\n")).toContain("status writes nothing");
  });

  test("an empty personal file reads as no key, and `on` writes into it", async () => {
    const m = machine();
    const root = repo("gp2-empty");
    mkdirSync(join(root, ".claude"), { recursive: true });
    writeFileSync(join(root, ".claude", "settings.local.json"), "");
    expect(await m.run(["project", "status", "--folder", root])).toBe(0);
    expect(m.output()).not.toContain("cannot be read");
    expect(await m.run(["project", "on", "--folder", root])).toBe(0);
    expect(urlOf(join(root, ".claude", "settings.local.json"))).toBe(ROUTER);
  });

  test("a personal file with a byte order mark reads like the writer reads it", async () => {
    const m = machine();
    const root = repo("gp2-bom");
    mkdirSync(join(root, ".claude"), { recursive: true });
    writeFileSync(
      join(root, ".claude", "settings.local.json"),
      `\uFEFF${JSON.stringify({ env: { ANTHROPIC_BASE_URL: ROUTER } })}`,
    );
    expect(await m.run(["project", "status", "--folder", root])).toBe(0);
    expect(m.output()).toContain(`✓ on → ${ROUTER}`);
  });
});

describe("gateway projects passes its folder through (review: M8)", () => {
  test("the folder given is the one the list is asked about", async () => {
    const m = machine();
    const root = repo("gp2-projects-folder");
    const asked: string[] = [];
    m.ctx.projects = async (folder) => {
      asked.push(folder);
      return { note: null, projects: [{ current: true, name: "app", root }] };
    };
    expect(await m.run(["projects", "--folder", root])).toBe(0);
    expect(asked).toEqual([root]);
  });
});

describe("restore takes a project's state back", () => {
  test("the personal key and the excluded line both go, and everything else stays", async () => {
    const m = machine();
    const root = repo("gp2-restore");
    // The person's own key is in the personal file first; `project on` adds the gateway's
    // beside it, and `restore` takes back the gateway's key and the excluded line only.
    writeSettings(join(root, ".claude", "settings.local.json"), {
      env: { MY_OWN_KEY: "keep-me" },
    });
    await m.run(["project", "on", "--folder", root]);

    const results = restore(m.paths.stateDir);
    expect(urlOf(join(root, ".claude", "settings.local.json"))).toBeNull();
    expect(settingsOf(join(root, ".claude", "settings.local.json")).env).toEqual({
      MY_OWN_KEY: "keep-me",
    });
    expect(excludeLines(root)).not.toContain("/.claude/settings.local.json");
    expect(results.some((one) => one.file.endsWith("settings.local.json"))).toBe(true);
    expect(results.some((one) => one.file.endsWith(join("info", "exclude")))).toBe(true);
  });
});

describe("gateway projects", () => {
  test("every project of the portal's list, with its state and where it comes from", async () => {
    const m = machine();
    const on = repo("gp2-list-on");
    const off = repo("gp2-list-off");
    await m.run(["project", "on", "--folder", on]);
    await m.run(["project", "off", "--folder", off]);
    // The portal's own list, as `GatewayContext.projects` hands it in: two projects, the
    // folder the command runs in marked `current`.
    m.ctx.projects = async () => ({
      note: null,
      projects: [
        { current: true, name: "app", root: on },
        { current: false, name: "site", root: off },
      ],
    });
    m.reset();

    expect(await m.run(["projects", "--folder", on])).toBe(0);
    expect(m.output()).toContain("Projects (the same list as the portal's Projects page):");
    expect(m.output()).toContain(`on → ${ROUTER}`);
    expect(m.output()).toContain(`off → ${DEFAULT_ANTHROPIC_BASE_URL}`);
    expect(m.output()).toContain("from the personal file");
    expect(m.output()).toContain("here");
    expect(m.output()).toContain("here");
  });
});

describe("gateway off: the projects still on (GP4a)", () => {
  test("a project's own on keeps it on the router after the machine goes off; the line names the command", async () => {
    const m = machine();
    // A folder with a space in it: the Fix line must quote it, or the copied command breaks.
    const on = repo("gp4a off on");
    const off = repo("gp4a-off-off");
    const bare = repo("gp4a-off-bare");
    await m.run(["project", "on", "--folder", on]);
    await m.run(["project", "off", "--folder", off]);
    m.ctx.projects = async () => ({
      note: null,
      projects: [
        { current: false, name: "on", root: on },
        { current: false, name: "off", root: off },
        { current: false, name: "bare", root: bare },
      ],
    });
    m.reset();

    expect(await m.run(["off"])).toBe(0);
    // The machine's own key is gone (there was none); the project's own value still points
    // at the router, so `off` says which projects keep it on and how to turn each off.
    expect(m.lines).toEqual([
      `! ${on} stays on: on → ${ROUTER}  · from the personal file ${join(on, ".claude", "settings.local.json")} (never committed)`,
      // The folder has a space in it: the command as printed is one the person can paste.
      `  Fix: cc-smart-dev-kit gateway project off --folder '${on}'`,
      "! The gateway is off on this machine; 1 project still points at the router (above).",
    ]);
  });

  test("with no project list to read, off says only what it did to this machine", async () => {
    const m = machine();
    expect(await m.run(["off"])).toBe(0);
    expect(m.lines).toEqual([
      "✓ Nothing to change: cc-smart-dev-kit set no gateway key in ~/.claude/settings.json.",
    ]);
  });
});
