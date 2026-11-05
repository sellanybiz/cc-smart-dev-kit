/**
 * The one reader of a Workflow script (`agent-guard.ts`): it parses the script with acorn, a
 * JavaScript parser, the way Claude Code runs it, and finds every `agent(…)` and `workflow(…)`
 * call and what each one names. The guard judges what this reader finds, and refuses what it
 * cannot read.
 *
 * **How Claude Code runs a script** (2.1.318, read from its binary; `docs/claude-code-contract.md`):
 * the body, without its `meta` statement, inside `(async () => {'use strict'; … })()`, parsed by
 * acorn in script mode and run in a `vm` context whose globals are `agent`, `workflow`,
 * `parallel`, `pipeline`, `args`, `log`, `phase`, `budget`, `console` and the timers, created
 * with `codeGeneration: { strings: false }`. So the reader parses it the same way (`PARSE_OPTIONS`):
 * script mode, strict, the latest syntax, `await` and `return` at the top. A parser leaves
 * nothing to guess: a `/` is a division or a regular expression by the grammar, and a line
 * comment ends at every line terminator (`\r`, U+2028, U+2029 too). The `meta` statement is
 * found the way Claude Code finds it (`metaExportAt`): its `export` is left out, the rest parsed.
 *
 * **What does not parse is refused whole** (`ok: false`), with the parser's message and line:
 * a launch could hide in it. That includes the few things a function body allows and a script's
 * top level does not (`new.target`): a refusal, never a guess. **An HTML-like comment is refused
 * too** (`<!--`, or `-->` at a line's start): a script reads it as a comment, a module as code
 * (`a <!--b, agent(…)` is `a < !--b, agent(…)` there), so the one text two readings disagree on
 * is never judged on either.
 *
 * **A route around the names is refused** (`routes`). `agent` is a global of the script's
 * context, so `globalThis.agent`, `this.agent` at the top, or `const { agent: a } = globalThis`
 * reaches it under another name, and code built at run time (`eval`, `Function`, a function's
 * `.constructor`) or `import()` can reach it with no name at all. Each of `eval`, `Function`,
 * `arguments`, `globalThis`, `global`, `self`, a `this` outside a non-arrow function, `import(…)`
 * and a member named `constructor` refuses the whole script; `self` and `global` even as a name
 * the script declares itself (no scope is tracked: fail closed). Not closed here: a string key,
 * literal or built at run time (`x[k]`, `Reflect.get(() => {}, "constructor")`), still reaches
 * the `Function` constructor; ordinary code is full of computed keys, so they are not refused.
 * What stops that code from running a string as code is Claude Code's `codeGeneration:
 * { strings: false }` on the context, not this reader.
 *
 * **Where acorn comes from.** Every hook bundle carries the agent guard's code (the hook table in
 * `specs.ts` holds every hook), and acorn would come with it. So this file imports acorn's types
 * only, and the agent guard's own bundle hands the parser in (`useScriptParser`, from
 * `script-parser.ts`). A program that never handed it in reads no script: every one is refused.
 */
import type { CallExpression, Identifier, Node, ObjectExpression, Options, parse } from "acorn";
import { metaExportAt } from "./agent-guard-workflows";

/** The script functions the guard follows: `agent` launches one agent, `workflow` nests one. */
export type ScriptFunction = "agent" | "workflow";

const SCRIPT_FUNCTIONS: readonly string[] = ["agent", "workflow"] satisfies ScriptFunction[];

/** acorn's `parse`, as the agent guard's bundle hands it in. */
export type ScriptParser = typeof parse;

/** The parser this program was handed (`useScriptParser`); null until then. */
let scriptParser: null | ScriptParser = null;

/** The last script read and what was found in it: the guard reads one script several times. */
let lastRead: null | { script: string; read: ReadScript } = null;

/**
 * Hands the reader its parser. Only the agent guard's entry (`loadScriptParser`) and the tests
 * call it; a test passes null to prove that a program with no parser refuses every script.
 */
export function useScriptParser(parser: null | ScriptParser): void {
  scriptParser = parser;
  lastRead = null;
}

/**
 * How Claude Code runs a script: an async function's body, in script mode, under
 * `'use strict'`. A hashbang is a syntax error in a function body, so it is one here too.
 */
const PARSE_OPTIONS: Options = {
  allowAwaitOutsideFunction: true,
  allowHashBang: false,
  allowReturnOutsideFunction: true,
  ecmaVersion: "latest",
  locations: true,
  sourceType: "script",
  strict: true,
};

/**
 * The names that reach `agent` (or any global) without naming it, or build code at run time:
 * each refuses the whole script wherever it is used.
 */
