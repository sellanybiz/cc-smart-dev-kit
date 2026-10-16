import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../testing/temp";
import {
  cmdBakedBunPath,
  installLauncherCmd,
  launcherCmdArgv,
  launcherCmdScript,
} from "./launcher-cmd";
import { restore } from "./restore";
import { readChanged, realTarget } from "./write";

/**
 * The plugin-lookup one-liner, taken out of the script so a Linux or macOS test can RUN it
 * with bun. The `cmd` layer itself cannot be run here; the JavaScript it hands to bun can,
 * and that is the part that can be wrong silently (a script that cannot look the plugin up
 * says "not installed").
 */
function lookupJs(script: string): string {
  const match = /-e "([^"]*)" -- /.exec(script);
  if (match?.[1] === undefined) throw new Error("no -e one-liner in the script");
  return match[1];
}

/**
 * Every variable of the script that holds a path. cmd substitutes a variable's value and
 * then reads the line again, so a `&` (or a space, a `^`, a `%`) in a path that is **not**
 * inside double quotes splits the line — the reviewer's finding. `%ERRORLEVEL%` (a number)
 * and `%*` (the caller's own command line) are deliberately not here.
 */
const PATH_VARIABLES = [
  "answer",
  "answer_dir",
  "baked_bun",
  "BUN_INSTALL",
  "bun",
  "CLAUDE_CONFIG_DIR",
  "config_dir",
  "install_path",
  "installed",
  "TEMP",
  "USERPROFILE",
];

/** The uses of a path variable that are outside double quotes, as `name in: <line>`. */
function usesOutsideQuotes(script: string): string[] {
  const found: string[] = [];
  for (const line of script.split("\n")) {
    let quoted = false;
    for (let at = 0; at < line.length; at += 1) {
      if (line[at] === '"') {
        quoted = !quoted;
        continue;
      }
      if (quoted) continue;
      for (const name of PATH_VARIABLES) {
        if (line.startsWith(`%${name}%`, at)) found.push(`${name} in: ${line.trim()}`);
      }
    }
  }
  return found;
}

/** A fake config folder whose installed_plugins.json holds `entries`. */
function installed(entries: unknown[]): string {
  const dir = tempDir("launcher-cmd");
  mkdirSync(join(dir, "plugins"), { recursive: true });
  const file = join(dir, "plugins", "installed_plugins.json");
  writeFileSync(
    file,
    JSON.stringify({ version: 2, plugins: { "cc-smart-dev-kit@cc-smart-dev-kit": entries } }),
  );
  return file;
}

function runLookup(js: string, file: string) {
  const result = Bun.spawnSync([process.execPath, "-e", js, "--", file], {
    stdout: "pipe",
    stderr: "pipe",
  });
  return { exitCode: result.exitCode, stdout: result.stdout.toString() };
}

