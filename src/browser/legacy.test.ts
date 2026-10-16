/**
 * What version 0.3.0's shared browser left (`legacy.ts`): the profile folder, the picker file,
 * and the Chrome that may still be running on it. The profile may hold sign-ins, so NO test here
 * may find it deleted — that rule is the owner's, and it is asserted after every call.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cliPaths } from "../cli/paths";
import { tempDir } from "../testing/temp";
import { legacyBrowserFacts, legacyBrowserPaths, processCommandLines } from "./legacy";

interface LegacyWorld {
  deps: {
    exists: (path: string) => boolean;
    home: string;
    platform: NodeJS.Platform;
    run: (argv: string[]) => { exitCode: number; output: string };
  };
  home: string;
  paths: ReturnType<typeof cliPaths>;
  picker: string;
  profile: string;
  /** 0.3.0's profile folder, with a cookie in it: the sign-ins the lines warn about. */
  withProfile: () => void;
  /** 0.3.0's init page beside it. */
  withPicker: () => void;
}

function legacyWorld(platform: NodeJS.Platform = "linux"): LegacyWorld {
  const home = tempDir("legacy-browser");
  const paths = cliPaths({ HOME: home });
  const { picker, profile } = legacyBrowserPaths(paths);
  return {
    deps: { exists: existsSync, home, platform, run: () => ({ exitCode: 1, output: "" }) },
    home,
    paths,
    picker,
    profile,
    withPicker: () => {
      mkdirSync(paths.dataDir, { recursive: true });
      writeFileSync(picker, "// 0.3.0's init page\n");
    },
    withProfile: () => {
      mkdirSync(profile, { recursive: true });
      writeFileSync(join(profile, "Cookies"), "a signed-in cookie");
    },
  };
}

/** Asserted after every call: the plugin never deletes or changes what 0.3.0 left. */
function stillThere(world: LegacyWorld): void {
  if (existsSync(world.profile)) {
    expect(readFileSync(join(world.profile, "Cookies"), "utf8")).toBe("a signed-in cookie");
  }
  if (existsSync(world.picker)) {
    expect(readFileSync(world.picker, "utf8")).toBe("// 0.3.0's init page\n");
  }
}

const chromeCommand = (profile: string, extra = "") =>
  `/opt/google/chrome/chrome --user-data-dir=${profile} --remote-debugging-port=0${extra} about:blank`;

