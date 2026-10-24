import { describe, expect, spyOn, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
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
import {
  applyManagedJson,
  createdObjects,
  ForeignKeyError,
  formatKeyPath,
  type KeyPath,
  type OwnedRecord,
} from "./managed-json";
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

describe("applyManagedJson: an object cc-smart-dev-kit created goes with its last key", () => {
  const TAVILY = ["env", "TAVILY_API_KEY"] as const;
  const add = (file: string, stateDir: string) =>
    applyManagedJson({ file, stateDir, set: [[TAVILY, "tvly-secret"]], secret: () => true });

  test("the settings had no env: setup created it, and restore takes it with the key", () => {
    const { file, stateDir } = setup({ model: "opus" });
    add(file, stateDir);
    expect(read(file)).toEqual({ env: { TAVILY_API_KEY: "tvly-secret" }, model: "opus" });

    const result = applyManagedJson({
      file,
      stateDir,
      remove: [TAVILY],
      createdObject: createdObjects(stateDir, file),
    });
    expect(result.changes).toEqual([
      { path: ["env", "TAVILY_API_KEY"], before: "tvly-secret", after: undefined },
      { path: ["env"], before: {}, after: undefined },
    ]);
    // Exactly the file before setup's first change, with no empty `env` left behind.
    expect(readFileSync(file, "utf8")).toBe(`${JSON.stringify({ model: "opus" }, null, 2)}\n`);
    expect(read(join(stateDir, "owned.json"))).toEqual({});
  });

  test("the person had an env of their own, empty: the key goes, their object stays", () => {
    const { file, stateDir } = setup({ env: {}, model: "opus" });
    add(file, stateDir);
    const result = applyManagedJson({
      file,
      stateDir,
      remove: [TAVILY],
      createdObject: createdObjects(stateDir, file),
    });
    expect(result.changes).toEqual([
      { path: ["env", "TAVILY_API_KEY"], before: "tvly-secret", after: undefined },
    ]);
    expect(read(file)).toEqual({ env: {}, model: "opus" });
  });

  test("no createdObject: the emptied object stays, as before", () => {
    const { file, stateDir } = setup({ model: "opus" });
    add(file, stateDir);
    applyManagedJson({ file, stateDir, remove: [TAVILY] });
    expect(read(file)).toEqual({ env: {}, model: "opus" });
  });

  test("every object above the key goes, up to the file's own top", () => {
    const { file, stateDir } = setup({ model: "opus" });
    applyManagedJson({ file, stateDir, set: [[["a", "b", "c"], 1]] });
    const result = applyManagedJson({
      file,
      stateDir,
      remove: [["a", "b", "c"]],
      createdObject: createdObjects(stateDir, file),
    });
    expect(result.changes.map((change) => change.path)).toEqual([
      ["a", "b", "c"],
      ["a", "b"],
      ["a"],
    ]);
    expect(read(file)).toEqual({ model: "opus" });
  });

  test("nothing proves cc-smart-dev-kit created it: no record, so nothing is pruned", () => {
    const { dir, file, stateDir } = setup({ model: "opus" });
    add(file, stateDir);
    // A state folder with no changed.json at all (an old one, or a hand-cleaned one).
    expect(createdObjects(join(dir, "empty-state"), file)(["env"])).toBe(false);
  });

  test("a baseline that is there but not valid JSON proves nothing: the empty object stays", () => {
    const { file, stateDir } = setup({ model: "opus" });
    add(file, stateDir);
    // What a hand edit (or a half-written backup) leaves: the record names the baseline, and
    // the baseline cannot be read as a JSON object.
    const baseline = listBackups(stateDir, file)[0];
    expect(baseline).toBeDefined();
    writeFileSync((baseline as { path: string }).path, "{ broken\n");
    expect(createdObjects(stateDir, file)(["env"])).toBe(false);
    const result = applyManagedJson({
      file,
      stateDir,
      remove: [TAVILY],
      createdObject: createdObjects(stateDir, file),
    });
    expect(result.changes.map((change) => change.path)).toEqual([["env", "TAVILY_API_KEY"]]);
    expect(read(file)).toEqual({ env: {}, model: "opus" });
  });

  test("a key the person added to a setup-created object keeps it, also at the last removal", () => {
    const { file, stateDir } = setup({ model: "opus" });
    add(file, stateDir);
    // The person uses the object setup made, for a key of their own.
    const settings = read(file);
    settings.env.MY_OWN_KEY = "mine";
    writeFileSync(file, JSON.stringify(settings, null, 2));
    const result = applyManagedJson({
      file,
      stateDir,
      remove: [TAVILY],
      createdObject: createdObjects(stateDir, file),
    });
    // The object holds their key, so it is not empty and does not go with cc-smart-dev-kit's.
    expect(result.changes.map((change) => change.path)).toEqual([["env", "TAVILY_API_KEY"]]);
    expect(read(file)).toEqual({ env: { MY_OWN_KEY: "mine" }, model: "opus" });
  });

  test("a baseline with the .absent marker says cc-smart-dev-kit created the whole file", () => {
    const { file, stateDir } = setup(null);
    add(file, stateDir);
    expect(listBackups(stateDir, file)[0]?.absent).toBe(true);
    // Everything in a file cc-smart-dev-kit created came from cc-smart-dev-kit.
    expect(createdObjects(stateDir, file)(["env"])).toBe(true);
    expect(createdObjects(stateDir, file)(["anything", "at", "all"])).toBe(true);
  });

  test("a changed.json that cannot be read: nothing is pruned, and one line says so", () => {
    // A read-only pass (setup's, `gateway off --dry-run`) calls this. A record it cannot use
    // must not fail it: the command that needs the record reads it itself, and reports its
    // own error. Without a record, nothing may be the person's and nothing is pruned.
    const { file, stateDir } = setup({ model: "opus" });
    add(file, stateDir);
    writeFileSync(join(stateDir, "changed.json"), "{ broken\n");
    const lines: string[] = [];
    const error = spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      lines.push(args.map(String).join(" "));
    });
    let plan: ReturnType<typeof applyManagedJson>;
    try {
      expect(createdObjects(stateDir, file)(["env"])).toBe(false);
      plan = applyManagedJson({
        file,
        stateDir,
        remove: [TAVILY],
        createdObject: createdObjects(stateDir, file),
        dryRun: true,
      });
    } finally {
      error.mockRestore();
    }
    // One line per call: one for each answer that had to fall back to "nothing is pruned".
    expect(lines).toHaveLength(2);
    expect(lines[0]).toStartWith("cc-smart-dev-kit: the record of changed files cannot be read (");
    expect(lines[0]).toEndWith(`, so nothing is pruned from ${file}.`);
    expect(lines[1]).toBe(lines[0]);
    // The read-only pass above planned the removal, kept the object (nothing proves
    // cc-smart-dev-kit made it) and wrote nothing. A pass that really writes reads the record
    // itself and fails with its own error: that is the command the person asked for, not a
    // check.
    expect(plan.changes.map((change) => change.path)).toEqual([["env", "TAVILY_API_KEY"]]);
    expect(plan.written).toBe(false);
    expect(read(file)).toEqual({ env: { TAVILY_API_KEY: "tvly-secret" }, model: "opus" });
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

describe("a key cc-smart-dev-kit takes over, and one it gives back", () => {
  test("claim: the key becomes ours with the value it holds, and the file is not written", () => {
    const { file, stateDir } = setup({ a: "theirs", b: "ours" });
    const before = readFileSync(file, "utf8");
    const result = applyManagedJson({
      file,
      stateDir,
      claim: [
        [["a"], "theirs"],
        [["missing"], "gone"],
      ],
    });
    // Nothing was written: no change, no backup, and the file is byte for byte the same.
    expect(result.changes).toEqual([]);
    expect(result.written).toBe(false);
    expect(result.backup).toBe(null);
    expect(readFileSync(file, "utf8")).toBe(before);
    expect(result.skipped).toEqual([
      { path: ["missing"], reason: "not the value it was taken over with; left alone" },
    ]);
    // The record keeps the value it held, which is what restore writes back, and says the key
    // is a taken-over one: its value is the person's, never replaced by another.
    expect(read(join(stateDir, "owned.json"))).toEqual({
      [file]: [{ path: ["a"], value: "theirs", was: "theirs", taken: true }],
    });
  });

  test("claim: a key that holds another value is left alone, and not owned", () => {
    const { file, stateDir } = setup({ a: "theirs" });
    const result = applyManagedJson({ file, stateDir, claim: [[["a"], "someone-elses"]] });
    expect(result.skipped).toEqual([
      { path: ["a"], reason: "not the value it was taken over with; left alone" },
    ]);
    expect(read(file).a).toBe("theirs");
    // Nothing was claimed, so there is no owned.json at all: no record proves nothing.
    expect(existsSync(join(stateDir, "owned.json"))).toBe(false);
  });

  test("claim: a secret keeps its hash alone, and the hash it was taken over with", () => {
    const { file, stateDir } = setup({ key: "sk-planted-0001" });
    applyManagedJson({
      file,
      stateDir,
      claim: [[["key"], "sk-planted-0001"]],
      secret: (path) => path.at(-1) === "key",
    });
    const owned = readFileSync(join(stateDir, "owned.json"), "utf8");
    expect(owned).not.toContain("PLANTED");
    // The record keeps the hash and the hash it was taken over with, never the value: a release
    // can then prove the key is still the person's own, and leave it where it is.
    const hash = createHash("sha256").update(JSON.stringify("sk-planted-0001")).digest("hex");
    expect(read(join(stateDir, "owned.json"))).toEqual({
      [file]: [{ path: ["key"], sha256: hash, taken: true, wasSha256: hash }],
    });
  });

  test("claim, then a write: the value it held then is kept, and restore can put it back", () => {
    const { file, stateDir } = setup({ a: "theirs" });
    applyManagedJson({ file, stateDir, claim: [[["a"], "theirs"]] });
    applyManagedJson({ file, stateDir, set: [[["a"], "ours"]] });
    expect(read(file).a).toBe("ours");
    expect(read(join(stateDir, "owned.json"))).toEqual({
      [file]: [{ path: ["a"], value: "ours", was: "theirs", taken: true }],
    });
    // And `release` writes that value back and gives the key up.
    applyManagedJson({ file, stateDir, release: [[["a"], "theirs"]] });
    expect(read(file).a).toBe("theirs");
    expect(read(join(stateDir, "owned.json"))).toEqual({});
    // A second restore has nothing of ours left in it.
    expect(restore(stateDir)).toEqual([{ action: "unchanged", details: [], file }]);
  });

  test("release: a key that already holds the value is given up, with no write", () => {
    const { file, stateDir } = setup();
    applyManagedJson({ file, stateDir, set: [[["a"], "ours"]] });
    const before = readFileSync(file, "utf8");
    const result = applyManagedJson({ file, stateDir, release: [[["a"], "ours"]] });
    expect(result.changes).toEqual([]);
    expect(result.written).toBe(false);
    expect(readFileSync(file, "utf8")).toBe(before);
    expect(read(join(stateDir, "owned.json"))).toEqual({});
  });

  test("release: a value the person changed since is theirs, and is never written over", () => {
    const { file, stateDir } = setup({ a: "theirs" });
    applyManagedJson({ file, stateDir, claim: [[["a"], "theirs"]] });
    // The person edits claude-mem's file by hand, after the take-over.
    writeFileSync(file, `${JSON.stringify({ a: "their-newer-value" }, null, 2)}\n`);
    const result = applyManagedJson({ file, stateDir, release: [[["a"], "theirs"]] });
    expect(result.changes).toEqual([]);
    expect(result.written).toBe(false);
    expect(read(file).a).toBe("their-newer-value");
    expect(result.skipped).toEqual([
      { path: ["a"], reason: "changed since cc-smart-dev-kit managed it; left alone" },
    ]);
    // The claim goes with it: nothing of ours is left to take out of that key.
    expect(read(join(stateDir, "owned.json"))).toEqual({});
  });

  test("release with no value: a taken secret's key stays as the person set it", () => {
    const { file, stateDir } = setup({ key: "sk-planted-0001" });
    const secret = (path: KeyPath) => path.at(-1) === "key";
    applyManagedJson({ file, stateDir, claim: [[["key"], "sk-planted-0001"]], secret });
    const before = readFileSync(file, "utf8");
    const result = applyManagedJson({ file, stateDir, release: [[["key"], undefined]], secret });
    // The key's value is never kept, so there is nothing to write: the claim goes and the key
    // stays exactly as it was, the person's own again.
    expect(result.changes).toEqual([]);
    expect(result.written).toBe(false);
    expect(readFileSync(file, "utf8")).toBe(before);
    expect(read(file).key).toBe("sk-planted-0001");
    expect(result.skipped).toEqual([
      {
        path: ["key"],
        reason: "a taken-over key's value is never kept; its claim is dropped and the key stays",
      },
    ]);
    expect(read(join(stateDir, "owned.json"))).toEqual({});
  });

  test("release with no value: a key the kit replaced since stays too, and its claim goes", () => {
    const { file, stateDir } = setup({ key: "sk-planted-0001" });
    const secret = (path: KeyPath) => path.at(-1) === "key";
    applyManagedJson({ file, stateDir, claim: [[["key"], "sk-planted-0001"]], secret });
    // The person picks another key through the kit: the kit writes it.
    applyManagedJson({ file, stateDir, set: [[["key"], "sk-planted-0002"]], secret });
    const result = applyManagedJson({ file, stateDir, release: [[["key"], undefined]], secret });
    // The earlier key is in the backup the kit made before that write; the current key stays,
    // because nothing of the person's is left in the file to put back over it.
    expect(result.changes).toEqual([]);
    expect(read(file).key).toBe("sk-planted-0002");
    expect(read(join(stateDir, "owned.json"))).toEqual({});
    const backups = listBackups(stateDir, file);
    expect(backups).toHaveLength(1);
    const backup = backups[0];
    if (backup === undefined) throw new Error("expected one backup");
    expect(readFileSync(backup.path, "utf8")).toContain("sk-planted-0001");
  });

  test("release with no value: a taken secret removed since has nothing to give back", () => {
    const { file, stateDir } = setup({ key: "sk-planted-0001" });
    const secret = (path: KeyPath) => path.at(-1) === "key";
    applyManagedJson({ file, stateDir, claim: [[["key"], "sk-planted-0001"]], secret });
    // The person removes the key by hand, after the take-over.
    writeFileSync(file, `${JSON.stringify({}, null, 2)}\n`);
    const result = applyManagedJson({ file, stateDir, release: [[["key"], undefined]], secret });
    expect(result.changes).toEqual([]);
    expect(result.skipped).toEqual([
      { path: ["key"], reason: "changed since cc-smart-dev-kit managed it; left alone" },
    ]);
    // The claim goes: nothing of ours is left in a key that is not there.
    expect(read(join(stateDir, "owned.json"))).toEqual({});
  });

  test("the record written before a file write carries was, taken and the hash it took", () => {
    const { file, stateDir } = setup({ a: "theirs", key: "sk-planted-0001" });
    const secret = (path: KeyPath) => path.at(-1) === "key";
    applyManagedJson({
      file,
      stateDir,
      claim: [
        [["a"], "theirs"],
        [["key"], "sk-planted-0001"],
      ],
      secret,
    });
    const hash = createHash("sha256").update(JSON.stringify("sk-planted-0001")).digest("hex");
    let pending: unknown = null;
    // `onBeforeWrite` runs after the claim's own write and before the file's: a crash there
    // leaves this record, so it must still say the keys were taken over.
    applyManagedJson({
      file,
      stateDir,
      secret,
      set: [
        [["a"], "ours"],
        [["key"], "sk-planted-0002"],
      ],
      onBeforeWrite: () => {
        pending = read(join(stateDir, "owned.json"));
      },
    });
    const records = (pending as Record<string, OwnedRecord[]>)[file] ?? [];
    expect(records.find((record) => record.path[0] === "a")).toEqual({
      path: ["a"],
      taken: true,
      was: "theirs",
    });
    expect(records.find((record) => record.path[0] === "key")).toEqual({
      path: ["key"],
      taken: true,
      wasSha256: hash,
    });
  });

  test("removal: a taken-over value is put back, never removed", () => {
    const { file, stateDir } = setup({ a: "theirs" });
    applyManagedJson({ file, stateDir, claim: [[["a"], "theirs"]] });
    applyManagedJson({ file, stateDir, set: [[["a"], "ours"]] });
    const result = applyManagedJson({ file, stateDir, remove: [["a"]] });
    // cc-smart-dev-kit never wrote "theirs": removing the key would take the person's value away.
    expect(read(file).a).toBe("theirs");
    expect(result.changes).toEqual([{ path: ["a"], before: "ours", after: "theirs" }]);
    expect(read(join(stateDir, "owned.json"))).toEqual({});
  });

  test("removal: a taken-over secret is left as it is, and its claim goes", () => {
    const { file, stateDir } = setup({ key: "sk-planted-0001" });
    const secret = (path: KeyPath) => path.at(-1) === "key";
    applyManagedJson({ file, stateDir, claim: [[["key"], "sk-planted-0001"]], secret });
    const result = applyManagedJson({ file, stateDir, remove: [["key"]], secret });
    expect(result.changes).toEqual([]);
    expect(read(file).key).toBe("sk-planted-0001");
    expect(result.skipped).toEqual([
      {
        path: ["key"],
        reason: "a taken-over key's value is never kept; its claim is dropped and the key stays",
      },
    ]);
    expect(read(join(stateDir, "owned.json"))).toEqual({});
  });
});
