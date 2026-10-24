import { describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { tempDir } from "../testing/temp";
import { installLauncher } from "./launcher";
import { applyManagedJson, samePath } from "./managed-json";
import { applyManagedMarkdown } from "./managed-markdown";
import { restore } from "./restore";
import { listBackups, readChanged, writeManagedFile } from "./write";

const AUTO_UPDATE = ["extraKnownMarketplaces", "cc-smart-dev-kit", "autoUpdate"] as const;

/** The path setup writes the Tavily key to: its own `env` object when the settings had none. */
const TAVILY_KEY_PATH = ["env", "TAVILY_API_KEY"] as const;

const ORIGINAL_SETTINGS = `${JSON.stringify(
  {
    model: "opus",
    extraKnownMarketplaces: {
      "cc-smart-dev-kit": { source: { source: "github", repo: "example-org/cc-smart-dev-kit" } },
    },
  },
  null,
  2,
)}\n`;

function setup() {
  const dir = tempDir("restore");
  return { dir, stateDir: join(dir, "state") };
}

const read = (file: string) => readFileSync(file, "utf8");

describe("restore: except", () => {
  test("a file in `except` is left as it is and stays tracked; the next restore takes it", () => {
    const { dir, stateDir } = setup();
    const settings = join(dir, "settings.json");
    const copy = join(dir, "router.js");
    writeFileSync(settings, ORIGINAL_SETTINGS);
    applyManagedJson({ file: settings, stateDir, set: [[AUTO_UPDATE, true]] });
    writeManagedFile(copy, "// router\n", { stateDir, kind: "whole-file", mode: 0o644 });

    const first = restore(stateDir, { except: [copy] });
    expect(first.map((result) => [result.file, result.action])).toEqual([[settings, "cleaned"]]);
    expect(read(settings)).toBe(ORIGINAL_SETTINGS);
    expect(read(copy)).toBe("// router\n");
    expect(Object.keys(readChanged(stateDir))).toEqual([copy]);

    const second = restore(stateDir);
    expect(second.map((result) => [result.file, result.action])).toEqual([[copy, "removed"]]);
    expect(existsSync(copy)).toBe(false);
    expect(readChanged(stateDir)).toEqual({});
  });
});

describe("restore: only", () => {
  test("restores just the files named; every other file stays as it is and tracked", () => {
    const { dir, stateDir } = setup();
    const settings = join(dir, "settings.json");
    const copy = join(stateDir, "instructions", "core.md");
    writeFileSync(settings, ORIGINAL_SETTINGS);
    applyManagedJson({ file: settings, stateDir, set: [[AUTO_UPDATE, true]] });
    writeManagedFile(copy, "# Core\n", { stateDir, kind: "whole-file", mode: 0o644 });

    const result = restore(stateDir, { only: [copy] });
    expect(result.map((entry) => [entry.file, entry.action])).toEqual([[copy, "removed"]]);
    expect(read(settings)).not.toBe(ORIGINAL_SETTINGS);
    expect(Object.keys(readChanged(stateDir))).toEqual([settings]);
  });

  test("a removed file's empty folders go, up to the state folder; a folder outside it stays", () => {
    const { dir, stateDir } = setup();
    const inside = join(stateDir, "instructions", "optin", "worktrees.md");
    const outside = join(dir, "bin", "tool");
    writeManagedFile(inside, "# Worktrees\n", { stateDir, kind: "whole-file", mode: 0o644 });
    writeManagedFile(outside, "#!/bin/sh\n", { stateDir, kind: "whole-file", mode: 0o755 });

    restore(stateDir);
    expect(existsSync(join(stateDir, "instructions"))).toBe(false);
    expect(existsSync(stateDir)).toBe(true);
    expect(existsSync(outside)).toBe(false);
    expect(existsSync(join(dir, "bin"))).toBe(true);
  });
});

describe("restore: removes what cc-smart-dev-kit added, keeps the rest", () => {
  test("a key added by someone else after setup survives a restore", () => {
    const { dir, stateDir } = setup();
    const file = join(dir, "settings.json");
    writeFileSync(file, ORIGINAL_SETTINGS);
    applyManagedJson({ file, stateDir, set: [[AUTO_UPDATE, true]] });
    // Later, Claude Code adds a permission ("always allow").
    const later = JSON.parse(read(file));
    later.permissions = { allow: ["Bash(ls:*)"] };
    writeFileSync(file, `${JSON.stringify(later, null, 2)}\n`);
    const beforeRestore = read(file);

    const [result] = restore(stateDir);
    expect(result?.action).toBe("cleaned");
    expect(result?.details).toEqual(['extraKnownMarketplaces["cc-smart-dev-kit"].autoUpdate']);
    expect(JSON.parse(read(file))).toEqual({
      model: "opus",
      extraKnownMarketplaces: {
        "cc-smart-dev-kit": { source: { source: "github", repo: "example-org/cc-smart-dev-kit" } },
      },
      permissions: { allow: ["Bash(ls:*)"] },
    });
    // The state just before the restore is kept as a backup.
    expect(read(result?.savedAs ?? "")).toBe(beforeRestore);
  });

  test("two setups, then one restore, give back the original file", () => {
    const { dir, stateDir } = setup();
    const file = join(dir, "settings.json");
    writeFileSync(file, ORIGINAL_SETTINGS);
    applyManagedJson({ file, stateDir, set: [[AUTO_UPDATE, true]] });
    applyManagedJson({ file, stateDir, set: [[["statusLine"], { type: "command" }]] });
    restore(stateDir);
    expect(read(file)).toBe(ORIGINAL_SETTINGS);
  });

  test("an env setup itself created goes with the Tavily key: no `env: {}` is left behind", () => {
    const { dir, stateDir } = setup();
    const file = join(dir, "settings.json");
    // The person's settings, without an `env`: setup's key makes that object.
    writeFileSync(file, ORIGINAL_SETTINGS);
    applyManagedJson({
      file,
      stateDir,
      set: [[TAVILY_KEY_PATH, "tvly-secret"]],
      secret: () => true,
    });
    expect(JSON.parse(read(file)).env).toEqual({ TAVILY_API_KEY: "tvly-secret" });

    const [result] = restore(stateDir);
    expect(result?.action).toBe("cleaned");
    expect(result?.details).toEqual(["env.TAVILY_API_KEY", "env"]);
    expect(read(file)).toBe(ORIGINAL_SETTINGS);
  });

  test("an env the person had, even empty, stays: only cc-smart-dev-kit's key goes", () => {
    const { dir, stateDir } = setup();
    const file = join(dir, "settings.json");
    const original = `${JSON.stringify(
      {
        model: "opus",
        env: {},
        extraKnownMarketplaces: {
          "cc-smart-dev-kit": {
            source: { source: "github", repo: "example-org/cc-smart-dev-kit" },
          },
        },
      },
      null,
      2,
    )}\n`;
    writeFileSync(file, original);
    applyManagedJson({
      file,
      stateDir,
      set: [[TAVILY_KEY_PATH, "tvly-secret"]],
      secret: () => true,
    });

    const [result] = restore(stateDir);
    expect(result?.action).toBe("cleaned");
    expect(result?.details).toEqual(["env.TAVILY_API_KEY"]);
    expect(read(file)).toBe(original);
  });

  test("a whole file changed twice goes back to the state before the first change, with its mode", () => {
    const { dir, stateDir } = setup();
    const file = join(dir, "tool");
    writeFileSync(file, "the user's own\n");
    chmodSync(file, 0o640);
    writeManagedFile(file, "v1\n", { stateDir, kind: "whole-file", mode: 0o755 });
    writeManagedFile(file, "v2\n", { stateDir, kind: "whole-file", mode: 0o755 });
    const [result] = restore(stateDir);
    expect(result?.action).toBe("restored");
    expect(read(file)).toBe("the user's own\n");
    expect(statSync(file).mode & 0o777).toBe(0o640);
  });

  test("the Markdown block is removed and the text around it is kept", () => {
    const { dir, stateDir } = setup();
    const file = join(dir, "CLAUDE.md");
    writeFileSync(file, "# Notes\n\nKeep this.\n");
    applyManagedMarkdown({ file, stateDir, body: "@cc-smart-dev-kit/instructions/general.md" });
    // The user writes more after the block.
    writeFileSync(file, `${read(file)}\nWritten later by the user.\n`);
    const [result] = restore(stateDir);
    expect(result?.action).toBe("cleaned");
    expect(read(file)).toBe("# Notes\n\nKeep this.\n\nWritten later by the user.\n");
  });

  test("an appended block, removed again, leaves the file exactly as it was", () => {
    const { dir, stateDir } = setup();
    const file = join(dir, "CLAUDE.md");
    writeFileSync(file, "# Notes\n\nKeep this.\n");
    applyManagedMarkdown({ file, stateDir, body: "first" });
    applyManagedMarkdown({ file, stateDir, body: "second" });
    restore(stateDir);
    expect(read(file)).toBe("# Notes\n\nKeep this.\n");
  });

  test("the launcher that setup created is removed", () => {
    const { dir, stateDir } = setup();
    const binDir = join(dir, "bin");
    const { path } = installLauncher(binDir, { stateDir, bunPath: "/usr/bin/bun" });
    const [result] = restore(stateDir);
    expect(result?.action).toBe("removed");
    expect(existsSync(path)).toBe(false);
  });

  test("files cc-smart-dev-kit created with only its own content are removed", () => {
    const { dir, stateDir } = setup();
    const json = join(dir, "new-settings.json");
    const markdown = join(dir, "NEW.md");
    applyManagedJson({ file: json, stateDir, set: [[["a"], 1]] });
    applyManagedMarkdown({ file: markdown, stateDir, body: "x" });
    expect(restore(stateDir).map((result) => result.action)).toEqual(["removed", "removed"]);
    expect(existsSync(json)).toBe(false);
    expect(existsSync(markdown)).toBe(false);
  });

  test("a file that is whole-file and has a block too goes back to its baseline", () => {
    const { dir, stateDir } = setup();
    const file = join(dir, "both.md");
    writeFileSync(file, "original\n");
    writeManagedFile(file, "ours\n", { stateDir, kind: "whole-file" });
    applyManagedMarkdown({ file, stateDir, body: "x" });
    expect(readChanged(stateDir)[file]?.kinds).toEqual(["whole-file", "markdown-block"]);
    restore(stateDir);
    expect(read(file)).toBe("original\n");
  });

  test("a second restore changes nothing", () => {
    const { dir, stateDir } = setup();
    const file = join(dir, "settings.json");
    writeFileSync(file, ORIGINAL_SETTINGS);
    applyManagedJson({ file, stateDir, set: [[AUTO_UPDATE, true]] });
    restore(stateDir);
    const mtime = statSync(file).mtimeMs;
    const backups = listBackups(stateDir, file).length;
    expect(restore(stateDir)).toEqual([]);
    expect(statSync(file).mtimeMs).toBe(mtime);
    expect(listBackups(stateDir, file)).toHaveLength(backups);
  });

  test("a missing baseline backup: the file is left alone and still tracked", () => {
    const { dir, stateDir } = setup();
    const file = join(dir, "tool");
    writeFileSync(file, "original\n");
    writeManagedFile(file, "ours\n", { stateDir, kind: "whole-file" });
    unlinkSync(listBackups(stateDir, file)[0]?.path ?? "");
    const [result] = restore(stateDir);
    expect(result?.action).toBe("no-backup");
    expect(read(file)).toBe("ours\n");
    expect(Object.keys(readChanged(stateDir))).toEqual([file]);
  });

  test("nothing changed by cc-smart-dev-kit: nothing to restore", () => {
    expect(restore(setup().stateDir)).toEqual([]);
  });
});

describe("backups of executables", () => {
  test("are never executable, and restore gives the mode back", () => {
    const { dir, stateDir } = setup();
    const binDir = join(dir, "bin");
    const tool = join(binDir, "tool");
    mkdirSync(binDir);
    writeFileSync(tool, "#!/bin/sh\necho old\n");
    chmodSync(tool, 0o755);
    writeManagedFile(tool, "#!/bin/sh\necho new\n", { stateDir, kind: "whole-file", mode: 0o755 });

    const backups = listBackups(stateDir, tool);
    expect(backups).toHaveLength(1);
    const backup = backups[0]?.path ?? "";
    expect(backup).toEndWith(".mode-755");
    expect(statSync(backup).mode & 0o777).toBe(0o644);
    // The bin folder (on PATH) holds the tool alone: the backup is in the state folder.
    expect(readdirSync(binDir)).toEqual(["tool"]);
    expect(backup.startsWith(join(stateDir, "backups"))).toBe(true);

    const results = restore(stateDir);
    expect(results.find((result) => result.file === tool)?.action).toBe("restored");
    expect(read(tool)).toBe("#!/bin/sh\necho old\n");
    expect(statSync(tool).mode & 0o777).toBe(0o755);
    expect(readdirSync(binDir)).toEqual(["tool"]);
    // The backup restore made of the state before it is not executable either.
    const savedAs = results.find((result) => result.file === tool)?.savedAs ?? "";
    expect(statSync(savedAs).mode & 0o111).toBe(0);
  });
});

describe("where backups live", () => {
  test("in <stateDir>/backups/<real path, encoded>/, folders 0700, nothing beside the file", () => {
    const { dir, stateDir } = setup();
    const file = join(dir, "settings.json");
    writeFileSync(file, ORIGINAL_SETTINGS);
    applyManagedJson({ file, stateDir, set: [[AUTO_UPDATE, true]] });
    const folder = join(stateDir, "backups", encodeURIComponent(file));
    expect(readdirSync(folder)).toHaveLength(1);
    expect(readdirSync(folder)[0]).toMatch(/^settings\.json\.bak-cc-smart-dev-kit-\d{8}T\d{9}Z$/);
    expect(statSync(join(stateDir, "backups")).mode & 0o777).toBe(0o700);
    expect(statSync(folder).mode & 0o777).toBe(0o700);
    expect(readdirSync(dir).sort()).toEqual(["settings.json", "state"]);
  });

  test("a symlinked file (a dotfiles repo): no backup lands in the repo; restore still works", () => {
    const { dir, stateDir } = setup();
    const dotfiles = join(dir, "dotfiles");
    mkdirSync(dotfiles);
    const target = join(dotfiles, "settings.json");
    writeFileSync(target, ORIGINAL_SETTINGS);
    const link = join(dir, "settings.json");
    symlinkSync(target, link);
    applyManagedJson({ file: link, stateDir, set: [[AUTO_UPDATE, true]] });
    expect(readdirSync(dotfiles)).toEqual(["settings.json"]);
    // The folder is named by the real path, the link's target.
    expect(listBackups(stateDir, link).map((backup) => dirname(backup.path))).toEqual([
      join(stateDir, "backups", encodeURIComponent(target)),
    ]);
    restore(stateDir);
    expect(read(target)).toBe(ORIGINAL_SETTINGS);
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readdirSync(dotfiles)).toEqual(["settings.json"]);
  });

  test("a file setup creates in a linked folder keeps one backup folder, and restore removes it", () => {
    const { dir, stateDir } = setup();
    const realBin = join(dir, "real-bin");
    mkdirSync(realBin);
    const linkedBin = join(dir, "bin");
    symlinkSync(realBin, linkedBin);
    const { path } = installLauncher(linkedBin, { stateDir, bunPath: "/usr/bin/bun" });
    installLauncher(linkedBin, { stateDir, bunPath: "/opt/bun" });
    // Both writes are tracked under the real path, so the .absent baseline is found.
    expect(Object.keys(readChanged(stateDir))).toEqual([join(realBin, "cc-smart-dev-kit")]);
    expect(restore(stateDir).map((result) => result.action)).toEqual(["removed"]);
    expect(existsSync(path)).toBe(false);
  });
});