const ROUTE_NAMES: readonly string[] = [
  "eval",
  "Function",
  "arguments",
  "globalThis",
  "global",
  "self",
];

/**
 * The route names a script may well declare for itself (`const self = this`). With no scope
 * tracked they are refused all the same (fail closed), and the message says to rename them.
 */
const COMMON_ROUTE_NAMES: readonly string[] = ["global", "self"];

/** What a message calls a `this` that is the script's own, not a function's. */
const SCRIPT_THIS = "`this` outside a non-arrow function (an arrow uses the script's own `this`)";

/** The member that leads from any function to the `Function` constructor. */
const CONSTRUCTOR = "constructor";

/** A route around the names a script may use (`ROUTE_NAMES`, `this`, `import()`, `.constructor`). */
export interface ScriptRoute {
  line: number;
  /** What it is, as a message names it: `` `eval` ``, `SCRIPT_THIS`, … */
  what: string;
}

/** The two markers of an HTML-like comment, as the parser reports where a comment starts. */
const HTML_COMMENT_MARKERS = ["<!--", "-->"];

/** Said when a script holds an HTML-like comment. */
const HTML_COMMENT =
  "an HTML-like comment (`<!--`, or `-->` at a line's start), which a script reads as a comment and a module as code, so a launch could hide in it";

/** The key that sets an object's prototype: `{ __proto__: { model: "opus" } }` hands down `model`. */
const PROTOTYPE_KEY = "__proto__";

/** One `agent(…)` call, as its code shows it. */
export interface AgentCallRead {
  /**
   * True when the options are not what they seem: a `...spread` argument, or in the options
   * object a `...spread`, a computed `[…]` key, or one key written twice (JavaScript keeps the
   * last). Any of them can change `model` or `effort` after the literal the guard would read.
   */
  hidden: boolean;
  /**
   * Each data key of the options object (a `key: value` pair, a method or a shorthand key; never
   * a getter or a setter), with its value when that is a fixed string, else null. Empty when the
   * options are not an object literal.
   */
  keys: ReadonlyMap<string, null | string>;
  /** The line the call starts on, counting from 1. */
  line: number;
  /**
   * True when the options are exactly one plain object literal, the second and last argument,
   * of `key: value` pairs only (no getter, method, shorthand key, `__proto__`, computed key or
   * spread). Anything else can hand the run a `model`, an `effort` or an `agentType` the guard
   * does not read.
   */
  plain: boolean;
  /** The prompt, when the first argument is a fixed string; null otherwise. */
  prompt: null | string;
}

/** One nested `workflow(…)` call: the workflow it names, when it names one the guard can read. */
export interface WorkflowCallRead {
  line: number;
  /** `workflow("<name>")`: the first argument is a fixed string. */
  name: null | string;
  /** `workflow({ scriptPath: "<path>" })`: one plain object whose `scriptPath` is a fixed string. */
  scriptPath: null | string;
}

/** A use of `agent` or `workflow` that is not a direct call: it hides what it runs. */
export interface HandedAround {
  line: number;
  name: ScriptFunction;
}

/** What the reader found in a script: every call and use, each list in script order. */
export interface ParsedScript {
  agents: AgentCallRead[];
  /** Every use of `agent` or `workflow` that is not a direct call. */
  handed: HandedAround[];
  ok: true;
  /** Every route around the names (`ScriptRoute`). */
  routes: ScriptRoute[];
  workflows: WorkflowCallRead[];
}

/** What the reader found in a script, or where (when the parser says) and why it cannot read it. */
export type ReadScript = ParsedScript | { line: null | number; ok: false; why: string };

/** A node's first line, counting from 1 (`PARSE_OPTIONS.locations` is on). */
function lineOf(node: Node): number {
  return node.loc?.start.line ?? 1;
}

/** A fixed string: a string literal, or a backtick literal with no `${…}`. Null for anything else. */
function fixedString(node: Node | undefined): null | string {
  if (node === undefined) return null;
  if (node.type === "Literal") {
    const value = (node as Node & { value?: unknown }).value;
    return typeof value === "string" ? value : null;
  }
  if (node.type === "TemplateLiteral") {
    const template = node as Node & {
      expressions: Node[];
      quasis: Array<{ value: { cooked?: null | string } }>;
    };
    if (template.expressions.length > 0) return null;
    return template.quasis[0]?.value.cooked ?? null;
  }
  return null;
}

