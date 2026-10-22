/** A lead never runs with every permission check off (`bypass.ts`). */
import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../testing/temp";
import { bypassReason, commandLineMode, settingsFilesOf } from "./bypass";

/** Writes `permissions.defaultMode` (or any text) into `file`. */
function settings(file: string, text: string): void {
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, text);
}

describe("the mode a command line starts a session in", () => {
  test.each([
    ["claude --dangerously-skip-permissions", "bypassPermissions"],
    ["claude --permission-mode bypassPermissions", "bypassPermissions"],
    ["claude --permission-mode=bypassPermissions --bg", "bypassPermissions"],
    ["claude --permission-mode auto", "auto"],
    ["claude --allow-dangerously-skip-permissions", null],
    ["claude --resume abc", null],
  ])("%j → %j", (line, mode) => {
    expect(commandLineMode(line)).toBe(mode);
  });
});

describe("why the caller runs in bypass mode", () => {
  test("the command line wins over every settings file", () => {
    const root = tempDir("repo");
    const user = join(tempDir("home"), "settings.json");
    settings(user, '{"permissions":{"defaultMode":"bypassPermissions"}}');
    const files = settingsFilesOf(root, user);
    expect(bypassReason("claude --permission-mode auto", files)).toBeNull();
    expect(bypassReason("claude --dangerously-skip-permissions", files)).toBe(
      "this session was started in bypassPermissions mode",
    );
  });

  test("with no mode on the command line, the most specific settings file that sets one", () => {
    const root = tempDir("repo");
    const user = join(tempDir("home"), "settings.json");
    settings(user, '{"permissions":{"defaultMode":"bypassPermissions"}}');
    const files = settingsFilesOf(root, user);
    expect(bypassReason("claude", files)).toBe(
      `${user} sets permissions.defaultMode to bypassPermissions`,
    );
    // The project's own file says auto: it wins over the person's.
    settings(join(root, ".claude", "settings.json"), '{"permissions":{"defaultMode":"auto"}}');
    expect(bypassReason(null, files)).toBeNull();
    // The local file says bypass: it wins over the project's.
    const local = join(root, ".claude", "settings.local.json");
    settings(local, '{"permissions":{"defaultMode":"bypassPermissions"}}');
    expect(bypassReason(null, files)).toBe(
      `${local} sets permissions.defaultMode to bypassPermissions`,
    );
  });

  test("a file that does not read, or sets no mode, says nothing", () => {
    const root = tempDir("repo");
    const user = join(tempDir("home"), "settings.json");
    settings(join(root, ".claude", "settings.local.json"), "{ not json");
    settings(join(root, ".claude", "settings.json"), '{"permissions":{"allow":[]}}');
    expect(bypassReason(null, settingsFilesOf(root, user))).toBeNull();
  });
});
