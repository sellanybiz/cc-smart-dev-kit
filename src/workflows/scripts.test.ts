/**
 * The workflow scripts the plugin ships (`plugin/workflows/*.js`) — the rules every one of them
 * follows, whatever it orchestrates. The `audit` skill starts `audit-run` and the `review` skill
 * starts `review-split`; each script's own behaviour is its own test file beside this one.
 *
 * **Claude Code runs the script as a function body**, with top-level `await` and `return`, and
 * throws on `Date.now()`, `Math.random()` and a no-argument `new Date()` (a run must replay). A
 * test here runs every script against the fakes in `script-runner.ts`: no subagent starts.
 */
import { describe, expect, test } from "bun:test";

import { readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { readScript, runScript, shippedScripts } from "./script-runner";

const ROOT = join(import.meta.dir, "..", "..");

/** Every shipped script with its text and its file name. */
const scripts = shippedScripts().map((file) => ({
  file,
  name: basename(file, ".js"),
  script: readScript(file),
}));

/**
 * The scripts that refuse to start without an argument object (a research question has no
 * default), with the smallest object each accepts. Every other script has defaults for all of it.
 */
const NEEDS_ARGS: Record<string, unknown> = {
  "research-sweep": { angles: ["the current docs"], question: "what does it do?" },
};

/** Read the checked-in declarations only, stopping before validation or any agent launch. */
function argumentContract(script: string) {
  const prefix = script.slice(0, script.indexOf("if (args"));
  return new Function(`${prefix.replace(/^export /, "")}\nreturn {
    description: meta.description, usage: USAGE,
    keys: typeof CHECKS === 'undefined' ? FIELDS : Object.keys(CHECKS)
  }`)();
}

/** Parse the whole typed object, including requiredness; reject a partial or untyped shape. */
function argumentShape(text: string) {
  const object = text.match(/\{([^}]+)\}/);
  if (!object?.[1]) throw new Error("argument object missing");
  return object[1]
    .split(",")
    .map((field) => {
      const match = field.trim().match(/^(\w+)(\?)?: (string\[\]|string|number|boolean)$/);
      if (!match?.[1] || !match[3]) throw new Error(`untyped argument: ${field}`);
      return { key: match[1], optional: match[2] === "?", type: match[3] };
    })
    .sort((a, b) => a.key.localeCompare(b.key));
}

function checkArgumentContract(script: string) {
  const contract = argumentContract(script);
  const shape = argumentShape(contract.description);
  expect(shape).toEqual(argumentShape(contract.usage));
  expect(shape.map((field) => field.key)).toEqual([...contract.keys].sort());
  return shape;
}

/** The `name` a script's `meta` statement gives: Claude Code loads `<plugin>:<meta.name>`. */
function workflowMetaName(script: string): string | null {
  return script.match(/^export const meta = \{[\s\S]*?\bname:\s*["']([^"']+)["']/m)?.[1] ?? null;
}

describe("every shipped workflow script", () => {
  test("at least one ships, and each has a meta Claude Code can read", () => {
    expect(scripts.length).toBeGreaterThan(0);
    for (const { name, script } of scripts) {
      // Claude Code loads `<plugin>:<meta.name>`, so the name is the file's name.
      expect(workflowMetaName(script)).toBe(name);
    }
  });

  test.each([
    ["audit-run", "audit"],
    ["review-split", "review"],
    ["research-sweep", "research-first"],
  ])(
    "%s advertises its contract and accepts the %s skill's actual example",
    async (name, skill) => {
      const file = join(ROOT, "plugin", "workflows", `${name}.js`);
      const script = readScript(file);
      const metaStatement = script.match(/^export const meta = (\{[\s\S]*?\n\})/);
      expect(metaStatement).not.toBeNull();
      const meta = new Function(`return (${metaStatement?.[1]})`)();
      const skillText = readFileSync(join(ROOT, "plugin", "skills", skill, "SKILL.md"), "utf8");
      const example = skillText.match(/```\n(Workflow\([\s\S]*?\))\n```/);
      expect(example).not.toBeNull();
      // Execute only the checked-in example with a fake Workflow, never an actual tool or agent.
      const input = new Function("Workflow", `return ${example?.[1]}`)((value: unknown) => value);
      expect(input.name).toBe(`cc-smart-dev-kit:${name}`);
      expect(meta.description).toContain(`args: {`);
      expect(meta.description).toContain(`/cc-smart-dev-kit:${skill}`);
      const shape = checkArgumentContract(script);
      const fields = shape.map((field) => field.key);
      for (const field of shape) {
        const without = { ...input.args };
        delete without[field.key];
        if (field.optional) {
          expect((await runScript(file, { args: without })).calls.length).toBeGreaterThan(0);
        } else {
          await expect(runScript(file, { args: without })).rejects.toThrow(field.key);
        }
      }
      // Mutate strings in memory only: the comparison must catch discovery and validator drift.
      const descriptionEnd = script.indexOf("\n}") + 2;
      for (const changed of [
        script.slice(0, descriptionEnd).replace("budget?: number", "budget?: string"),
        script.slice(0, descriptionEnd).replace("budget?: number", "budget: number"),
      ]) {
        expect(changed).not.toBe(script.slice(0, descriptionEnd));
        expect(() => checkArgumentContract(changed + script.slice(descriptionEnd))).toThrow();
      }
      const extraKey = script.includes("const CHECKS = {")
        ? script.replace("const CHECKS = {", "const CHECKS = { extra: [isText, 'a string'],")
        : script.replace("const FIELDS = [", "const FIELDS = ['extra', ");
      expect(extraKey).not.toBe(script);
      expect(() => checkArgumentContract(extraKey)).toThrow();
      expect(fields.sort()).toEqual(Object.keys(input.args).sort());
      const run = await runScript(file, { args: input.args });
      expect(run.calls.length).toBeGreaterThan(0);
      // One contract, no aliases or JSON-string coercion, even when launched directly.
      for (const args of [
        { ...input.args, area: "a guessed key" },
        JSON.stringify(input.args),
        [],
      ]) {
        await expect(runScript(file, { args })).rejects.toThrow(
          name === "research-sweep" ? "needs an object" : "refused its arguments",
        );
      }
      // The rejection still names every accepted field and its object shape.
      try {
        await runScript(file, { args: { ...input.args, area: "a guessed key" } });
        throw new Error("the unknown key was accepted");
      } catch (error) {
        expect(error).toBeInstanceOf(Error);
        if (!(error instanceof Error)) throw error;
        const message = error.message;
        expect(message).toMatch(/object:? \{/);
        for (const field of fields) expect(message).toContain(field);
      }
    },
  );

  test("every script runs with the workflow globals, and with no args at all unless it needs them", async () => {
    for (const { file, name } of scripts) {
      const needs = NEEDS_ARGS[name];
      if (needs !== undefined) {
        // Refused at the start, before any agent: the message says what the object is.
        await expect(runScript(file)).rejects.toThrow("needs an object");
      }
      const run = await runScript(file, needs === undefined ? {} : { args: needs });
      expect(run.calls.length).toBeGreaterThan(0);
      expect(run.phases.length).toBeGreaterThan(0);
    }
  });

  test("no script reads the clock or the dice: a run must replay", () => {
    for (const { file, script } of scripts) {
      // Claude Code makes these throw inside a script (a relaunch repeats every call).
      expect({ clock: /Date\.now\(|Math\.random\(|new Date\(\)/.test(script), file }).toEqual({
        clock: false,
        file,
      });
    }
  });
});