/** A property's name when its key is a name or a string literal, never computed; else null. */
function keyName(property: Node): null | string {
  const { computed, key } = property as Node & { computed: boolean; key: Node };
  if (computed) return null;
  if (key.type === "Identifier") return (key as Identifier).name;
  const value = (key as Node & { value?: unknown }).value;
  return key.type === "Literal" && typeof value === "string" ? value : null;
}

/** What an options object shows: its data keys, and whether it is plain or hides anything. */
function readObject(node: Node | undefined): {
  hidden: boolean;
  keys: Map<string, null | string>;
  plain: boolean;
} {
  const keys = new Map<string, null | string>();
  if (node?.type !== "ObjectExpression") return { hidden: false, keys, plain: false };
  const seen = new Set<string>();
  let hidden = false;
  let plain = true;
  for (const one of (node as ObjectExpression).properties) {
    if (one.type !== "Property") {
      hidden = true;
      plain = false;
      continue;
    }
    const name = keyName(one);
    if (name === null) {
      // A computed key, or a number: the guard cannot say which option it sets.
      if (one.computed) hidden = true;
      plain = false;
      continue;
    }
    if (seen.has(name)) hidden = true;
    seen.add(name);
    if (one.kind !== "init" || one.method || one.shorthand || name === PROTOTYPE_KEY) plain = false;
    if (one.kind === "init" && !keys.has(name)) keys.set(name, fixedString(one.value));
  }
  return { hidden, keys, plain: plain && !hidden };
}

/** An `agent(…)` call, read. */
function agentCall(call: CallExpression): AgentCallRead {
  const args = call.arguments;
  const spread = args.some((one) => one.type === "SpreadElement");
  const options = readObject(args[1]);
  return {
    hidden: spread || options.hidden,
    keys: options.keys,
    line: lineOf(call),
    plain: !spread && args.length === 2 && options.plain,
    prompt: fixedString(args[0]),
  };
}

/** A nested `workflow(…)` call, read. */
function workflowCall(call: CallExpression): WorkflowCallRead {
  const [first] = call.arguments;
  const object = readObject(first);
  return {
    line: lineOf(call),
    name: fixedString(first),
    scriptPath: object.plain ? (object.keys.get("scriptPath") ?? null) : null,
  };
}

/**
 * True when the code in `field` of `node` runs with a `this` of its own, not the script's: the
 * body and parameters of a non-arrow function, and a class field's value (the instance) or a
 * static block (the class). A class member's computed key runs outside, with the script's.
 */
function ownThis(node: Node, field: string): boolean {
  switch (node.type) {
    case "FunctionDeclaration":
    case "FunctionExpression":
      return field === "params" || field === "body";
    case "PropertyDefinition":
      return field === "value";
    case "StaticBlock":
      return true;
    default:
      return false;
  }
}

/** The route a node is, when it is one (`ScriptRoute.what`); null otherwise. */
function routeOf(node: Node, parent: Node | null, inFunction: boolean): null | string {
  switch (node.type) {
    case "Identifier": {
      const { name } = node as Identifier;
      if (!ROUTE_NAMES.includes(name)) return null;
      return COMMON_ROUTE_NAMES.includes(name)
        ? `\`${name}\` (even as a name of your own: rename it)`
        : `\`${name}\``;
    }
    case "ThisExpression":
      return inFunction ? null : SCRIPT_THIS;
    case "ImportExpression":
      return "`import(…)`";
    case "MemberExpression": {
      const { computed, property } = node as Node & { computed: boolean; property: Node };
      const name = computed ? fixedString(property) : (property as Identifier).name;
      return name === CONSTRUCTOR ? "a `constructor` member" : null;
    }
    case "Property":
      // `const { constructor: make } = f` reads the member as `f.constructor` does.
      return parent?.type === "ObjectPattern" && keyOrComputedName(node) === CONSTRUCTOR
        ? "a `constructor` member"
        : null;
    default:
      return null;
  }
}

/** A property's name, a computed key's too when it is a fixed string (`["constructor"]`). */
function keyOrComputedName(property: Node): null | string {
  const { computed, key } = property as Node & { computed: boolean; key: Node };
  return computed ? fixedString(key) : keyName(property);
}

/**
 * The children of a node that hold code, each with its field: every child node, except the
 * names that are not references — a property's or a class member's own name (`{ agent: 1 }`,
 * `x.agent`), a label, and `new.target` / `import.meta`.
 */
