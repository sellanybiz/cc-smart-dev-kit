import { expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cliPaths } from "../cli/paths";
import { tempDir } from "../testing/temp";
import { applyManagedHook } from "./managed-hook";
import { applyManagedLine } from "./managed-line";
import { retireNotifications, USER_NOTIFY_ENTRY } from "./user-notify-hook";
import { listBackups, readChanged } from "./write";

function fixture() {
  const home = tempDir("retire");
  const paths = cliPaths({ HOME: home, CLAUDE_CONFIG_DIR: join(home, ".claude") });
  mkdirSync(paths.claudeConfigDir, { recursive: true });
  writeFileSync(paths.settingsFile, JSON.stringify({ keep: true }));
  return paths;
}
const read = (file: string) => JSON.parse(readFileSync(file, "utf8"));

test("owned exact hook is backed up and removed; unrelated ownership and hooks survive; dry-run and repeat are safe", () => {
  const p = fixture();
  applyManagedHook({
    file: p.settingsFile,
    stateDir: p.stateDir,
    event: "Notification",
    entry: USER_NOTIFY_ENTRY,
  });
  const other = { hooks: [{ type: "command", command: "other" }] };
  applyManagedHook({ file: p.settingsFile, stateDir: p.stateDir, event: "Stop", entry: other });
  const before = readFileSync(p.settingsFile, "utf8");
  const backups = listBackups(p.stateDir, p.settingsFile).length;
  expect(retireNotifications(p, true).changes).toHaveLength(1);
  expect(readFileSync(p.settingsFile, "utf8")).toBe(before);
  expect(listBackups(p.stateDir, p.settingsFile)).toHaveLength(backups);
  expect(retireNotifications(p, false).changes).toHaveLength(1);
  expect(read(p.settingsFile)).toEqual({ keep: true, hooks: { Stop: [other] } });
  expect(read(join(p.stateDir, "owned-hooks.json"))[p.settingsFile].Stop.entry).toEqual(other);
  expect(listBackups(p.stateDir, p.settingsFile)).toHaveLength(backups + 1);
  expect(retireNotifications(p, false).changes).toEqual([]);
});

test("unowned, edited and mixed hooks remain with manual guidance", () => {
  for (const owned of [true, false]) {
    const p = fixture();
    if (owned)
      applyManagedHook({
        file: p.settingsFile,
        stateDir: p.stateDir,
        event: "Notification",
        entry: USER_NOTIFY_ENTRY,
      });
    const edited = structuredClone(USER_NOTIFY_ENTRY);
    edited.hooks.push({ type: "command", command: "my-logger" });
    writeFileSync(p.settingsFile, JSON.stringify({ hooks: { Notification: [edited] } }));
    const before = readFileSync(p.settingsFile, "utf8");
    const result = retireNotifications(p, false);
    expect(result.changes).toEqual([]);
    expect(result.info.join(" ")).toContain("by hand");
    expect(readFileSync(p.settingsFile, "utf8")).toBe(before);
  }
});

test("an exact but unowned hook stays and is named for manual cleanup", () => {
  const p = fixture();
  writeFileSync(p.settingsFile, JSON.stringify({ hooks: { Notification: [USER_NOTIFY_ENTRY] } }));
  const before = readFileSync(p.settingsFile, "utf8");
  const result = retireNotifications(p, false);
  expect(result.changes).toEqual([]);
  expect(result.info.join(" ")).toContain("unowned notification hook stays");
  expect(readFileSync(p.settingsFile, "utf8")).toBe(before);
  expect(existsSync(p.stateDir)).toBe(false);
});

test("an edited owned tmux line stays without a backup or a live-server command", () => {
  const p = fixture();
  applyManagedLine({
    file: p.tmuxConfFile,
    stateDir: p.stateDir,
    line: "set -g allow-passthrough all",
  });
  writeFileSync(p.tmuxConfFile, "set -g allow-passthrough on\nset -g mouse on\n");
  const backups = listBackups(p.stateDir, p.tmuxConfFile).length;
  expect(retireNotifications(p, false).changes).toEqual([]);
  expect(readFileSync(p.tmuxConfFile, "utf8")).toBe(
    "set -g allow-passthrough on\nset -g mouse on\n",
  );
  expect(listBackups(p.stateDir, p.tmuxConfFile)).toHaveLength(backups);
});

test("retirement releases its tmux claim so a later personal copy survives", () => {
  const line = "set -g allow-passthrough all";
  for (const current of [line, "set -g allow-passthrough on", ""]) {
    const p = fixture();
    applyManagedLine({ file: p.tmuxConfFile, stateDir: p.stateDir, line });
    writeFileSync(p.tmuxConfFile, `${current}\n`);
    const claim = readChanged(p.stateDir);
    retireNotifications(p, true);
    expect(readChanged(p.stateDir)).toEqual(claim);
    const result = retireNotifications(p, false);
    if (current !== line) expect(result.info.join(" ")).toContain("check it by hand");
    expect(readChanged(p.stateDir)[p.tmuxConfFile]).toBeUndefined();
    writeFileSync(p.tmuxConfFile, `${line}\n`);
    expect(retireNotifications(p, false).changes).toEqual([]);
    expect(readFileSync(p.tmuxConfFile, "utf8")).toBe(`${line}\n`);
  }
});

test("corrupt ownership preserves settings and reports the problem", () => {
  const p = fixture();
  mkdirSync(p.stateDir, { recursive: true });
  writeFileSync(join(p.stateDir, "owned-hooks.json"), "bad json");
  const before = readFileSync(p.settingsFile, "utf8");
  expect(retireNotifications(p, false).info.join(" ")).toContain("left unchanged");
  expect(readFileSync(p.settingsFile, "utf8")).toBe(before);
});

test("tmux only loses an exact recorded line, never a personal line or edit", () => {
  const line = "set -g allow-passthrough all";
  for (const owned of [true, false]) {
    const p = fixture();
    writeFileSync(p.tmuxConfFile, "set -g mouse on\n");
    if (owned) applyManagedLine({ file: p.tmuxConfFile, stateDir: p.stateDir, line });
    else writeFileSync(p.tmuxConfFile, `set -g mouse on\n${line}\n`);
    retireNotifications(p, true);
    expect(readFileSync(p.tmuxConfFile, "utf8")).toContain(line);
    retireNotifications(p, false);
    expect(readFileSync(p.tmuxConfFile, "utf8")).toBe(
      owned ? "set -g mouse on\n" : `set -g mouse on\n${line}\n`,
    );
    expect(retireNotifications(p, false).changes).toEqual([]);
  }
  const p = fixture();
  expect(retireNotifications(p, true).changes).toEqual([]);
  expect(existsSync(p.stateDir)).toBe(false);
});
