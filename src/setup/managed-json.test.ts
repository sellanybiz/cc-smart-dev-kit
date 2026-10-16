import { describe, expect, test } from "bun:test";
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tempDir } from "../testing/temp";
import { applyManagedJson, ForeignKeyError, formatKeyPath } from "./managed-json";
import { restore } from "./restore";
import { ConcurrentChangeError, listBackups, readChanged, writeManagedFile } from "./write";

const AUTO_UPDATE = ["extraKnownMarketplaces", "cc-smart-dev-kit", "autoUpdate"] as const;

/** A settings.json as `claude plugin install` leaves it, plus a few keys of the user. */
const USER_SETTINGS = {
  model: "opus",
  env: { FOO: "bar" },
  enabledPlugins: { "cc-smart-dev-kit@cc-smart-dev-kit": true },
  extraKnownMarketplaces: {
    "cc-smart-dev-kit": { source: { source: "github", repo: "example-org/cc-smart-dev-kit" } },
  },
};

/** `null` content: no file at all. */
function setup(content: unknown = USER_SETTINGS) {
  const dir = tempDir("json");
  const file = join(dir, "settings.json");
  const stateDir = join(dir, "state");
  if (content !== null) writeFileSync(file, `${JSON.stringify(content, null, 2)}\n`);
  return { dir, file, stateDir };
}

const read = (file: string) => JSON.parse(readFileSync(file, "utf8"));

