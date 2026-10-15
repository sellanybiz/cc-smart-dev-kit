/**
 * Warp: `setup --warp`, `setup --remove-warp`, plain setup and doctor, run in this process
 * with a fake machine (`src/testing/fake-machine.ts`). No test reaches a real package
 * manager, a real `claude`, the network, or the real home folder.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  ARCH_LINUX,
  capturePrinted,
  FAKE_KEY,
  FEDORA,
  printed,
  showKeysOutput,
  UBUNTU,
  WARP_FPR,
  world,
} from "../testing/fake-machine";
import type { Machine } from "./machine";
import {
  APT_KEY,
  APT_SOURCE,
  aptSourceText,
  detectSystem,
  warpCheck,
  YUM_REPO,
  YUM_REPO_TEXT,
} from "./warp";

capturePrinted();

const INSTALLED = "Package: warp-terminal\nStatus: install ok installed\nVersion: 0.2026.10.01\n";

const STAGE = (home: string) => join(home, ".claude", "anymodel", "warp");
const install = (from: string, to: string) =>
  `sudo install -D -o root -g root -m 644 ${from} ${to}`;
const showKeys = (stage: string) =>
  `gpg --homedir ${stage}/gnupg --batch --show-keys --with-colons ${stage}/warp.asc`;

describe("setup --warp", () => {
  test("Debian/Ubuntu: the key checked and put in place with the source, then apt; asked once; then Warp's plugin", async () => {
    const w = world();
    expect(await w.setup({ warp: true })).toBe(0);
    const stage = STAGE(w.home);
    expect(w.calls()).toBe(
      [
        showKeys(stage),
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
    expect(readFileSync(join(w.staged, "warpdotdev.sources"), "utf8")).toBe(aptSourceText("amd64"));
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

  test("the apt source is byte for byte what Warp's own package writes (its postinst), per architecture", () => {
    // Copied by hand from the postinst of warp-terminal 0.2026.10.07.08.29.stable.00, with
    // apt's default folders: the same file, so apt never sees two Warp sources. Each
    // package writes its OWN architecture (read from the control member of the amd64 and of
    // the arm64 package of that version, unpacked, never installed).
    expect(APT_SOURCE).toBe("/etc/apt/sources.list.d/warpdotdev.sources");
    expect(APT_KEY).toBe("/etc/apt/trusted.gpg.d/warpdotdev.gpg");
    expect(aptSourceText("amd64")).toBe(
      [
        "### THIS FILE IS AUTOMATICALLY CONFIGURED ###",
        "# You may comment out this entry, but other modifications to the file may be lost.",
        "",
        "Types: deb",
        "URIs: https://releases.warp.dev/linux/deb",
        "Suites: stable",
        "Components: main",
        "Architectures: amd64",
        "Signed-By: /etc/apt/trusted.gpg.d/warpdotdev.gpg",
        "",
      ].join("\n"),
    );
    expect(aptSourceText("arm64")).toBe(
      [
        "### THIS FILE IS AUTOMATICALLY CONFIGURED ###",
        "# You may comment out this entry, but other modifications to the file may be lost.",
        "",
        "Types: deb",
        "URIs: https://releases.warp.dev/linux/deb",
        "Suites: stable",
        "Components: main",
        "Architectures: arm64",
        "Signed-By: /etc/apt/trusted.gpg.d/warpdotdev.gpg",
        "",
      ].join("\n"),
    );
  });

  test("arm64 Debian/Ubuntu: the same apt way, with arm64 in the source (Warp's own package writes it)", async () => {
    const w = world({ arch: "arm64" });
    expect(await w.setup({ warp: true })).toBe(0);
    const stage = STAGE(w.home);
    expect(readFileSync(join(w.staged, "warpdotdev.sources"), "utf8")).toBe(aptSourceText("arm64"));
    expect(w.calls()).toBe(
      [
        showKeys(stage),
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
  });

  test("a downloaded key with another fingerprint: a clear stop, no command runs, the rest of setup goes on", async () => {
    const other = "1111111111111111111111111111111111111111";
    const w = world({
      bins: { gpg: `printf '${showKeysOutput(other)}'` },
    });
    expect(await w.setup({ warp: true })).toBe(1);
    expect(w.calls()).not.toContain("sudo");
    expect(w.calls()).not.toContain("claude plugin");
    expect(printed.join("\n")).toContain(
      `! Warp's signing key changed: https://releases.warp.dev/linux/keys/warp.asc now holds the key ${other}, and anymodel expects ${WARP_FPR}. Nothing was installed.`,
    );
    expect(existsSync(STAGE(w.home))).toBe(false);
    // The launcher and auto-update do not depend on Warp.
    expect(existsSync(join(w.home, ".local", "bin", "anymodel"))).toBe(true);
  });

  test("a key file with a second key in it is refused, even when the first is Warp's", async () => {
    const w = world({
      bins: {
        gpg: `printf '${showKeysOutput(WARP_FPR, "2222222222222222222222222222222222222222")}'`,
      },
    });
    expect(await w.setup({ warp: true })).toBe(1);
    expect(w.calls()).not.toContain("sudo");
    expect(printed.join("\n")).toContain("holds 2 keys, not Warp's one key");
  });

  test("no terminal: the commands are printed, none runs; the rest of setup is done; exit 1", async () => {
    const w = world({ answer: null });
    expect(await w.setup({ warp: true })).toBe(1);
    expect(w.calls()).toBe("");
    expect(printed).toContain(
      "! Warp: no terminal, so these commands were not run. Run `anymodel setup --warp` in a terminal to run them.",
    );
    expect(printed).toContain("  $ sudo apt-get install -y warp-terminal");
    expect(existsSync(join(w.home, ".local", "bin", "anymodel"))).toBe(true);
  });

  test("the person says no: no Warp command and no Warp plugin; exit 1", async () => {
    const w = world({ answer: false });
    expect(await w.setup({ warp: true })).toBe(1);
    expect(w.calls()).toBe("");
    expect(printed).toContain("! Warp: these commands were not run (you said no).");
  });

  test("a Warp source already there is kept: no second source file", async () => {
    const w = world({ existing: ["/etc/apt/sources.list.d/warpdotdev.list"] });
    await w.setup({ warp: true });
    expect(w.calls()).not.toContain(APT_SOURCE);
    expect(w.calls()).toContain("sudo apt-get install -y warp-terminal");
  });

  test("a command that fails after others ran: what ran, and how to undo it; no plugin; exit 1", async () => {
    const w = world({
      bins: { sudo: '[ "$1" = apt-get ] && [ "$2" = install ] && exit 100; exit 0' },
    });
    expect(await w.setup({ warp: true })).toBe(1);
    const stage = STAGE(w.home);
    expect(printed.join("\n")).toContain(
      [
        "! sudo apt-get install -y warp-terminal failed (exit 100). Nothing after it ran.",
        "  These ran before it:",
        `    $ ${install(`${stage}/warpdotdev.gpg`, APT_KEY)}`,
        `    $ ${install(`${stage}/warpdotdev.sources`, APT_SOURCE)}`,
        "    $ sudo apt-get update",
        "  To undo them: anymodel setup --remove-warp",
      ].join("\n"),
    );
    expect(w.calls()).not.toContain("claude plugin");
    expect(existsSync(stage)).toBe(false);
  });

  test("the first command fails: nothing to undo, so no undo line", async () => {
    const w = world({ bins: { sudo: "exit 1" } });
    expect(await w.setup({ warp: true })).toBe(1);
    expect(printed.join("\n")).not.toContain("To undo them");
  });

  test("Fedora: rpm imports the checked key from the stage (not from the URL), the repository file, then dnf", async () => {
    const w = world({ os: FEDORA });
    expect(await w.setup({ warp: true })).toBe(0);
    const stage = STAGE(w.home);
    expect(w.calls()).toBe(
      [
        showKeys(stage),
        `sudo rpm --import ${stage}/warp.asc`,
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
      world({ os: ARCH_LINUX }),
      // Ubuntu, but an architecture Warp's apt source has no packages for.
      world({ os: UBUNTU, arch: "riscv64" }),
      world({ os: FEDORA, arch: "ppc64" }),
    ]) {
      if (w.machine.platform === "darwin") {
        // No brew on this PATH.
        rmSync(join(w.bin, "brew"));
      }
      printed.length = 0;
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
  test("with the Warp app there: its plugin is not added; Warp is not even looked for", async () => {
    const w = world({ bins: { "dpkg-query": `printf '${INSTALLED}'` } });
    expect(await w.setup()).toBe(0);
    expect(w.calls()).toBe("");
    expect(w.questions).toEqual([]);
  });

  test("without the Warp app: nothing about Warp", async () => {
    const w = world();
    expect(await w.setup()).toBe(0);
    expect(w.calls()).toBe("");
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

  test("a package removed but not purged does not count as installed", async () => {
    const w = world({
      bins: {
        "dpkg-query": "printf 'Package: warp-terminal\\nStatus: deinstall ok config-files\\n'",
      },
      existing: [APT_SOURCE],
    });
    await w.setup({ removeWarp: true });
    expect(w.calls()).not.toContain("purge");
    expect(w.calls()).toContain(`sudo rm -f ${APT_SOURCE}`);
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
      "! Warp: no terminal, so these commands were not run. Run `anymodel setup --remove-warp` in a terminal to run them.",
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

  test("Fedora: dnf remove, the repository file, and only the rpm key whose id is the pinned key's", async () => {
    const w = world({
      os: FEDORA,
      existing: [YUM_REPO],
      bins: {
        rpm: [
          // A key whose summary names Warp, but whose id is not Warp's: it stays.
          '[ "$2" = gpg-pubkey ] && printf "gpg-pubkey-0badc0de-1\\tWarp lookalike\\ngpg-pubkey-d60f803f-65c9382c\\td60f803f\\n" && exit 0',
          'printf "0.2026.10.01-1"',
        ].join("\n"),
      },
    });
    expect(await w.setup({ removeWarp: true })).toBe(0);
    expect(w.calls()).toContain(
      [
        "sudo dnf remove -y warp-terminal",
        `sudo rm -f ${YUM_REPO}`,
        "sudo rpm -e gpg-pubkey-d60f803f-65c9382c",
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
  test("not installed, or the app without its plugin (missing or off): information; with its plugin: ✓; the plugin without the app: ✗", () => {
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
      ok: true,
      info: true,
      text: "Warp 0.2026.10.01 is installed, without its Claude plugin (optional: anymodel setup --warp)",
    });

    const off = world({
      bins: { "dpkg-query": `printf '${INSTALLED}'` },
      plugins: ["warp@claude-code-warp"],
    });
    const settings = JSON.parse(readFileSync(off.paths.settingsFile, "utf8"));
    settings.enabledPlugins["warp@claude-code-warp"] = false;
    writeFileSync(off.paths.settingsFile, JSON.stringify(settings));
    expect(warpCheck(off.machine, off.paths)).toEqual({
      ok: true,
      info: true,
      text: "Warp 0.2026.10.01 is installed, with its Claude plugin turned off (optional: claude plugin enable warp@claude-code-warp)",
    });

    const pluginOnly = world({ plugins: ["warp@claude-code-warp"] });
    expect(warpCheck(pluginOnly.machine, pluginOnly.paths)).toEqual({
      ok: false,
      text: "the Warp Claude plugin warp@claude-code-warp is installed, but the Warp app is not. Run: anymodel setup --remove-warp (or anymodel setup --warp)",
    });
  });
});

describe("detectSystem", () => {
  test("reads ID and ID_LIKE: Ubuntu and Debian-like are apt (x86_64 and arm64), Fedora is dnf (x86_64 and aarch64); others are none", () => {
    const w = world();
    const on = (os: string, extra: Partial<Machine> = {}) =>
      detectSystem({ ...w.machine, osRelease: () => os, ...extra }).kind;
    expect(on(UBUNTU)).toBe("apt");
    expect(on(UBUNTU, { arch: "arm64" })).toBe("apt");
    expect(on('ID=linuxmint\nID_LIKE="ubuntu debian"\n')).toBe("apt");
    expect(on(FEDORA)).toBe("dnf");
    expect(on(FEDORA, { arch: "arm64" })).toBe("dnf");
    expect(on(FEDORA, { arch: "ppc64" })).toBe("none");
    expect(on('ID="rocky"\nID_LIKE="rhel centos fedora"\n')).toBe("dnf");
    expect(on(ARCH_LINUX)).toBe("none");
    expect(on(UBUNTU, { arch: "riscv64" })).toBe("none");
    expect(on(UBUNTU, { platform: "win32" })).toBe("none");
  });
});