describe("legacyBrowserFacts", () => {
  test("no trace of 0.3.0: no facts at all, and the process list is never read", () => {
    const world = legacyWorld();
    let listed = 0;
    const facts = legacyBrowserFacts(world.paths, {
      ...world.deps,
      processes: () => {
        listed += 1;
        return [];
      },
    });
    expect(facts).toEqual([]);
    // A machine that never ran 0.3.0's browser is not asked about its processes: nothing of
    // 0.3.0's is there to look for.
    expect(listed).toBe(0);
    stillThere(world);
  });

  test("the profile folder and the picker: one warning, the exact command, and nothing deleted", () => {
    const world = legacyWorld();
    world.withProfile();
    world.withPicker();
    const facts = legacyBrowserFacts(world.paths, { ...world.deps, processes: () => [] });
    expect(facts).toHaveLength(1);
    expect(facts[0]?.kind).toBe("warn");
    const text = facts[0]?.text ?? "";
    expect(text).toContain(
      "the 0.3.0 shared browser's profile is still at ~/.local/share/cc-smart-dev-kit/playwright",
    );
    expect(text).toContain("may hold sign-ins");
    expect(text).toContain(
      "its file picker is at ~/.local/share/cc-smart-dev-kit/playwright-picker.js",
    );
    // The command removes both paths, spelled as this platform's shell takes them.
    expect(text).toContain(
      "rm -rf ~/.local/share/cc-smart-dev-kit/playwright " +
        "~/.local/share/cc-smart-dev-kit/playwright-picker.js",
    );
    expect(text).toContain("Delete them yourself when you no longer need the sign-ins");
    stillThere(world);
  });

  test("the profile folder alone: the line names no picker, and the command removes one path", () => {
    const world = legacyWorld();
    world.withProfile();
    const facts = legacyBrowserFacts(world.paths, { ...world.deps, processes: () => [] });
    const text = facts[0]?.text ?? "";
    expect(text).not.toContain("picker");
    expect(text).toContain("rm -rf ~/.local/share/cc-smart-dev-kit/playwright");
    stillThere(world);
  });

  test("Windows: PowerShell's Remove-Item, with the full path (`~` means nothing there)", () => {
    const home = "C:\\Users\\me";
    const dataDir = "C:\\Users\\me\\.local\\share\\cc-smart-dev-kit";
    const facts = legacyBrowserFacts(
      { dataDir, home },
      {
        exists: (path) => path.startsWith(dataDir),
        platform: "win32",
        processes: () => [],
      },
    );
    const text = facts[0]?.text ?? "";
    // The path is shown as Windows spells it, never with `~` (which no Windows shell takes).
    expect(text).toContain("still at C:\\Users\\me\\.local\\share\\cc-smart-dev-kit");
    expect(text).not.toContain("~");
    expect(text).toContain("Remove-Item -Recurse -Force '");
    expect(text).toContain("playwright'");
    expect(text).toContain("playwright-picker.js'");
    expect(text).not.toContain("rm -rf");
  });

  test("the picker alone: no leftover line, but the running Chrome is still looked for", () => {
    const world = legacyWorld();
    world.withPicker();
    const listed = legacyBrowserFacts(world.paths, {
      ...world.deps,
      processes: () => [{ command: chromeCommand(world.profile), pid: 4242 }],
    });
    // The picker on its own is harmless and is not named; the Chrome it belongs to is.
    expect(listed).toHaveLength(1);
    expect(listed[0]?.kind).toBe("warn");
    expect(listed[0]?.text).toContain("still running");
    stillThere(world);
  });

  test("the old Chrome still running: the pid is named, and its children are not", () => {
    const world = legacyWorld();
    world.withProfile();
    const facts = legacyBrowserFacts(world.paths, {
      ...world.deps,
      processes: () => [
        { command: chromeCommand(world.profile), pid: 1234 },
        {
          command: chromeCommand(world.profile).replace(
            "--remote-debugging-port=0",
            "--type=renderer",
          ),
          pid: 1235,
        },
        { command: "/usr/bin/other-program --user-data-dir=/somewhere/else", pid: 4321 },
      ],
    });
    const running = facts.find((fact) => fact.text.includes("still running"));
    expect(running?.kind).toBe("warn");
    expect(running?.text).toContain("pid 1234");
    // The renderer carries the same --user-data-dir and a --type= switch: not named.
    expect(running?.text).not.toContain("1235");
    expect(running?.text).not.toContain("4321");
    expect(running?.text).toContain("has no password");
    expect(running?.text).toContain("kill 1234");
    // The whole point: the pid, and the way out of a headless Chrome (which has no window).
    expect(running?.text).toContain("every window; a headless one has none");
    stillThere(world);
  });

  test("a quoted --user-data-dir (a home folder with a space) is the same Chrome", () => {
    const world = legacyWorld();
    world.withProfile();
    const facts = legacyBrowserFacts(world.paths, {
      ...world.deps,
      processes: () => [
        { command: `chrome --user-data-dir="${world.profile}" about:blank`, pid: 77 },
        // The quotes dropped, this one is a different folder: not this profile.
        { command: `chrome --user-data-dir="${world.profile}-2" about:blank`, pid: 78 },
      ],
    });
    const running = facts.find((fact) => fact.text.includes("still running"));
    expect(running?.text).toContain("pid 77");
    expect(running?.text).not.toContain("78");
    stillThere(world);
  });

  test("Windows: no window to close, so the kill command is taskkill", () => {
    const world = legacyWorld("win32");
    world.withProfile();
    const facts = legacyBrowserFacts(world.paths, {
      ...world.deps,
      platform: "win32",
      processes: () => [{ command: chromeCommand(world.profile), pid: 99 }],
    });
    const running = facts.find((fact) => fact.text.includes("still running"));
    expect(running?.text).toContain("taskkill /PID 99 /F");
    stillThere(world);
  });

  test("a process list that cannot be read: 'could not check', never 'none'", () => {
    const world = legacyWorld();
    world.withProfile();
    const facts = legacyBrowserFacts(world.paths, { ...world.deps, processes: () => null });
    expect(facts.map((fact) => fact.kind)).toEqual(["warn", "info"]);
    const unknown = facts[1]?.text ?? "";
    expect(unknown).toContain("cannot read this machine's process list");
    expect(unknown).toContain(`--user-data-dir=~/.local/share/cc-smart-dev-kit/playwright`);
    expect(unknown).toContain("unknown");
    expect(unknown).not.toContain("nothing is running");
    stillThere(world);
  });

  test("a machine whose platform has no listing says so, rather than 'nothing is running'", () => {
    const world = legacyWorld();
    world.withProfile();
    const facts = legacyBrowserFacts(world.paths, { ...world.deps, platform: "aix" });
    expect(facts[0]?.kind).toBe("warn");
    expect(facts[1]?.kind).toBe("info");
    stillThere(world);
  });

  test("a folder whose name only STARTS with the profile's is another folder", () => {
    const world = legacyWorld();
    world.withProfile();
    const facts = legacyBrowserFacts(world.paths, {
      ...world.deps,
      processes: () => [
        // 0.4.0's own output folder sits beside the old profile: nothing started Chrome on it.
        { command: `chrome --user-data-dir=${world.paths.browserOutputDir} about:blank`, pid: 5 },
        // And a folder below it is not the profile either.
        { command: `chrome --user-data-dir=${world.profile}/tmp about:blank`, pid: 6 },
      ],
    });
    expect(facts.some((fact) => fact.text.includes("still running"))).toBe(false);
    stillThere(world);
  });
});