describe("applyManagedJson", () => {
  test("adds an owned key and records it in owned.json, with the value it wrote", () => {
    const { file, stateDir } = setup();
    const result = applyManagedJson({ file, stateDir, set: [[AUTO_UPDATE, true]] });
    expect(result.written).toBe(true);
    expect(result.changes).toEqual([{ path: AUTO_UPDATE, before: undefined, after: true }]);
    expect(read(file).extraKnownMarketplaces["cc-smart-dev-kit"].autoUpdate).toBe(true);
    expect(read(join(stateDir, "owned.json"))).toEqual({
      [file]: [{ path: ["extraKnownMarketplaces", "cc-smart-dev-kit", "autoUpdate"], value: true }],
    });
  });

  test("creates the file when it does not exist", () => {
    const { file, stateDir } = setup(null);
    applyManagedJson({ file, stateDir, set: [[["a", "b"], 1]] });
    expect(read(file)).toEqual({ a: { b: 1 } });
  });

  test("backs up the file before the first change", () => {
    const { file, stateDir } = setup();
    const before = readFileSync(file, "utf8");
    applyManagedJson({ file, stateDir, set: [[AUTO_UPDATE, true]] });
    const backups = listBackups(stateDir, file);
    expect(backups).toHaveLength(1);
    expect(readFileSync(backups[0]?.path ?? "", "utf8")).toBe(before);
  });

  test("a second identical run writes nothing: no new backup, same mtime", () => {
    const { file, stateDir } = setup();
    applyManagedJson({ file, stateDir, set: [[AUTO_UPDATE, true]] });
    const mtime = statSync(file).mtimeMs;
    const ownedMtime = statSync(join(stateDir, "owned.json")).mtimeMs;
    const second = applyManagedJson({ file, stateDir, set: [[AUTO_UPDATE, true]] });
    expect(second).toEqual({ file, changes: [], skipped: [], written: false, backup: null });
    expect(listBackups(stateDir, file)).toHaveLength(1);
    expect(statSync(file).mtimeMs).toBe(mtime);
    expect(statSync(join(stateDir, "owned.json")).mtimeMs).toBe(ownedMtime);
  });

  test("keeps every foreign key, at the top and beside the owned key", () => {
    const { file, stateDir } = setup();
    applyManagedJson({ file, stateDir, set: [[AUTO_UPDATE, true]] });
    expect(read(file)).toEqual({
      model: "opus",
      env: { FOO: "bar" },
      enabledPlugins: { "cc-smart-dev-kit@cc-smart-dev-kit": true },
      extraKnownMarketplaces: {
        "cc-smart-dev-kit": {
          source: { source: "github", repo: "example-org/cc-smart-dev-kit" },
          autoUpdate: true,
        },
      },
    });
  });

  test("keeps the file mode", () => {
    const { file, stateDir } = setup();
    chmodSync(file, 0o640);
    applyManagedJson({ file, stateDir, set: [[AUTO_UPDATE, true]] });
    expect(statSync(file).mode & 0o777).toBe(0o640);
  });

  test("a symlinked settings file stays a link; its target gets the change", () => {
    const { dir, file, stateDir } = setup();
    const link = join(dir, "linked-settings.json");
    symlinkSync(file, link);
    applyManagedJson({ file: link, stateDir, set: [[AUTO_UPDATE, true]] });
    expect(read(file).extraKnownMarketplaces["cc-smart-dev-kit"].autoUpdate).toBe(true);
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
  });

  test("refuses to overwrite a key it does not own, and writes nothing", () => {
    const { file, stateDir } = setup({
      extraKnownMarketplaces: { "cc-smart-dev-kit": { autoUpdate: false } },
    });
    const before = readFileSync(file, "utf8");
    expect(() => applyManagedJson({ file, stateDir, set: [[AUTO_UPDATE, true]] })).toThrow(
      ForeignKeyError,
    );
    expect(readFileSync(file, "utf8")).toBe(before);
    expect(listBackups(stateDir, file)).toHaveLength(0);
  });

  test("leaves a foreign key that already has the wanted value alone, and does not own it", () => {
    const { file, stateDir } = setup({
      extraKnownMarketplaces: { "cc-smart-dev-kit": { autoUpdate: true } },
    });
    const result = applyManagedJson({ file, stateDir, set: [[AUTO_UPDATE, true]] });
    expect(result.written).toBe(false);
    expect(result.skipped).toEqual([
      { path: AUTO_UPDATE, reason: "already set by someone else; left alone" },
    ]);
    // Not owned, so a removal keeps it.
    applyManagedJson({ file, stateDir, remove: [AUTO_UPDATE] });
    expect(read(file).extraKnownMarketplaces["cc-smart-dev-kit"].autoUpdate).toBe(true);
  });

  test("updates a key it owns to a new value", () => {
    const { file, stateDir } = setup();
    applyManagedJson({ file, stateDir, set: [[["statusLine"], "v1"]] });
    const result = applyManagedJson({ file, stateDir, set: [[["statusLine"], "v2"]] });
    expect(result.changes).toEqual([{ path: ["statusLine"], before: "v1", after: "v2" }]);
    expect(read(file).statusLine).toBe("v2");
  });

  test("removal removes only owned keys", () => {
    const { file, stateDir } = setup();
    applyManagedJson({ file, stateDir, set: [[AUTO_UPDATE, true]] });
    const result = applyManagedJson({
      file,
      stateDir,
      remove: [AUTO_UPDATE, ["model"], ["env", "FOO"]],
    });
    expect(result.changes).toEqual([{ path: AUTO_UPDATE, before: true, after: undefined }]);
    expect(read(file)).toEqual(USER_SETTINGS);
    expect(read(join(stateDir, "owned.json"))).toEqual({});
  });

  test("a dry run reports the change and writes nothing", () => {
    const { file, stateDir } = setup();
    const before = readFileSync(file, "utf8");
    const result = applyManagedJson({ file, stateDir, set: [[AUTO_UPDATE, true]], dryRun: true });
    expect(result.changes).toEqual([{ path: AUTO_UPDATE, before: undefined, after: true }]);
    expect(result.written).toBe(false);
    expect(readFileSync(file, "utf8")).toBe(before);
    expect(listBackups(stateDir, file)).toHaveLength(0);
  });

  test("a settings file that is not JSON gives an error that names it", () => {
    const { file, stateDir } = setup();
    writeFileSync(file, "{ broken");
    expect(() => applyManagedJson({ file, stateDir, set: [[AUTO_UPDATE, true]] })).toThrow(
      `${file} is not valid JSON`,
    );
  });
});

