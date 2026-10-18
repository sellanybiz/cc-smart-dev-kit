/**
 * One hook entry cc-smart-dev-kit owns inside a settings file's `hooks.<event>` list
 * (`managed-hook.ts`): the shared list, the record in `owned-hooks.json` (never in
 * changed.json), the person's edited copy, restore, and the race with another writer.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../testing/temp";
import {
  applyManagedHook,
  isHookEntry,
  removeAllManagedHooks,
  removeManagedHooks,
  runsPluginNotify,
} from "./managed-hook";
import { ForeignKeyError } from "./managed-json";
import { restore } from "./restore";
import { isEditedNotify } from "./user-notify-hook";
import { ConcurrentChangeError, listBackups, readChanged } from "./write";

const ENTRY = {
  matcher: "agent_needs_input|agent_completed",
  hooks: [
    {
      type: "command",
      command: '"$HOME/.local/bin/cc-smart-dev-kit" hook notify',
      timeout: 10,
    },
  ],
};

/** A settings.json as the person leaves it; `null`: no file at all. */
function setup(content: unknown = {}) {
  const dir = tempDir("hook");
  const file = join(dir, "settings.json");
  const stateDir = join(dir, "state");
  mkdirSync(stateDir);
  if (content !== null) writeFileSync(file, `${JSON.stringify(content, null, 2)}\n`);
  return { dir, file, stateDir };
}

const read = (file: string) => JSON.parse(readFileSync(file, "utf8"));