function codeChildren(node: Node): Array<[string, Node]> {
  const fields = node as unknown as Record<string, unknown>;
  const skip = new Set(["loc", "range"]);
  switch (node.type) {
    case "Property":
    case "MethodDefinition":
    case "PropertyDefinition":
      if (fields.computed !== true) skip.add("key");
      break;
    case "MemberExpression":
      if (fields.computed !== true) skip.add("property");
      break;
    case "LabeledStatement":
    case "BreakStatement":
    case "ContinueStatement":
      skip.add("label");
      break;
    case "MetaProperty":
      return [];
  }
  const children: Array<[string, Node]> = [];
  for (const [field, value] of Object.entries(fields)) {
    if (skip.has(field)) continue;
    for (const one of Array.isArray(value) ? value : [value]) {
      if (typeof one === "object" && one !== null && typeof (one as Node).type === "string") {
        children.push([field, one as Node]);
      }
    }
  }
  return children;
}

/** True when `node` is the callee of a direct call: `agent(…)`, never `agent?.(…)`. */
function directCallee(node: Node, parent: Node | null): parent is CallExpression {
  return (
    parent?.type === "CallExpression" &&
    (parent as CallExpression).callee === node &&
    !(parent as CallExpression).optional
  );
}

/** The parser's message without the `(line:column)` it ends with, and its line. */
function parseFailure(error: unknown): { line: null | number; ok: false; why: string } {
  const message = error instanceof Error ? error.message : String(error);
  const loc = (error as { loc?: { line?: unknown } } | null)?.loc;
  return {
    line: typeof loc?.line === "number" ? loc.line : null,
    ok: false,
    why: message.replace(/\s*\(\d+:\d+\)$/, ""),
  };
}

/** The text the parser reads: the script, with the `export` of its first-statement `meta` blanked. */
function bodyText(script: string): string {
  const at = metaExportAt(script);
  if (at === null) return script;
  return `${script.slice(0, at)}${" ".repeat("export".length)}${script.slice(at + "export".length)}`;
}

/** Parses a script: every `agent(…)` and `workflow(…)` call, and every other use of either. */
export function parseScript(script: string): ReadScript {
  if (lastRead?.script === script) return lastRead.read;
  const read = parseFresh(script);
  lastRead = { read, script };
  return read;
}

function parseFresh(script: string): ReadScript {
  if (scriptParser === null) {
    return {
      line: null,
      ok: false,
      why: "the guard's script parser is not loaded in this program",
    };
  }
  const text = bodyText(script);
  /** The line of each HTML-like comment, as the parser meets it. */
  const htmlComments: number[] = [];
  let program: Node;
  try {
    program = scriptParser(text, {
      ...PARSE_OPTIONS,
      onComment: (_block, _text, start, _end, startLoc) => {
        if (HTML_COMMENT_MARKERS.some((marker) => text.startsWith(marker, start))) {
          htmlComments.push(startLoc?.line ?? 1);
        }
      },
    });
  } catch (error) {
    return parseFailure(error);
  }
  const [htmlLine] = htmlComments;
  if (htmlLine !== undefined) return { line: htmlLine, ok: false, why: HTML_COMMENT };
  const agents: Array<{ at: number; read: AgentCallRead }> = [];
  const workflows: Array<{ at: number; read: WorkflowCallRead }> = [];
  const handed: Array<{ at: number; read: HandedAround }> = [];
  const routes: Array<{ at: number; read: ScriptRoute }> = [];
  // An explicit stack, not recursion: a deeply nested script cannot overflow the walk.
  const stack: Array<{ inFunction: boolean; node: Node; parent: Node | null }> = [
    { inFunction: false, node: program, parent: null },
  ];
  for (let next = stack.pop(); next !== undefined; next = stack.pop()) {
    const { inFunction, node, parent } = next;
    const route = routeOf(node, parent, inFunction);
    if (route !== null) routes.push({ at: node.start, read: { line: lineOf(node), what: route } });
    if (node.type === "Identifier" && SCRIPT_FUNCTIONS.includes((node as Identifier).name)) {
      const name = (node as Identifier).name as ScriptFunction;
      if (!directCallee(node, parent)) {
        handed.push({ at: node.start, read: { line: lineOf(node), name } });
      } else if (name === "agent") {
        agents.push({ at: parent.start, read: agentCall(parent) });
      } else {
        workflows.push({ at: parent.start, read: workflowCall(parent) });
      }
    }
    for (const [field, child] of codeChildren(node)) {
      stack.push({ inFunction: inFunction || ownThis(node, field), node: child, parent: node });
    }
  }
  const inOrder = <T>(found: Array<{ at: number; read: T }>): T[] =>
    found.sort((a, b) => a.at - b.at).map((one) => one.read);
  return {
    agents: inOrder(agents),
    handed: inOrder(handed),
    ok: true,
    routes: inOrder(routes),
    workflows: inOrder(workflows),
  };
}