describe("applyManagedJson: an owned key remembers the value cc-smart-dev-kit wrote", () => {
  test("the person changes an owned key: it is theirs; setup does not overwrite it, restore leaves it and lets it go", () => {
    const { file, stateDir } = setup();
    applyManagedJson({ file, stateDir, set: [[AUTO_UPDATE, true]] });
    const settings = read(file);
    settings.extraKnownMarketplaces["cc-smart-dev-kit"].autoUpdate = false;
    writeFileSync(file, JSON.stringify(settings, null, 2));
    const before = readFileSync(file, "utf8");
    expect(() => applyManagedJson({ file, stateDir, set: [[AUTO_UPDATE, true]] })).toThrow(
      `${file}: extraKnownMarketplaces["cc-smart-dev-kit"].autoUpdate is false: it was changed after cc-smart-dev-kit set it, so it is your choice now.`,
    );
    expect(readFileSync(file, "utf8")).toBe(before);

    const result = applyManagedJson({ file, stateDir, remove: [AUTO_UPDATE] });
    expect(result.changes).toEqual([]);
    expect(result.skipped).toEqual([
      { path: AUTO_UPDATE, reason: "changed since cc-smart-dev-kit set it; left alone" },
    ]);
    expect(read(file).extraKnownMarketplaces["cc-smart-dev-kit"].autoUpdate).toBe(false);
    expect(read(join(stateDir, "owned.json"))).toEqual({});
  });

  test("restore removes an owned key only while it holds cc-smart-dev-kit's value", () => {
    const { file, stateDir } = setup();
    applyManagedJson({
      file,
      stateDir,
      set: [
        [["statusLine"], "ours"],
        [AUTO_UPDATE, true],
      ],
    });
    const settings = read(file);
    settings.statusLine = "mine";
    writeFileSync(file, JSON.stringify(settings, null, 2));
    expect(restore(stateDir)).toEqual([
      expect.objectContaining({
        file,
        action: "cleaned",
        details: ['extraKnownMarketplaces["cc-smart-dev-kit"].autoUpdate'],
      }),
    ]);
    expect(read(file).statusLine).toBe("mine");
    expect(read(file).extraKnownMarketplaces["cc-smart-dev-kit"].autoUpdate).toBeUndefined();
  });

  test("a program's own default in an owned key is still cc-smart-dev-kit's to set", () => {
    const { file, stateDir } = setup({});
    const unchosen = (_path: readonly string[], value: unknown) => value === "";
    applyManagedJson({ file, stateDir, set: [[["provider"], "cheap"]], unchosen });
    // The program reset its settings to its defaults.
    writeFileSync(file, JSON.stringify({ provider: "" }));
    const result = applyManagedJson({ file, stateDir, set: [[["provider"], "cheap"]], unchosen });
    expect(result.changes).toEqual([{ path: ["provider"], before: "", after: "cheap" }]);
  });

  test("an older owned.json (paths only) still counts as owned, and gets the value on the next run", () => {
    const { file, stateDir } = setup({ statusLine: "old" });
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(join(stateDir, "owned.json"), JSON.stringify({ [file]: [["statusLine"]] }));
    const result = applyManagedJson({ file, stateDir, set: [[["statusLine"], "new"]] });
    expect(result.changes).toEqual([{ path: ["statusLine"], before: "old", after: "new" }]);
    expect(read(join(stateDir, "owned.json"))).toEqual({
      [file]: [{ path: ["statusLine"], value: "new" }],
    });

    // Already the wanted value: no write to the file, only the value recorded.
    writeFileSync(join(stateDir, "owned.json"), JSON.stringify({ [file]: [["statusLine"]] }));
    const mtime = statSync(file).mtimeMs;
    const again = applyManagedJson({ file, stateDir, set: [[["statusLine"], "new"]] });
    expect(again.written).toBe(false);
    expect(statSync(file).mtimeMs).toBe(mtime);
    expect(read(join(stateDir, "owned.json"))).toEqual({
      [file]: [{ path: ["statusLine"], value: "new" }],
    });
  });

  test("a secret: owned.json keeps only its hash; the file ends at mode 600; another secret there is the person's", () => {
    const { file, stateDir } = setup({ other: 1 });
    chmodSync(file, 0o644);
    const secret = (path: readonly string[]) => path.at(-1) === "API_KEY";
    const key = "sk-planted-SECRET-0123456789abcdef";
    applyManagedJson({ file, stateDir, set: [[["API_KEY"], key]], secret });
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const ownedText = readFileSync(join(stateDir, "owned.json"), "utf8");
    expect(ownedText).not.toContain("sk-planted");
    expect(JSON.parse(ownedText)[file]).toEqual([
      {
        path: ["API_KEY"],
        // sha256 of "\"sk-planted-SECRET-0123456789abcdef\"" (the value as JSON).
        sha256: "3dbcec2ab8a742d733b3c61dd9625c4ca38695ef2e65935f794894052f27a65d",
      },
    ]);
    writeFileSync(file, JSON.stringify({ other: 1, API_KEY: "sk-their-own-0000000000" }));
    expect(() => applyManagedJson({ file, stateDir, set: [[["API_KEY"], key]], secret })).toThrow(
      "API_KEY is a secret: it was changed after cc-smart-dev-kit set it",
    );
  });
});