describe("restore: write instead", () => {
  test("a key written again is reported in `written`, and the file stays tracked for stage 2", () => {
    const { dir, stateDir } = setup();
    const settings = join(dir, "settings.json");
    writeFileSync(settings, ORIGINAL_SETTINGS);
    applyManagedJson({ file: settings, stateDir, set: [[AUTO_UPDATE, true]] });

    const [first] = restore(stateDir, {
      writeInstead: (_file, path) =>
        samePath(path, AUTO_UPDATE) ? { value: "sentinel" } : undefined,
    });
    expect(first?.action).toBe("cleaned");
    expect(first?.details).toEqual([]);
    expect(first?.written).toEqual([
      { path: 'extraKnownMarketplaces["cc-smart-dev-kit"].autoUpdate', value: "sentinel" },
    ]);
    expect(JSON.parse(read(settings)).extraKnownMarketplaces["cc-smart-dev-kit"].autoUpdate).toBe(
      "sentinel",
    );
    // It still holds one of ours: the run that takes the key back finds it.
    expect(Object.keys(readChanged(stateDir))).toEqual([settings]);

    const [second] = restore(stateDir);
    expect(second?.action).toBe("cleaned");
    expect(second?.details).toEqual(['extraKnownMarketplaces["cc-smart-dev-kit"].autoUpdate']);
    expect(readChanged(stateDir)).toEqual({});
  });
});
