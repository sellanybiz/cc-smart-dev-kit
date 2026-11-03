import { describe, expect, test } from "bun:test";
import { editJsonText, printJson } from "./json-edit";

const BIOME_FILE = `{
  "requires": ">=0.5.2",
  "worktrees": {
    "base": "main",
    "bases": {
      "hotfix/": "main"
    }
  },
  "protectedBranches": ["main"],
  "workflow": {
    "issues": {
      "enabled": true
    }
  }
}
`;

function parsed(text: string): Record<string, unknown> {
  return JSON.parse(text) as Record<string, unknown>;
}

describe("editJsonText", () => {
  test("a new key keeps every other line byte for byte", () => {
    const after = { ...parsed(BIOME_FILE), sessionNames: true };
    expect(editJsonText(BIOME_FILE, after)).toBe(
      BIOME_FILE.replace("\n  }\n}\n", '\n  },\n  "sessionNames": true\n}\n'),
    );
  });

  test("a changed value inside a nested object touches only that value", () => {
    const after = parsed(BIOME_FILE);
    (after.workflow as { issues: { enabled: boolean } }).issues.enabled = false;
    expect(editJsonText(BIOME_FILE, after)).toBe(
      BIOME_FILE.replace('"enabled": true', '"enabled": false'),
    );
  });

  test("a new nested key lands after the last key of its object, with the file's indent", () => {
    const after = parsed(BIOME_FILE);
    (after.workflow as { issues: Record<string, unknown> }).issues.watchMinutes = 2;
    expect(editJsonText(BIOME_FILE, after)).toBe(
      BIOME_FILE.replace('"enabled": true', '"enabled": true,\n      "watchMinutes": 2'),
    );
  });

  test("a removed middle key goes with its line and its comma", () => {
    const after = parsed(BIOME_FILE);
    delete after.protectedBranches;
    expect(editJsonText(BIOME_FILE, after)).toBe(
      BIOME_FILE.replace('  "protectedBranches": ["main"],\n', ""),
    );
  });

  test("a removed last key takes the comma the one before it had", () => {
    const after = parsed(BIOME_FILE);
    delete after.workflow;
    expect(editJsonText(BIOME_FILE, after)).toBe(
      `{
  "requires": ">=0.5.2",
  "worktrees": {
    "base": "main",
    "bases": {
      "hotfix/": "main"
    }
  },
  "protectedBranches": ["main"]
}
`,
    );
  });

  test("removing the only key of an object leaves {}", () => {
    expect(editJsonText(`{\n  "a": {\n    "b": 1\n  }\n}\n`, { a: {} })).toBe(`{\n  "a": {}\n}\n`);
  });

  test("a new short array of scalars prints on one line; a long one, one item per line", () => {
    const after = { ...parsed(BIOME_FILE), alerts: ["sound", "desktop"] };
    expect(editJsonText(BIOME_FILE, after)).toContain('  "alerts": ["sound", "desktop"]\n}');
    const items = Array.from({ length: 12 }, (_, index) => `item-number-${index}`);
    const long = editJsonText(BIOME_FILE, { ...parsed(BIOME_FILE), alerts: items });
    expect(long).toContain('  "alerts": [\n    "item-number-0",\n');
    expect(long).toContain('    "item-number-11"\n  ]\n}');
  });

  test("a rewritten array is printed on one line", () => {
    const after = { ...parsed(BIOME_FILE), protectedBranches: ["main", "release"] };
    expect(editJsonText(BIOME_FILE, after)).toBe(
      BIOME_FILE.replace('["main"]', '["main", "release"]'),
    );
  });

  test("four spaces and tabs are kept", () => {
    const four = `{\n    "a": {\n        "b": 1\n    }\n}\n`;
    expect(editJsonText(four, { a: { b: 1, c: ["x"] } })).toBe(
      `{\n    "a": {\n        "b": 1,\n        "c": ["x"]\n    }\n}\n`,
    );
    const tabs = `{\n\t"a": 1\n}\n`;
    expect(editJsonText(tabs, { a: 1, b: { c: true } })).toBe(
      `{\n\t"a": 1,\n\t"b": {\n\t\t"c": true\n\t}\n}\n`,
    );
  });

  test("a key added to an empty object", () => {
    expect(editJsonText("{}\n", { a: 1 })).toBe(`{\n  "a": 1\n}\n`);
    expect(editJsonText("{\n}\n", { a: { b: [1] } })).toBe(`{\n  "a": {\n    "b": [1]\n  }\n}\n`);
  });

  test("a one-line object stays on one line when a key is added", () => {
    expect(editJsonText(`{\n  "a": { "b": 1 }\n}\n`, { a: { b: 1, c: 2 } })).toBe(
      `{\n  "a": { "b": 1, "c": 2 }\n}\n`,
    );
  });

  test("a removed key and an added key in the same object", () => {
    expect(editJsonText(`{\n  "a": 1,\n  "b": 2\n}\n`, { a: 1, c: 3 })).toBe(
      `{\n  "a": 1,\n  "c": 3\n}\n`,
    );
    expect(editJsonText(`{\n  "a": 1,\n  "b": 2\n}\n`, { c: 3 })).toBe(`{\n  "c": 3\n}\n`);
  });

  test("a one-line object around a multi-line one gets its new key on the same line", () => {
    expect(editJsonText('{"a": {\n  "x": 1\n}}', { a: { x: 1 }, b: 2 })).toBe(
      '{"a": {\n  "x": 1\n}, "b": 2}',
    );
  });

  test("an undefined item in an array prints as null, as JSON.stringify does", () => {
    expect(editJsonText('{\n  "a": [1, 2]\n}\n', { a: [1, undefined] })).toBe(
      '{\n  "a": [1, null]\n}\n',
    );
  });

  test("nothing to change returns the text itself", () => {
    expect(editJsonText(BIOME_FILE, parsed(BIOME_FILE))).toBe(BIOME_FILE);
  });

  test("a byte order mark goes; a file without a final newline stays without", () => {
    expect(editJsonText(`﻿{"a":1}`, { a: 2 })).toBe(`{"a":2}`);
  });

  test("a string with braces, commas and quotes in it does not confuse the places", () => {
    const text = `{\n  "a": "x, \\"y\\" }",\n  "b": 1\n}\n`;
    expect(editJsonText(text, { a: 'x, "y" }', b: 2 })).toBe(text.replace('"b": 1', '"b": 2'));
  });

  test("a file that is not a JSON object is refused", () => {
    expect(() => editJsonText("{ nope", {})).toThrow();
    expect(() => editJsonText("[1]", {})).toThrow();
  });
});

describe("printJson", () => {
  test("a short array on one line, an object on its own lines", () => {
    expect(printJson({ a: ["x"], b: { c: 1 }, d: [] })).toBe(
      `{\n  "a": ["x"],\n  "b": {\n    "c": 1\n  },\n  "d": []\n}\n`,
    );
  });
});