describe("applyManagedJson when another program writes the file at the same time", () => {
  test("a write between our read and our write is kept, and ours is redone", () => {
    const { file, stateDir } = setup();
    let calls = 0;
    const result = applyManagedJson({
      file,
      stateDir,
      set: [[AUTO_UPDATE, true]],
      onBeforeWrite: () => {
        calls += 1;
        if (calls > 1) return;
        // Claude Code saves an "always allow" rule right now.
        const settings = read(file);
        settings.permissions = { allow: ["Bash(ls:*)"] };
        writeFileSync(file, JSON.stringify(settings, null, 2));
      },
    });
    expect(calls).toBe(2);
    expect(result.written).toBe(true);
    expect(read(file).permissions).toEqual({ allow: ["Bash(ls:*)"] });
    expect(read(file).extraKnownMarketplaces["cc-smart-dev-kit"].autoUpdate).toBe(true);
  });

  test("a file that keeps changing: a clear error after 3 tries, and only the other writes", () => {
    const { file, stateDir } = setup();
    let calls = 0;
    expect(() =>
      applyManagedJson({
        file,
        stateDir,
        set: [[AUTO_UPDATE, true]],
        onBeforeWrite: () => {
          calls += 1;
          writeFileSync(file, JSON.stringify({ ...read(file), [`k${calls}`]: calls }));
        },
      }),
    ).toThrow(ConcurrentChangeError);
    expect(calls).toBe(3);
    expect(read(file).extraKnownMarketplaces["cc-smart-dev-kit"].autoUpdate).toBeUndefined();
    expect(read(file).k3).toBe(3);
    // After the last failed try, owned.json is as it was before the first: no claim left.
    expect(read(join(stateDir, "owned.json"))).toEqual({});
  });

  test("another program sets the key itself in between: the retry refuses it and does not claim it", () => {
    const { file, stateDir } = setup();
    // cc-smart-dev-kit already owns another key in this file; that claim must survive.
    applyManagedJson({ file, stateDir, set: [[["statusLine"], "ours"]] });
    const ownedBefore = read(join(stateDir, "owned.json"));
    expect(ownedBefore).toEqual({ [file]: [{ path: ["statusLine"], value: "ours" }] });
    let calls = 0;
    expect(() =>
      applyManagedJson({
        file,
        stateDir,
        set: [[AUTO_UPDATE, true]],
        onBeforeWrite: () => {
          calls += 1;
          if (calls > 1) return;
          // The user turns auto-update off by hand, right between our read and our write.
          const settings = read(file);
          settings.extraKnownMarketplaces["cc-smart-dev-kit"].autoUpdate = false;
          writeFileSync(file, JSON.stringify(settings, null, 2));
        },
      }),
    ).toThrow(ForeignKeyError);
    expect(calls).toBe(1);
    expect(read(file).extraKnownMarketplaces["cc-smart-dev-kit"].autoUpdate).toBe(false);
    expect(read(join(stateDir, "owned.json"))).toEqual(ownedBefore);
  });
});