describe("the Windows launcher script", () => {
  const BUN = "C:\\Users\\me\\.bun\\bin\\bun.exe";
  const script = launcherCmdScript(BUN);

  test("bakes the bun setup ran from, and finds it before anything else", () => {
    expect(script).toContain(`set "baked_bun=${BUN}"`);
    // The usual Windows install folders, then bun.exe on PATH, in that order.
    expect(script).toContain('if exist "%USERPROFILE%\\.bun\\bin\\bun.exe"');
    expect(script).toContain('for %%I in (bun.exe) do set "bun=%%~$PATH:I"');
    expect(script).toContain(
      'cc-smart-dev-kit: bun not found (not at "%baked_bun%", not on PATH). Install bun, then run: cc-smart-dev-kit setup',
    );
  });

  test("runs the installed cli.js with --no-env-file, and passes every argument through", () => {
    expect(script).toContain(
      'rem --no-env-file: "cc-smart-dev-kit job run" hands its job exactly the environment it was given.\n',
    );
    expect(script).toContain(
      '"%bun%" --no-env-file "--config=%install_path%\\bunfig.toml" "%install_path%\\dist\\cli.js" %*',
    );
    expect(script).toContain('"%bun%" --no-env-file "%install_path%\\dist\\cli.js" %*');
    expect(script).toContain("exit /b %ERRORLEVEL%");
  });

  test("the plugin's own config, so the working folder's bunfig.toml never runs in the command", () => {
    // The flag every other bun run of the plugin gets (`bun-config.ts`): bun would otherwise
    // read the working folder's `bunfig.toml`, and a project's `preload` would run its own
    // code inside the command. The config sits beside the CLI, in the version folder the
    // lookup just found; a version folder without one (an older installed version) runs the
    // plain line, because bun refuses a config path that does not exist. The flag and its
    // path are one quoted argument — never a variable holding quotes, which would come back
    // outside the run line's own quotes, where cmd reads them a second time.
    expect(script).toContain('if not exist "%install_path%\\bunfig.toml" goto no_config');
    expect(script).not.toContain('--config="%install_path%');
  });

  test("Claude Code's config folder, CLAUDE_CONFIG_DIR first, as the sh launcher does", () => {
    expect(script).toContain('set "config_dir=%CLAUDE_CONFIG_DIR%"');
    expect(script).toContain('if not defined config_dir set "config_dir=%USERPROFILE%\\.claude"');
    expect(script).toContain('set "installed=%config_dir%\\plugins\\installed_plugins.json"');
  });

  test("the plugin's messages are the sh launcher's, so both launchers say the same thing", () => {
    expect(script).toContain(
      "cc-smart-dev-kit: the cc-smart-dev-kit plugin is not installed. Run: claude plugin install cc-smart-dev-kit@cc-smart-dev-kit",
    );
    expect(script).toContain(
      'cc-smart-dev-kit: the cc-smart-dev-kit plugin folder is missing: "%install_path%". Run: claude plugin install cc-smart-dev-kit@cc-smart-dev-kit',
    );
  });

  test("every path is used inside quotes, and no path is a literal with a lone %", () => {
    // The reviewer's case: a profile folder with a `&` (or a space, a `^`, a `%`, a `!`) in
    // it. cmd reads each of those as its own unless the path is inside quotes, and a path
    // baked into the script's own text is a different thing again: cmd expands `%` there
    // even inside quotes (ss64, "Escape Percents").
    const odd = "C:\\Users\\O'Brien & Co\\100%\\bun!.exe";
    const oddScript = launcherCmdScript(odd);
    expect(usesOutsideQuotes(oddScript)).toEqual([]);
    // The baked line is quoted, and its `%` is doubled — one literal `%` in a batch file.
    expect(oddScript).toContain('set "baked_bun=C:\\Users\\O\'Brien & Co\\100%%\\bun!.exe"');
    expect(cmdBakedBunPath(oddScript)).toBe(odd);
    // `!` needs one more thing: delayed expansion off, or cmd would eat `!…!` in a path.
    expect(oddScript).toContain("setlocal DisableDelayedExpansion");
    expect(usesOutsideQuotes(script)).toEqual([]);
  });

  test("the lookup one-liner carries no double quote: it is one cmd argument", () => {
    const js = lookupJs(script);
    expect(js).not.toContain('"');
    expect(js).not.toContain("%"); // cmd would read it as a variable (the script doubles its own)
    expect(js).toContain("scope==='user'");
  });
});

describe("the lookup the .cmd hands to bun", () => {
  test("prints the user-scope install folder", () => {
    const js = lookupJs(launcherCmdScript("C:\\bun\\bun.exe"));
    const file = installed([
      { scope: "project", installPath: "C:\\p" },
      { scope: "user", installPath: "C:\\Users\\me\\.claude\\plugins\\cache\\x\\1.0.0" },
    ]);
    expect(runLookup(js, file)).toEqual({
      exitCode: 0,
      stdout: "C:\\Users\\me\\.claude\\plugins\\cache\\x\\1.0.0",
    });
  });

  test("exits 1 when there is no user-scope entry, so the script says 'not installed'", () => {
    const js = lookupJs(launcherCmdScript("C:\\bun\\bun.exe"));
    const file = installed([{ scope: "project", installPath: "C:\\p" }]);
    expect(runLookup(js, file)).toEqual({ exitCode: 1, stdout: "" });
  });
});

