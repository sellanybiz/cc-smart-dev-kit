/**
 * Warp: `setup --warp`, `setup --remove-warp`, plain setup and doctor, run in this process
 * with a fake machine. Every command goes to a fake on a PATH of its own (sudo, apt-get,
 * dnf, rpm, brew, gpg, claude, dpkg-query): each logs its call, and the fake `sudo` never
 * runs what it is given. No test reaches a real package manager, a real `claude`, the
 * network, or the real home folder.
 */
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cliPaths } from "../cli/paths";
import { runSetup, type SetupOptions } from "../cli/setup";
import { tempDir } from "../testing/temp";
import type { Machine } from "./machine";
import {
  APT_KEY,
  APT_SOURCE,
  APT_SOURCE_TEXT,
  detectSystem,
  warpCheck,
  YUM_REPO,
  YUM_REPO_TEXT,
} from "./warp";

const UBUNTU = 'NAME="Ubuntu"\nID=ubuntu\nID_LIKE=debian\n';
const FEDORA = 'NAME="Fedora Linux"\nID=fedora\n';
const ARCH = 'NAME="Arch Linux"\nID=arch\n';
const FAKE_KEY = "-----BEGIN PGP PUBLIC KEY BLOCK-----\nfake\n-----END PGP PUBLIC KEY BLOCK-----\n";
const INSTALLED = "Package: warp-terminal\nStatus: install ok installed\nVersion: 0.2026.10.01\n";

let printed: string[] = [];
beforeEach(() => {
  printed = [];
  spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    printed.push(...args.join(" ").split("\n"));
  });
  spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    printed.push(...`ERR ${args.join(" ")}`.split("\n"));
  });
});
afterEach(() => {
  (console.log as unknown as { mockRestore(): void }).mockRestore();
  (console.error as unknown as { mockRestore(): void }).mockRestore();
});

interface WorldOptions {
  os?: string;
  platform?: NodeJS.Platform;
  arch?: string;
  /** null: no terminal. true / false: the answer to every question. */
  answer?: boolean | null;
  /** System paths that exist. */
  existing?: string[];
  /** Fake bodies for commands, after the log line; default `exit 0`. */
  bins?: Record<string, string>;
  /** Plugins installed besides anymodel and its companions. */
  plugins?: string[];
  /** Marketplaces added besides anymodel and the companions'. */
  marketplaces?: string[];
}