describe("writeManagedFile: the order of its steps", () => {
  test("changed.json records the file before the rename", () => {
    const { file, stateDir } = setup();
    let recordedBeforeRename: unknown = "not checked";
    writeManagedFile(file, "{}\n", {
      stateDir,
      kind: "json-keys",
      onBeforeCompare: () => {
        recordedBeforeRename = Object.keys(readChanged(stateDir));
      },
    });
    expect(recordedBeforeRename).toEqual([file]);
  });

  test("a write in the last moment before the rename: theirs stays, no temp file, no extra backup", () => {
    const { dir, file, stateDir } = setup();
    const theirs = '{"theirs":true}\n';
    // A first write makes the baseline backup.
    writeManagedFile(file, "{}\n", { stateDir, kind: "json-keys" });
    expect(() =>
      writeManagedFile(file, '{"ours":true}\n', {
        stateDir,
        kind: "json-keys",
        expectedContent: "{}\n",
        onBeforeCompare: () => writeFileSync(file, theirs),
      }),
    ).toThrow(ConcurrentChangeError);
    expect(readFileSync(file, "utf8")).toBe(theirs);
    expect(readdirSync(dir).sort()).toEqual(["settings.json", "state"]);
    expect(listBackups(stateDir, file)).toHaveLength(1);
  });

  test("a record whose write never happened is harmless: restore reports the file unchanged", () => {
    const { file, stateDir } = setup();
    const before = readFileSync(file, "utf8");
    expect(() =>
      writeManagedFile(file, "{}\n", {
        stateDir,
        kind: "json-keys",
        expectedContent: before,
        onBeforeCompare: () => writeFileSync(file, before.replace("opus", "sonnet")),
      }),
    ).toThrow(ConcurrentChangeError);
    expect(Object.keys(readChanged(stateDir))).toEqual([file]);
    expect(restore(stateDir)).toEqual([{ file, action: "unchanged", details: [] }]);
  });
});

describe("writeManagedFile with expectedContent", () => {
  test("refuses to write when the file holds other text than the caller read", () => {
    const { dir, stateDir } = setup();
    const file = join(dir, "notes.txt");
    writeFileSync(file, "changed by someone\n");
    expect(() =>
      writeManagedFile(file, "ours\n", {
        stateDir,
        kind: "whole-file",
        expectedContent: "what we read\n",
      }),
    ).toThrow(ConcurrentChangeError);
    expect(readFileSync(file, "utf8")).toBe("changed by someone\n");
  });

  test("expectedContent null: the file must still be missing", () => {
    const { dir, stateDir } = setup();
    const file = join(dir, "notes.txt");
    writeFileSync(file, "appeared\n");
    expect(() =>
      writeManagedFile(file, "ours\n", { stateDir, kind: "whole-file", expectedContent: null }),
    ).toThrow(ConcurrentChangeError);
  });
});

describe("formatKeyPath", () => {
  test("a name segment gets a dot; any other segment gets brackets and quotes", () => {
    expect(formatKeyPath(["extraKnownMarketplaces", "cc-smart-dev-kit", "autoUpdate"])).toBe(
      'extraKnownMarketplaces["cc-smart-dev-kit"].autoUpdate',
    );
    expect(formatKeyPath(["extraKnownMarketplaces", "my-marketplace", "autoUpdate"])).toBe(
      'extraKnownMarketplaces["my-marketplace"].autoUpdate',
    );
    expect(formatKeyPath(["two words"])).toBe('["two words"]');
  });
});
