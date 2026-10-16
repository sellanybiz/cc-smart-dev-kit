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
      "cc-smart-dev-kit: bun not found (not at %baked_bun%, not on PATH). Install bun, then run: cc-smart-dev-kit setup",
    );
  });

  test("runs the installed cli.js with --no-env-file, and passes every argument through", () => {
    expect(script).toContain(
      'rem --no-env-file: "cc-smart-dev-kit job run" hands its job exactly the environment it was given.\n"%bun%" --no-env-file "%install_path%\\dist\\cli.js" %*',
    );
    expect(script).toContain("exit /b %ERRORLEVEL%");
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
      "cc-smart-dev-kit: the cc-smart-dev-kit plugin folder is missing: %install_path%. Run: claude plugin install cc-smart-dev-kit@cc-smart-dev-kit",
    );
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
    ["C:\\Users\\me\\.bun\\bin\\bun.exe"],
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