/** A temp home after `claude plugin install anymodel@anymodel`, and a fake machine. */
function world(options: WorldOptions = {}) {
  const home = tempDir("warp");
  const configDir = join(home, ".claude");
  mkdirSync(join(configDir, "plugins"), { recursive: true });
  const paths = cliPaths({ HOME: home, CLAUDE_CONFIG_DIR: configDir });
  const pluginIds = [
    "anymodel@anymodel",
    "claude-mem@thedotmack",
    "frontend-design@claude-plugins-official",
    ...(options.plugins ?? []),
  ];
  const installed: Record<string, unknown> = {};
  for (const id of pluginIds) {
    const installPath = join(configDir, "plugins", "cache", id.replace("@", "/"), "1.0.0");
    mkdirSync(installPath, { recursive: true });
    installed[id] = [
      { scope: "user", installPath, version: id.startsWith("claude-mem") ? "13.39.0" : "1.0.0" },
    ];
  }
  writeFileSync(paths.installedPluginsFile, JSON.stringify({ version: 2, plugins: installed }));
  const marketplaces = [
    "anymodel",
    "thedotmack",
    "claude-plugins-official",
    ...(options.marketplaces ?? []),
  ];
  writeFileSync(
    paths.knownMarketplacesFile,
    JSON.stringify(Object.fromEntries(marketplaces.map((name) => [name, { source: {} }]))),
  );
  writeFileSync(
    paths.settingsFile,
    JSON.stringify({
      enabledPlugins: Object.fromEntries(pluginIds.map((id) => [id, true])),
      extraKnownMarketplaces: {
        anymodel: { source: { source: "github", repo: "example-org/anymodel" } },
      },
    }),
  );

  // The fakes: each logs "<name> <args>" and runs its body. sudo never runs its command.
  const bin = join(home, "fake-bin");
  const log = join(home, "calls.log");
  const staged = join(home, "staged");
  mkdirSync(bin);
  mkdirSync(staged);
  const bodies: Record<string, string> = {
    sudo: [
      // Keep a copy of each file handed to `install`, to check what root would get.
      'if [ "$1" = install ]; then for a do src=$dst; dst=$a; done;',
      `  cp "$src" ${JSON.stringify(staged)}/"$(basename "$dst")"; fi`,
      "exit 0",
    ].join("\n"),
    "apt-get": "exit 0",
    "dpkg-query": "exit 1",
    rpm: "exit 1",
    dnf: "exit 0",
    brew: '[ "$1" = list ] && exit 1; exit 0',
    claude: "exit 0",
    // gpg --dearmor --yes --output OUT IN: a copy stands in for the binary form.
    gpg: 'cp "$5" "$4"',
    ...options.bins,
  };
  for (const [name, body] of Object.entries(bodies)) {
    const file = join(bin, name);
    writeFileSync(file, `#!/bin/sh\necho "${name} $*" >> ${JSON.stringify(log)}\n${body}\n`);
    chmodSync(file, 0o755);
  }
  const env = { PATH: `${bin}:/usr/bin:/bin`, HOME: home };
  const questions: string[] = [];
  const answer = options.answer === undefined ? true : options.answer;
  const existing = new Set(options.existing ?? []);
  const spawn = (argv: string[]) => {
    const resolved = Bun.which(argv[0] ?? "", { PATH: bin });
    if (resolved === null) return { exitCode: 127, output: `${argv[0]}: not found` };
    const result = Bun.spawnSync([resolved, ...argv.slice(1)], {
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    return {
      exitCode: result.exitCode ?? 1,
      output: `${result.stdout.toString()}${result.stderr.toString()}`,
    };
  };
  const machine: Machine = {
    run: spawn,
    runOnTerminal: (argv) => spawn(argv).exitCode,
    which: (command) => Bun.which(command, { PATH: bin }),
    confirm:
      answer === null
        ? null
        : (question) => {
            questions.push(question);
            return answer;
          },
    platform: options.platform ?? "linux",
    arch: options.arch ?? "x64",
    osRelease: () => options.os ?? UBUNTU,
    exists: (path) => existing.has(path),
    fetchText: async () => FAKE_KEY,
  };
  const setup = (extra: Partial<SetupOptions> = {}) =>
    runSetup(paths, {
      dryRun: false,
      yes: false,
      warp: false,
      removeWarp: false,
      project: home,
      machine,
      ...extra,
    });
  /** Every call but the read-only questions about what is installed. */
  const calls = () =>
    (existsSync(log) ? readFileSync(log, "utf8") : "")
      .split("\n")
      .filter((line) => !/^(dpkg-query --status|rpm -q |brew list )/.test(line))
      .join("\n");
  return { home, paths, bin, staged, machine, questions, setup, calls };
}

const STAGE = (home: string) => join(home, ".claude", "anymodel", "warp");
const install = (from: string, to: string) =>
  `sudo install -D -o root -g root -m 644 ${from} ${to}`;

describe("setup --warp", () => {
  test("Debian/Ubuntu: the key and the source first, then apt; asked once; then Warp's plugin", async () => {
    const w = world();
    expect(await w.setup({ warp: true })).toBe(0);
    const stage = STAGE(w.home);
    expect(w.calls()).toBe(
      [
        `gpg --dearmor --yes --output ${stage}/warpdotdev.gpg ${stage}/warp.asc`,
        install(`${stage}/warpdotdev.gpg`, APT_KEY),
        install(`${stage}/warpdotdev.sources`, APT_SOURCE),
        "sudo apt-get update",
        "sudo apt-get install -y warp-terminal",
        "claude plugin marketplace add warpdotdev/claude-code-warp",
        "claude plugin install warp@claude-code-warp",
        "",
      ].join("\n"),
    );
    expect(w.questions).toEqual(["Run these commands now?"]);
    // What root got: Warp's key, and the source that names it.
    expect(readFileSync(join(w.staged, "warpdotdev.gpg"), "utf8")).toBe(FAKE_KEY);
    expect(readFileSync(join(w.staged, "warpdotdev.sources"), "utf8")).toBe(APT_SOURCE_TEXT);
    expect(APT_SOURCE_TEXT).toContain(`Signed-By: ${APT_KEY}\n`);
    // The staged files are gone again.
    expect(existsSync(stage)).toBe(false);
    // The commands were shown before the question.
    expect(printed.slice(0, 5)).toEqual([
      "To install Warp from its signed source, anymodel runs these commands (sudo asks for your password):",
      `  $ ${install(`${stage}/warpdotdev.gpg`, APT_KEY)}`,
      `  $ ${install(`${stage}/warpdotdev.sources`, APT_SOURCE)}`,
      "  $ sudo apt-get update",
      "  $ sudo apt-get install -y warp-terminal",
    ]);
    expect(printed).toContain("+ marketplace claude-code-warp (warpdotdev/claude-code-warp)");
    expect(printed).toContain("+ plugin warp@claude-code-warp");
  });

  test("no terminal: the commands are printed, nothing runs, nothing is written", async () => {
    const w = world({ answer: null });
    expect(await w.setup({ warp: true })).toBe(1);
    expect(w.calls()).toBe("");
    expect(printed).toContain(
      "No terminal: nothing was run. Run `anymodel setup --warp` in a terminal to run them.",
    );
    expect(printed).toContain("  $ sudo apt-get install -y warp-terminal");
    expect(existsSync(join(w.home, ".local"))).toBe(false);
    expect(existsSync(join(w.home, ".claude", "anymodel"))).toBe(false);
  });

  test("the person says no: nothing runs", async () => {
    const w = world({ answer: false });
    expect(await w.setup({ warp: true })).toBe(1);
    expect(w.calls()).toBe("");
    expect(printed).toContain("Nothing was run.");
  });

  test("a Warp source already there is kept: no second source file", async () => {
    const w = world({ existing: ["/etc/apt/sources.list.d/warpdotdev.list"] });
    await w.setup({ warp: true });
    expect(w.calls()).not.toContain(APT_SOURCE);
    expect(w.calls()).toContain("sudo apt-get install -y warp-terminal");
  });

  test("a command that fails stops the rest: no plugin, exit 1", async () => {
    const w = world({
      bins: { sudo: '[ "$1" = apt-get ] && [ "$2" = install ] && exit 100; exit 0' },
    });
    expect(await w.setup({ warp: true })).toBe(1);
    expect(printed).toContain(
      "! sudo apt-get install -y warp-terminal failed (exit 100). Nothing after it ran.",
    );
    expect(w.calls()).not.toContain("claude plugin");
    expect(existsSync(STAGE(w.home))).toBe(false);
  });

  test("Fedora: rpm imports the key, the repository file, then dnf", async () => {
    const w = world({ os: FEDORA });
    expect(await w.setup({ warp: true })).toBe(0);
    const stage = STAGE(w.home);
    expect(w.calls()).toBe(
      [
        "sudo rpm --import https://releases.warp.dev/linux/keys/warp.asc",
        install(`${stage}/warpdotdev.repo`, YUM_REPO),
        "sudo dnf install -y warp-terminal",
        "claude plugin marketplace add warpdotdev/claude-code-warp",
        "claude plugin install warp@claude-code-warp",
        "",
      ].join("\n"),
    );
    expect(readFileSync(join(w.staged, "warpdotdev.repo"), "utf8")).toBe(YUM_REPO_TEXT);
    expect(YUM_REPO_TEXT).toContain("gpgcheck=1\n");
  });

  test("macOS: Homebrew's cask, no sudo", async () => {
    const w = world({ platform: "darwin", os: "" });
    expect(await w.setup({ warp: true })).toBe(0);
    expect(w.calls()).toBe(
      [
        "brew install --cask warp",
        "claude plugin marketplace add warpdotdev/claude-code-warp",
        "claude plugin install warp@claude-code-warp",
        "",
      ].join("\n"),
    );
  });

  test("macOS without Homebrew, or a Linux anymodel does not know: a clear message with the link; nothing runs", async () => {
    for (const w of [
      world({ platform: "darwin", os: "", bins: {} }),
      world({ os: ARCH }),
      world({ arch: "arm64" }),
    ]) {
      if (w.machine.platform === "darwin") {
        // No brew on this PATH.
        rmSync(join(w.bin, "brew"));
      }
      printed = [];
      expect(await w.setup({ warp: true })).toBe(1);
      expect(printed.join("\n")).toContain("https://www.warp.dev/download");
      expect(w.calls()).not.toContain("sudo");
      expect(w.calls()).not.toContain("claude plugin");
    }
  });

  test("Warp already installed: no system command; only its plugin", async () => {
    const w = world({ bins: { "dpkg-query": `printf '${INSTALLED}'` } });
    expect(await w.setup({ warp: true })).toBe(0);
    expect(w.calls()).toBe(
      [
        "claude plugin marketplace add warpdotdev/claude-code-warp",
        "claude plugin install warp@claude-code-warp",
        "",
      ].join("\n"),
    );
    expect(w.questions).toEqual([]);
    expect(printed).toContain("  Warp 0.2026.10.01 is installed already");
  });

  test("--dry-run: the commands are listed; nothing runs, nothing is asked", async () => {
    const w = world();
    expect(await w.setup({ warp: true, dryRun: true })).toBe(0);
    expect(w.calls()).toBe("");
    expect(w.questions).toEqual([]);
    expect(printed).toContain("$ sudo apt-get install -y warp-terminal");
    expect(printed).toContain("+ plugin warp@claude-code-warp");
  });
});

describe("plain setup and Warp", () => {
  test("with the Warp app there: its plugin is added, without a question", async () => {
    const w = world({ bins: { "dpkg-query": `printf '${INSTALLED}'` } });
    expect(await w.setup()).toBe(0);
    expect(w.calls()).toContain("claude plugin install warp@claude-code-warp\n");
    expect(w.calls()).not.toContain("sudo");
    expect(w.questions).toEqual([]);
  });

  test("without the Warp app: nothing about Warp", async () => {
    const w = world();
    expect(await w.setup()).toBe(0);
    expect(w.calls()).toBe("");
  });

  test("a package removed but not purged does not count as installed", async () => {
    const w = world({
      bins: {
        "dpkg-query": "printf 'Package: warp-terminal\\nStatus: deinstall ok config-files\\n'",
      },
    });
    await w.setup();
    expect(w.calls()).not.toContain("claude plugin");
  });
});

describe("setup --remove-warp", () => {
  test("Debian/Ubuntu: purge, the source and key files, the shortcuts, the plugin and its marketplace", async () => {
    const w = world({
      bins: { "dpkg-query": `printf '${INSTALLED}'` },
      existing: [APT_SOURCE, APT_KEY],
      plugins: ["warp@claude-code-warp"],
      marketplaces: ["claude-code-warp"],
    });
    const shortcut = join(w.home, "Desktop", "dev.warp.Warp.desktop");
    mkdirSync(join(w.home, "Desktop"));
    writeFileSync(shortcut, "[Desktop Entry]\n");
    expect(await w.setup({ removeWarp: true })).toBe(0);
    expect(w.calls()).toBe(
      [
        "sudo apt-get purge -y warp-terminal",
        `sudo rm -f ${APT_SOURCE} ${APT_KEY}`,
        "claude plugin uninstall warp@claude-code-warp",
        "claude plugin marketplace remove claude-code-warp",
        "",
      ].join("\n"),
    );
    expect(existsSync(shortcut)).toBe(false);
    expect(printed).toContain("- ~/Desktop/dev.warp.Warp.desktop: Warp shortcut removed");
    expect(w.questions).toEqual(["Run these commands now?"]);
  });

  test("no terminal: nothing runs, the shortcut and the plugin stay", async () => {
    const w = world({
      answer: null,
      bins: { "dpkg-query": `printf '${INSTALLED}'` },
      plugins: ["warp@claude-code-warp"],
    });
    const shortcut = join(w.home, "Desktop", "dev.warp.Warp.desktop");
    mkdirSync(join(w.home, "Desktop"));
    writeFileSync(shortcut, "[Desktop Entry]\n");
    expect(await w.setup({ removeWarp: true })).toBe(1);
    expect(w.calls()).toBe("");
    expect(existsSync(shortcut)).toBe(true);
    expect(printed).toContain(
      "No terminal: nothing was run. Run `anymodel setup --remove-warp` in a terminal to run them.",
    );
  });

  test("another plugin from Warp's marketplace: the marketplace stays", async () => {
    const w = world({
      plugins: ["warp@claude-code-warp", "oz-harness-support@claude-code-warp"],
      marketplaces: ["claude-code-warp"],
    });
    expect(await w.setup({ removeWarp: true })).toBe(0);
    expect(w.calls()).toContain("claude plugin uninstall warp@claude-code-warp\n");
    expect(w.calls()).not.toContain("marketplace remove");
  });

  test("Fedora: dnf remove, the repository file, and Warp's key from rpm", async () => {
    const w = world({
      os: FEDORA,
      existing: [YUM_REPO],
      bins: {
        rpm: [
          '[ "$2" = gpg-pubkey ] && printf "gpg-pubkey-aaaa-1\\tOther signer\\ngpg-pubkey-fe49e02e-1\\tgpg(Warp Linux Maintainers)\\n" && exit 0',
          'printf "0.2026.10.01-1"',
        ].join("\n"),
      },
    });
    expect(await w.setup({ removeWarp: true })).toBe(0);
    expect(w.calls()).toContain(
      [
        "sudo dnf remove -y warp-terminal",
        `sudo rm -f ${YUM_REPO}`,
        "sudo rpm -e gpg-pubkey-fe49e02e-1",
        "",
      ].join("\n"),
    );
  });

  test("nothing of Warp's here: nothing to run, nothing asked", async () => {
    const w = world();
    expect(await w.setup({ removeWarp: true })).toBe(0);
    expect(w.calls()).toBe("");
    expect(w.questions).toEqual([]);
  });
});

describe("doctor's Warp line", () => {
  test("not installed: information; with its plugin: ✓; the plugin without the app, or the app without the plugin: ✗", () => {
    expect(warpCheck(world().machine, world().paths)).toEqual({
      ok: true,
      info: true,
      text: "Warp: not installed (optional: anymodel setup --warp)",
    });

    const both = world({
      bins: { "dpkg-query": `printf '${INSTALLED}'` },
      plugins: ["warp@claude-code-warp"],
    });
    expect(warpCheck(both.machine, both.paths)).toEqual({
      ok: true,
      text: "Warp 0.2026.10.01 is installed, with its Claude plugin",
    });

    const appOnly = world({ bins: { "dpkg-query": `printf '${INSTALLED}'` } });
    expect(warpCheck(appOnly.machine, appOnly.paths)).toEqual({
      ok: false,
      text: "Warp 0.2026.10.01 is installed, but its Claude plugin is not. Run: anymodel setup",
    });

    const pluginOnly = world({ plugins: ["warp@claude-code-warp"] });
    expect(warpCheck(pluginOnly.machine, pluginOnly.paths)).toEqual({
      ok: false,
      text: "the Warp Claude plugin warp@claude-code-warp is installed, but the Warp app is not. Run: anymodel setup --remove-warp (or anymodel setup --warp)",
    });
  });
});

describe("detectSystem", () => {
  test("reads ID and ID_LIKE: Ubuntu and Debian-like are apt, Fedora is dnf; others are none", () => {
    const w = world();
    const on = (os: string, extra: Partial<Machine> = {}) =>
      detectSystem({ ...w.machine, osRelease: () => os, ...extra }).kind;
    expect(on(UBUNTU)).toBe("apt");
    expect(on('ID=linuxmint\nID_LIKE="ubuntu debian"\n')).toBe("apt");
    expect(on(FEDORA)).toBe("dnf");
    expect(on('ID="rocky"\nID_LIKE="rhel centos fedora"\n')).toBe("dnf");
    expect(on(ARCH)).toBe("none");
    expect(on(UBUNTU, { arch: "arm64" })).toBe("none");
    expect(on(UBUNTU, { platform: "win32" })).toBe("none");
  });
});
