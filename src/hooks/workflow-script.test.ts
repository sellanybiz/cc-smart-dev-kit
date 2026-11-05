/**
 * The Workflow script reader (`workflow-script.ts`): what the parser finds — each `agent(…)` and
 * `workflow(…)` call, each other use of either, and what a call's options show — and what it
 * refuses. The guard's verdicts on these are in `agent-guard.test.ts`.
 */
import { afterEach, describe, expect, it } from "bun:test";
import { loadScriptParser } from "./script-parser";
import { parseScript, useScriptParser } from "./workflow-script";

loadScriptParser();
// A test below takes the parser away; every test after it gets it back.
afterEach(loadScriptParser);

/** What the reader found, or a failure the test reports. */
function parsed(script: string) {
  const read = parseScript(script);
  if (!read.ok) throw new Error(`expected a parse: ${read.why}`);
  return read;
}

describe("the calls and uses it finds", () => {
  it("every direct agent(…) call, in script order, with its line: nested, in a helper, in a placeholder", () => {
    const script = [
      'await agent("one", { model: "haiku", effort: "high" });',
      "async function helper(file) {",
      '  return agent("two " + file, { model: "sonnet", effort: "high" });',
      "}",
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the fixture calls `agent` inside a template.
      'const done = `${await agent(await agent("four"), {})}`;',
    ].join("\n");
    const read = parsed(script);
    expect(read.agents.map((one) => [one.line, one.prompt])).toEqual([
      [1, "one"],
      [3, null],
      [5, null],
      [5, "four"],
    ]);
    expect(read.handed).toEqual([]);
    expect(read.workflows).toEqual([]);
  });

  it("a name that is not a use of the function is not one: a property, a key, a member, a label, text", () => {
    const script = [
      "x.agent(1); x?.workflow; o = { agent: 1, workflow() {} };",
      "class C { agent() {} static workflow = 2; }",
      "agent: for (;;) { break agent; }",
      '// agent("in a comment")',
      'const s = "agent(x)"; const t = `workflow(y)`; const r = /agent\\(/;',
      "const agentType = 1, agents = 2;",
    ].join("\n");
    expect(parsed(script)).toEqual({
      agents: [],
      handed: [],
      ok: true,
      routes: [],
      workflows: [],
    });
  });

  it("every route around the names, with its line: the names that reach a global or build code, top-level `this`, import(), .constructor", () => {
    const script = [
      'eval("x");',
      'Function("return 1");',
      "function f() { return arguments; }",
      "globalThis.x;",
      "global.x;",
      "self.x;",
      "this.x;",
      'import("./x.js");',
      "f.constructor;",
      'f["constructor"];',
      "const { constructor: make } = f;",
      "const g = () => this;",
      "class C { [this.k] = 1; }",
    ].join("\n");
    expect(parsed(script).routes).toEqual([
      { line: 1, what: "`eval`" },
      { line: 2, what: "`Function`" },
      { line: 3, what: "`arguments`" },
      { line: 4, what: "`globalThis`" },
      { line: 5, what: "`global` (even as a name of your own: rename it)" },
      { line: 6, what: "`self` (even as a name of your own: rename it)" },
      {
        line: 7,
        what: "`this` outside a non-arrow function (an arrow uses the script's own `this`)",
      },
      { line: 8, what: "`import(…)`" },
      { line: 9, what: "a `constructor` member" },
      { line: 10, what: "a `constructor` member" },
      { line: 11, what: "a `constructor` member" },
      {
        line: 12,
        what: "`this` outside a non-arrow function (an arrow uses the script's own `this`)",
      },
      {
        line: 13,
        what: "`this` outside a non-arrow function (an arrow uses the script's own `this`)",
      },
    ]);
  });

  it("what is not a route: `this` in a function, a method or a class field, those names as keys or members, a computed key", () => {
    const script = [
      "function f() { return this; }",
      "const o = { m() { return this.v; }, eval: 1, self: 2, constructor: 3 };",
      "class C { constructor() { this.a = 1; } b = this.a; static { this.c = 2; } }",
      "o.self; o.global; o.globalThis; o.eval;",
      "const k = 'v'; o[k];",
      "here: { break here; }",
    ].join("\n");
    expect(parsed(script).routes).toEqual([]);
  });

  it("every other use is handed around, each with its line", () => {
    const uses = [
      "const run = agent;",
      'agent?.("x", {});',
      "o = { agent };",
      'agent.call(null, "x", {});',
      "new agent();",
      "agent`x`;",
      "function agent() {}",
      '(0, agent)("x", {});',
      "const f = (workflow) => 1;",
      "const { agent: mine } = o, { workflow } = o;",
    ];
    const read = parsed(uses.join("\n"));
    expect(read.handed).toEqual([
      { line: 1, name: "agent" },
      { line: 2, name: "agent" },
      { line: 3, name: "agent" },
      { line: 4, name: "agent" },
      { line: 5, name: "agent" },
      { line: 6, name: "agent" },
      { line: 7, name: "agent" },
      { line: 8, name: "agent" },
      { line: 9, name: "workflow" },
      { line: 10, name: "workflow" },
    ]);
    expect(read.agents).toEqual([]);
  });

  it("a nested workflow(…) call: a fixed name, a plain object's fixed scriptPath, or neither", () => {
    const script = [
      'workflow("probe");',
      "workflow(`plain`);",
      'workflow({ scriptPath: "./x.js" });',
      "workflow(name);",
      'workflow({ scriptPath: "./x.js", ...more });',
      'workflow({ get scriptPath() { return "./y.js"; } });',
      'workflow({ ["scriptPath"]: "./z.js" });',
    ].join("\n");
    expect(parsed(script).workflows).toEqual([
      { line: 1, name: "probe", scriptPath: null },
      { line: 2, name: "plain", scriptPath: null },
      { line: 3, name: null, scriptPath: "./x.js" },
      { line: 4, name: null, scriptPath: null },
      { line: 5, name: null, scriptPath: null },
      { line: 6, name: null, scriptPath: null },
      { line: 7, name: null, scriptPath: null },
    ]);
  });
});

