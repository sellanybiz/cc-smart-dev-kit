/**
 * `plugin/monitors/monitors.json`: the plugin's own monitors — the lead's watch and the
 * worker's self-watch.
 *
 * **Claude Code does not read this file when it validates a plugin** (its validator checks
 * `experimental.monitors` in the manifest, not the default path), so this test is what keeps the
 * file honest: the shape Claude Code's loader requires, and the names the kit's skills carry.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { LEAD_SKILL, WORKER_SKILL } from "./skills";

/** The plugin's skills folder. */
const SKILLS = join(import.meta.dir, "..", "..", "plugin", "skills");

/** The plugin's monitors file. */
const MONITORS = join(import.meta.dir, "..", "..", "plugin", "monitors", "monitors.json");

/** One monitor, as Claude Code's loader reads it: exactly four keys. */
interface Monitor {
  command: string;
  description: string;
  name: string;
  when: string;
}

const KEYS = ["command", "description", "name", "when"];

/** The monitors of the plugin, read from the file. */
function monitors(): Monitor[] {
  return JSON.parse(readFileSync(MONITORS, "utf8")) as Monitor[];
}

describe("the plugin's monitors", () => {
  test("the file holds an array of monitors, and every one has the four fields", () => {
    const all = monitors();
    expect(Array.isArray(all)).toBe(true);
    expect(all.length).toBeGreaterThan(0);
    for (const one of all) {
      expect(Object.keys(one).sort()).toEqual(KEYS);
      expect(one.name.length).toBeGreaterThan(0);
      expect(one.command.length).toBeGreaterThan(0);
      expect(one.description.length).toBeGreaterThan(0);
    }
  });

  test("the names are unique within the plugin", () => {
    const names = monitors().map((one) => one.name);
    expect(new Set(names).size).toBe(names.length);
  });

  test("each one arms on a skill, and the skill is one of the kit's own", () => {
    for (const one of monitors()) {
      expect(one.when).toStartWith("on-skill-invoke:");
      expect(one.when.length).toBeGreaterThan("on-skill-invoke:".length + 16);
      const skill = one.when.slice("on-skill-invoke:".length);
      expect([LEAD_SKILL, WORKER_SKILL]).toContain(skill);
    }
  });

  test("the lead's monitor runs the watch, and the worker's runs the self-watch", () => {
    const all = monitors();
    const events = all.find((one) => one.when === `on-skill-invoke:${LEAD_SKILL}`);
    const self = all.find((one) => one.when === `on-skill-invoke:${WORKER_SKILL}`);
    expect(events?.name).toBe("worker-events");
    expect(events?.command).toContain("worker watch");
    expect(self?.name).toBe("worker-self");
    expect(self?.command).toContain("worker self-watch");
  });

  test("the two skills the monitors arm on exist in the plugin", () => {
    for (const skill of [LEAD_SKILL, WORKER_SKILL]) {
      const folder = skill.slice(skill.indexOf(":") + 1);
      expect(existsSync(join(SKILLS, folder, "SKILL.md"))).toBe(true);
    }
  });

  test("every command runs the kit's own command, and never a bare path", () => {
    for (const one of monitors()) {
      expect(one.command).toContain("cc-smart-dev-kit");
      expect(one.command).toContain("$HOME/.local/bin/");
    }
  });
});