describe("applyManagedHook", () => {
  test("adds the entry at the end, keeps the person's own, and records it outside changed.json", () => {
    const own = {
      matcher: "permission_prompt",
      hooks: [{ type: "command", command: "./mine.sh" }],
    };
    const { file, stateDir } = setup({ hooks: { Notification: [own] } });
    const result = applyManagedHook({
      file,
      stateDir,
      event: "Notification",
      entry: ENTRY,
    });
    expect(result).toMatchObject({ action: "added", written: true });
    expect(read(file)).toEqual({ hooks: { Notification: [own, ENTRY] } });
    expect(read(join(stateDir, "owned-hooks.json"))).toEqual({
      [file]: {
        Notification: { created: { event: false, hooks: false }, entry: ENTRY },
      },
    });
    // Not a changed.json kind: an older running cc-smart-dev-kit must never meet one it refuses.
    expect(readChanged(stateDir)).toEqual({});
    expect(listBackups(stateDir, file)).toHaveLength(1);
  });

  test("a second run changes nothing", () => {
    const { file, stateDir } = setup();
    applyManagedHook({ file, stateDir, event: "Notification", entry: ENTRY });
    const result = applyManagedHook({ file, stateDir, event: "Notification", entry: ENTRY });
    expect(result).toMatchObject({ action: "unchanged", written: false, backup: null });
    expect(listBackups(stateDir, file)).toHaveLength(1);
  });

  test("the wanted entry changed since setup wrote it: updated in place, never a second", () => {
    const { file, stateDir } = setup();
    applyManagedHook({ file, stateDir, event: "Notification", entry: ENTRY });
    const next = {
      matcher: ENTRY.matcher,
      hooks: [{ type: "command", command: "./next.sh", timeout: 10 }],
    };
    const result = applyManagedHook({ file, stateDir, event: "Notification", entry: next });
    expect(result.action).toBe("updated");
    expect(read(file).hooks.Notification).toEqual([next]);
  });

  test("an identical entry put there by someone else stays unowned: no write, nothing claimed", () => {
    const { file, stateDir } = setup({ hooks: { Notification: [ENTRY] } });
    const result = applyManagedHook({
      file,
      stateDir,
      event: "Notification",
      entry: ENTRY,
    });
    expect(result).toMatchObject({ action: "unchanged", written: false });
    expect(existsSync(join(stateDir, "owned-hooks.json"))).toBe(false);
    // Restore leaves it: it was never cc-smart-dev-kit's.
    removeManagedHooks(stateDir, file);
    expect(read(file).hooks.Notification).toEqual([ENTRY]);
  });

  test("a stale record for an entry that is gone: dropped, with no write to the file", () => {
    const { file, stateDir } = setup({ hooks: { Notification: [ENTRY] } });
    writeFileSync(
      join(stateDir, "owned-hooks.json"),
      JSON.stringify({
        [file]: {
          Notification: {
            created: { event: false, hooks: false },
            entry: { matcher: ENTRY.matcher, hooks: [{ type: "command", command: "./old.sh" }] },
          },
        },
      }),
    );
    const result = applyManagedHook({
      file,
      stateDir,
      event: "Notification",
      entry: ENTRY,
    });
    expect(result).toMatchObject({ action: "unchanged", written: false, backup: null });
    expect(read(file).hooks.Notification).toEqual([ENTRY]);
    expect(read(join(stateDir, "owned-hooks.json"))).toEqual({});
  });

  test("a person's edited copy is left, claimed by nobody, and no second entry is added", () => {
    const edited = {
      matcher: ENTRY.matcher,
      hooks: [
        {
          type: "command",
          command: '"$HOME/.local/bin/cc-smart-dev-kit" hook notify 2>>log',
          timeout: 30,
        },
      ],
    };
    const { file, stateDir } = setup({ hooks: { Notification: [edited] } });
    const result = applyManagedHook({
      file,
      stateDir,
      event: "Notification",
      entry: ENTRY,
      ownEdited: isEditedNotify,
    });
    expect(result).toMatchObject({ action: "left", written: false });
    expect(read(file).hooks.Notification).toEqual([edited]);
    expect(existsSync(join(stateDir, "owned-hooks.json"))).toBe(false);
  });

  test("`hooks` that is not an object, or Notification that is not a list: refused, nothing written", () => {
    for (const content of [{ hooks: [] }, { hooks: { Notification: {} } }]) {
      const { file, stateDir } = setup(content);
      const before = readFileSync(file, "utf8");
      expect(() =>
        applyManagedHook({ file, stateDir, event: "Notification", entry: ENTRY }),
      ).toThrow(ForeignKeyError);
      expect(readFileSync(file, "utf8")).toBe(before);
    }
  });

  test("an invalid owned-hooks.json is refused", () => {
    const { file, stateDir } = setup();
    writeFileSync(join(stateDir, "owned-hooks.json"), '{"x":{"Notification":{"entry":{}}}}\n');
    expect(() => applyManagedHook({ file, stateDir, event: "Notification", entry: ENTRY })).toThrow(
      "Invalid",
    );
  });

  test("another program writes between our read and our write: its change is kept and ours redone", () => {
    const { file, stateDir } = setup();
    let calls = 0;
    const result = applyManagedHook({
      file,
      stateDir,
      event: "Notification",
      entry: ENTRY,
      onBeforeWrite: () => {
        calls += 1;
        if (calls > 1) return;
        const settings = read(file);
        settings.permissions = { allow: ["Bash(ls:*)"] };
        writeFileSync(file, JSON.stringify(settings, null, 2));
      },
    });
    expect(calls).toBe(2);
    expect(result.written).toBe(true);
    expect(read(file).permissions).toEqual({ allow: ["Bash(ls:*)"] });
    expect(read(file).hooks.Notification).toEqual([ENTRY]);
  });

  test("a file that keeps changing: a clear error after 3 tries, and no claim left", () => {
    const { file, stateDir } = setup();
    let calls = 0;
    expect(() =>
      applyManagedHook({
        file,
        stateDir,
        event: "Notification",
        entry: ENTRY,
        onBeforeWrite: () => {
          calls += 1;
          writeFileSync(file, JSON.stringify({ ...read(file), [`k${calls}`]: calls }));
        },
      }),
    ).toThrow(ConcurrentChangeError);
    expect(calls).toBe(3);
    expect(read(join(stateDir, "owned-hooks.json"))).toEqual({});
  });
});