describe("what a call's options show", () => {
  /** The one agent call of a script, read. */
  function call(script: string) {
    const [one] = parsed(script).agents;
    if (one === undefined) throw new Error("no call");
    return { hidden: one.hidden, keys: Object.fromEntries(one.keys), plain: one.plain };
  }

  it("one plain object: each key with its fixed string, or null for any other value", () => {
    expect(
      call(
        'agent("p", { model: "opus", "effort": `high`, agentType: kind, label: "a" + b, n: 1 });',
      ),
    ).toEqual({
      hidden: false,
      keys: { agentType: null, effort: "high", label: null, model: "opus", n: null },
      plain: true,
    });
    expect(call('agent("p", {}, );')).toEqual({ hidden: false, keys: {}, plain: true });
  });

  it("not plain: a getter, a method, a shorthand key, __proto__, a number key, a ternary, a second object, one argument", () => {
    const notPlain = [
      'agent("p", { get model() { return "opus"; } });',
      'agent("p", { model() { return "opus"; } });',
      'agent("p", { model });',
      'agent("p", { __proto__: { model: "fable" } });',
      'agent("p", { "__proto__": { model: "fable" } });',
      'agent("p", { 1: "x" });',
      'agent("p", c ? { model: "haiku" } : { model: "fable" });',
      'agent("p", { model: "haiku" }, { model: "fable" });',
      'agent("p");',
    ];
    for (const script of notPlain) {
      expect({ script, plain: call(script).plain, hidden: call(script).hidden }).toEqual({
        hidden: false,
        plain: false,
        script,
      });
    }
    // A method and a shorthand key are data keys whose value is no fixed string; a getter is not one.
    expect(call('agent("p", { model() {} });').keys).toEqual({ model: null });
    expect(call('agent("p", { model });').keys).toEqual({ model: null });
    expect(call('agent("p", { get model() {} });').keys).toEqual({});
  });

  it("hidden: a spread argument or property, a computed key, a key written twice", () => {
    for (const script of [
      "agent(...args);",
      'agent("p", ...opts);',
      'agent("p", { model: "haiku", ...more });',
      'agent("p", { [key]: "opus" });',
      'agent("p", { model: "haiku", "model": "opus" });',
    ]) {
      expect({ script, ...call(script) }).toMatchObject({ hidden: true, plain: false, script });
    }
    // A spread or a computed key in a nested object changes none of the call's own options.
    expect(call('agent("p", { model: "haiku", schema: { ...base, [k]: 1 } });')).toMatchObject({
      hidden: false,
      plain: true,
    });
  });
});

describe("how it parses, and what it refuses", () => {
  it("the first statement's `export const meta` is read; the script runs as an async function body", () => {
    const script = [
      "/* about */ export const meta = { name: 'probe', description: 'x' };",
      "const one = await agent('p', {});",
      "if (!one) return null;",
    ].join("\n");
    expect(parsed(script).agents.map((one) => one.line)).toEqual([2]);
  });

  it("a script that does not parse: the parser's message without its position, and the line", () => {
    expect(parseScript('agent("p", {});\nconst s = "open\n;')).toEqual({
      line: 2,
      ok: false,
      why: "Unterminated string constant",
    });
    expect(parseScript("const x = 1;\nexport const y = 2;")).toEqual({
      line: 2,
      ok: false,
      why: "'import' and 'export' may appear only with 'sourceType: module'",
    });
    // A hashbang starts a script file, never a function body.
    expect(parseScript("#!/usr/bin/env node\nagent('p', {});").ok).toBe(false);
    // Claude Code runs the body under 'use strict': what strict mode forbids does not parse.
    expect(parseScript("with (o) { agent('p', {}); }")).toEqual({
      line: 1,
      ok: false,
      why: "'with' in strict mode",
    });
  });

  it("an HTML-like comment is refused, with its line; `//` and `/* */` comments that hold the markers are not", () => {
    const why =
      "an HTML-like comment (`<!--`, or `-->` at a line's start), which a script reads as a comment and a module as code, so a launch could hide in it";
    expect(parseScript("x = 1;\n  --> note")).toEqual({ line: 2, ok: false, why });
    expect(parseScript("x = 1;\ny = 2 <!-- note")).toEqual({ line: 2, ok: false, why });
    expect(parsed("// <!-- -->\n/* --> */\nconst s = '<!--';").agents).toEqual([]);
  });

  it("a script nested too deep for the parser is refused, never thrown", () => {
    const deep = `${"(".repeat(100_000)}1${")".repeat(100_000)}`;
    const read = parseScript(deep);
    expect(read.ok).toBe(false);
  });

  it("a program that was never handed the parser reads no script", () => {
    useScriptParser(null);
    expect(parseScript('agent("p", {});')).toEqual({
      line: null,
      ok: false,
      why: "the guard's script parser is not loaded in this program",
    });
  });
});