describe("processCommandLines", () => {
  test("macOS asks ps for every command line, and reads its own shape", () => {
    const asked: string[][] = [];
    const lines = processCommandLines("darwin", (argv) => {
      asked.push(argv);
      return {
        exitCode: 0,
        output:
          "  123 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/Users/me/x\n" +
          " 7 /usr/bin/something else\n" +
          "\n" +
          "not a pid line\n",
      };
    });
    expect(asked).toEqual([["ps", "-ww", "-axo", "pid=,command="]]);
    expect(lines).toEqual([
      {
        command:
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome --user-data-dir=/Users/me/x",
        pid: 123,
      },
      { command: "/usr/bin/something else", pid: 7 },
    ]);
  });

  test("Windows asks PowerShell for ProcessId and CommandLine — read only, and no wmic", () => {
    const asked: string[][] = [];
    const lines = processCommandLines("win32", (argv) => {
      asked.push(argv);
      return {
        exitCode: 0,
        output:
          "1234 C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe --user-data-dir=C:\\x about:blank\r\n" +
          "5678 \r\n",
      };
    });
    const argv = asked[0] ?? [];
    expect(argv.slice(0, 4)).toEqual(["powershell", "-NoProfile", "-NonInteractive", "-Command"]);
    expect(argv[4]).toContain("Get-CimInstance Win32_Process");
    expect(argv[4]).toContain('"$($_.ProcessId) $($_.CommandLine)"');
    expect(argv.join(" ")).not.toContain("wmic");
    expect(lines).toEqual([
      {
        command:
          "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe --user-data-dir=C:\\x about:blank",
        pid: 1234,
      },
    ]);
  });

  test("a listing that fails is null, never an empty list", () => {
    for (const platform of ["darwin", "win32"] as NodeJS.Platform[]) {
      expect(
        processCommandLines(platform, () => ({ exitCode: 1, output: "command not found" })),
      ).toBeNull();
    }
    // No way to run the command at all (a test's world without one): unknown, never "none".
    expect(processCommandLines("darwin")).toBeNull();
    expect(processCommandLines("win32")).toBeNull();
  });

  test("Linux reads /proc, and this very test process is in it", () => {
    const lines = processCommandLines("linux");
    expect(lines).not.toBeNull();
    const ours = (lines ?? []).filter((process) => process.pid === globalThis.process.pid);
    expect(ours).toHaveLength(1);
    expect(ours[0]?.command.toLowerCase()).toContain("bun");
  });
});