describe("reading the baked bun back", () => {
  test.each([
    ["C:\\Users\\me\\.bun\\bin\\bun.exe"],
    ["C:\\Program Files\\bun\\bun.exe"],
    ["/usr/local/bin/bun"],
    // The characters cmd reads as its own: a doubled `%` and a `!` (with delayed expansion
    // off) are the path again, and the quotes keep the `&` and the space.
    ["C:\\Users\\O'Brien & Co\\100%\\bun!.exe"],
    ["C:\\a^b\\bun.exe"],
  ])("round-trips: %s", (bun) => {
    expect(cmdBakedBunPath(launcherCmdScript(bun))).toBe(bun);
  });

  test("a script without the line gives null", () => {
    expect(cmdBakedBunPath("@echo off\r\nbun cli.js\r\n")).toBeNull();
  });
});

describe("installing the Windows launcher", () => {
  function world() {
    const home = tempDir("launcher-cmd-install");
    const binDir = join(home, ".local", "bin");
    const stateDir = join(home, ".claude", "cc-smart-dev-kit");
    mkdirSync(binDir, { recursive: true });
    return { binDir, stateDir };
  }

  test("it is written beside the sh launcher, and a second setup changes nothing", () => {
    const { binDir, stateDir } = world();
    const options = { stateDir, bunPath: "C:\\Users\\me\\.bun\\bin\\bun.exe" };
    const first = installLauncherCmd(binDir, options);
    expect(first.outcome).toBe("created");
    expect(first.path).toBe(join(binDir, "cc-smart-dev-kit.cmd"));
    expect(readFileSync(first.path, "utf8")).toBe(launcherCmdScript(options.bunPath));
    expect(installLauncherCmd(binDir, options).outcome).toBe("unchanged");
  });

  test("a dry run writes nothing at all", () => {
    const { binDir, stateDir } = world();
    const outcome = installLauncherCmd(binDir, {
      stateDir,
      bunPath: "C:\\bun\\bun.exe",
      dryRun: true,
    }).outcome;
    expect(outcome).toBe("created");
    expect(existsSync(join(binDir, "cc-smart-dev-kit.cmd"))).toBe(false);
    expect(existsSync(join(stateDir, "changed.json"))).toBe(false);
  });

  test("restore removes it: it is one whole file, like the sh launcher", () => {
    const { binDir, stateDir } = world();
    const { path } = installLauncherCmd(binDir, { stateDir, bunPath: "C:\\bun\\bun.exe" });
    expect(readChanged(stateDir)[realTarget(path)]).toBeDefined();
    const results = restore(stateDir);
    expect(results.map((result) => result.action)).toContain("removed");
    expect(existsSync(path)).toBe(false);
  });

  test("a bun path with a quote in it cannot break out of the set line", () => {
    const { binDir, stateDir } = world();
    const { path } = installLauncherCmd(binDir, {
      stateDir,
      bunPath: 'C:\\odd" dir\\bun.exe',
    });
    const script = readFileSync(path, "utf8");
    expect(script).toContain('set "baked_bun=C:\\odd dir\\bun.exe"');
    expect(cmdBakedBunPath(script)).toBe("C:\\odd dir\\bun.exe");
    rmSync(path, { force: true });
  });
});

describe("running the .cmd", () => {
  test("a .cmd is not an executable: it is started through cmd.exe", () => {
    expect(
      launcherCmdArgv("C:\\Users\\me\\.local\\bin\\cc-smart-dev-kit.cmd", ["version"]),
    ).toEqual(["cmd.exe", "/c", "C:\\Users\\me\\.local\\bin\\cc-smart-dev-kit.cmd", "version"]);
  });
});