describe("removing the managed hook", () => {
  test("restore removes our entry and keeps the person's; an event list we created goes with it", () => {
    const own = {
      matcher: "permission_prompt",
      hooks: [{ type: "command", command: "./mine.sh" }],
    };
    const { file, stateDir } = setup({ hooks: { Notification: [own], Stop: [{ hooks: [] }] } });
    applyManagedHook({ file, stateDir, event: "Notification", entry: ENTRY });
    expect(removeManagedHooks(stateDir, file).removed).toEqual(["hooks.Notification"]);
    expect(read(file)).toEqual({ hooks: { Notification: [own], Stop: [{ hooks: [] }] } });
    expect(read(join(stateDir, "owned-hooks.json"))).toEqual({});
  });

  test("a file cc-smart-dev-kit made hooks-only goes back to an empty object", () => {
    const { file, stateDir } = setup({});
    applyManagedHook({ file, stateDir, event: "Notification", entry: ENTRY });
    expect(read(file)).toEqual({ hooks: { Notification: [ENTRY] } });
    removeManagedHooks(stateDir, file);
    expect(read(file)).toEqual({});
  });

  test("an entry the person edited since stays, and only the record goes", () => {
    const { file, stateDir } = setup();
    applyManagedHook({ file, stateDir, event: "Notification", entry: ENTRY });
    const settings = read(file);
    settings.hooks.Notification[0].hooks[0].timeout = 30;
    writeFileSync(file, JSON.stringify(settings, null, 2));
    const result = removeManagedHooks(stateDir, file);
    expect(result).toMatchObject({ removed: [], written: false, backup: null });
    expect(read(file).hooks.Notification[0].hooks[0].timeout).toBe(30);
    expect(read(join(stateDir, "owned-hooks.json"))).toEqual({});
  });

  test("restore prints one line for the hook, and only the files `only` names are touched", () => {
    const { file, stateDir } = setup();
    applyManagedHook({ file, stateDir, event: "Notification", entry: ENTRY });
    const other = join(tempDir("other"), "settings.json");
    expect(removeAllManagedHooks(stateDir, { only: new Set([other]) })).toEqual([]);
    expect(read(file).hooks.Notification).toEqual([ENTRY]);
    const results = restore(stateDir);
    expect(results).toEqual([
      {
        file,
        action: "cleaned",
        details: ["the hook entry in hooks.Notification"],
        savedAs: expect.any(String),
      },
    ]);
    expect(read(file)).toEqual({});
  });
});

describe("runsPluginNotify", () => {
  test("this plugin's own bundle: the placeholder, the shim, or Claude Code's cache path", () => {
    for (const command of [
      // biome-ignore lint/suspicious/noTemplateCurlyInString: Claude Code's placeholder, filled in by Claude Code.
      '"${CLAUDE_PLUGIN_ROOT}/bin/cc-smart-dev-kit-bun.sh" --missing=quiet "${CLAUDE_PLUGIN_ROOT}/dist/notify.js"',
      "/home/user/.local/bin/cc-smart-dev-kit-bun.sh /home/user/.claude/plugins/cache/cc-smart-dev-kit/cc-smart-dev-kit/0.5.2/dist/notify.js",
      "C:\\Users\\me\\.claude\\plugins\\cache\\cc-smart-dev-kit\\cc-smart-dev-kit\\0.5.2\\dist\\notify.js",
    ]) {
      expect(`${runsPluginNotify(command)}`).toBe("true");
    }
  });

  test("another program's notify bundle is the person's, never replaced", () => {
    for (const command of [
      "node /home/user/my-notifier/dist/notify.js",
      "/opt/tools/dist/notify.js",
      '"$HOME/.local/bin/cc-smart-dev-kit" hook notify',
      "node /home/user/my-notifier/dist/other.js",
      "echo dist/notify.js",
    ]) {
      expect(`${command}: ${runsPluginNotify(command)}`).toBe(`${command}: false`);
    }
  });

  test("isHookEntry reads Claude Code's shape", () => {
    expect(isHookEntry(ENTRY)).toBe(true);
    expect(isHookEntry({ matcher: 7, hooks: [] })).toBe(false);
    expect(isHookEntry({ hooks: [{ type: "command" }] })).toBe(false);
  });
});
