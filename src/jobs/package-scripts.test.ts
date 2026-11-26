/**
 * `packageScripts` (`package-scripts.ts`): the `scripts` of the nearest `package.json` from a
 * folder up to the checkout root, as a map of name to body, read from the machine; and null for
 * anything the classifier must treat as "no file". Every expectation is written by hand; each
 * file lives in a temp folder.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "../testing/temp";
import { fileExistsIn, packageScripts } from "./package-scripts";

/** A temp folder holding `package.json` with exactly `text`. */
function folderWith(text: string): string {
  const folder = tempDir("package-scripts");
  writeFileSync(join(folder, "package.json"), text);
  return folder;
}

/** A temp checkout (a `.git` folder at its root) with `package.json` files at the given paths. */
function checkoutWith(packages: Record<string, string>): string {
  const root = tempDir("package-scripts-checkout");
  mkdirSync(join(root, ".git"));
  for (const [path, text] of Object.entries(packages)) {
    mkdirSync(join(root, path), { recursive: true });
    writeFileSync(join(root, path, "package.json"), text);
  }
  return root;
}

describe("packageScripts", () => {
  test("gives each script's name and body, and an empty map when there is no scripts key", () => {
    const scripts = packageScripts(folderWith('{"scripts":{"tsc":"tsgo","build":"x && y"}}'));
    expect([...(scripts ?? [])]).toEqual([
      ["tsc", "tsgo"],
      ["build", "x && y"],
    ]);
    // A project with no scripts defines no script: a name is the package's tool there.
    expect(packageScripts(folderWith('{"name":"app"}'))).toEqual(new Map());
    expect(packageScripts(folderWith('{"scripts":{}}'))).toEqual(new Map());
  });

  test("drops a script whose body is no string", () => {
    const scripts = packageScripts(
      folderWith('{"scripts":{"a":"tsc","b":1,"c":null,"d":["x"],"e":{"x":1},"f":""}}'),
    );
    expect([...(scripts ?? [])]).toEqual([
      ["a", "tsc"],
      ["f", ""],
    ]);
  });

  test("names the folder of the package.json it read", () => {
    const folder = folderWith('{"scripts":{"a":"tsc"}}');
    expect(packageScripts(folder)?.folder).toBe(folder);
  });

  test("says whether the project uses yarn berry, which runs no pre or post script", () => {
    const berry = (text: string, yarnrc = false) => {
      const folder = folderWith(text);
      if (yarnrc) writeFileSync(join(folder, ".yarnrc.yml"), "nodeLinker: node-modules\n");
      return packageScripts(folder)?.yarnBerry;
    };
    expect(berry('{"packageManager":"yarn@4.5.0","scripts":{}}')).toBe(true);
    expect(berry('{"packageManager":"yarn@2.4.3"}')).toBe(true);
    expect(berry('{"scripts":{}}', true)).toBe(true);
    // Classic yarn, another manager, or nothing that says so.
    expect(berry('{"packageManager":"yarn@1.22.22"}')).toBe(false);
    expect(berry('{"packageManager":"pnpm@9.0.0"}')).toBe(false);
    expect(berry('{"scripts":{}}')).toBe(false);
    expect(berry('{"packageManager":42}')).toBe(false);
    // A package.json with no scripts key still says it.
    expect(berry('{"packageManager":"yarn@4.0.0"}')).toBe(true);
  });

  test("in a workspace, the root's packageManager or .yarnrc.yml says it for each package", () => {
    const fromRoot = checkoutWith({
      ".": '{"packageManager":"yarn@4.5.0","workspaces":["packages/*"]}',
      "packages/a": '{"scripts":{"test":"vitest"}}',
    });
    expect(packageScripts(join(fromRoot, "packages/a"))?.yarnBerry).toBe(true);

    const yarnrc = checkoutWith({ "packages/a": '{"scripts":{"test":"vitest"}}' });
    writeFileSync(join(yarnrc, ".yarnrc.yml"), "nodeLinker: node-modules\n");
    expect(packageScripts(join(yarnrc, "packages/a"))?.yarnBerry).toBe(true);

    // The nearest packageManager decides: the package's own classic yarn wins over the root's.
    const own = checkoutWith({
      ".": '{"packageManager":"yarn@4.5.0"}',
      "packages/a": '{"packageManager":"yarn@1.22.22","scripts":{}}',
    });
    expect(packageScripts(join(own, "packages/a"))?.yarnBerry).toBe(false);

    // Nothing above the checkout root counts.
    const outer = tempDir("package-scripts-outer");
    writeFileSync(join(outer, ".yarnrc.yml"), "nodeLinker: node-modules\n");
    mkdirSync(join(outer, "repo", ".git"), { recursive: true });
    writeFileSync(join(outer, "repo", "package.json"), '{"scripts":{}}');
    expect(packageScripts(join(outer, "repo"))?.yarnBerry).toBe(false);
  });

  test("gives null when there is no package.json, or no folder", () => {
    expect(packageScripts(tempDir("package-scripts-none"))).toBeNull();
    expect(packageScripts(join(tempDir("package-scripts-gone"), "missing"))).toBeNull();
  });

  test("gives null for a file it cannot use: broken JSON, or scripts that is no object", () => {
    for (const text of [
      "",
      "not json",
      "null",
      '"a string"',
      '{"scripts":"tsc"}',
      '{"scripts":null}',
      '{"scripts":["tsc"]}',
    ]) {
      expect([text, packageScripts(folderWith(text))]).toEqual([text, null]);
    }
  });

  test("reads a file saved with a byte order mark (Windows Notepad), its own and the root's", () => {
    const own = packageScripts(folderWith('\uFEFF{"scripts":{"build":"next build"}}'));
    expect([...(own ?? [])]).toEqual([["build", "next build"]]);
    const workspace = checkoutWith({
      ".": '\uFEFF{"packageManager":"yarn@4.5.0","workspaces":["packages/*"]}',
      "packages/a": '{"scripts":{"test":"vitest"}}',
    });
    expect(packageScripts(join(workspace, "packages/a"))?.yarnBerry).toBe(true);
  });

  test("a package.json that is a folder is no package.json", () => {
    const folder = tempDir("package-scripts-dir");
    mkdirSync(join(folder, "package.json"));
    expect(packageScripts(folder)).toBeNull();
  });
});

describe("packageScripts: the nearest package.json, up to the checkout root", () => {
  test("a subfolder reads the package.json above it, as the runners do", () => {
    const root = checkoutWith({ ".": '{"scripts":{"test":"vitest run"}}', "src/deep": "{}" });
    const scripts = packageScripts(join(root, "src", "deep"));
    // Its own package.json has no scripts: it is the nearest, and the root's is not read.
    expect(scripts).toEqual(new Map());
    expect(scripts?.folder).toBe(join(root, "src", "deep"));
    mkdirSync(join(root, "src", "plain"), { recursive: true });
    const up = packageScripts(join(root, "src", "plain"));
    expect([...(up ?? [])]).toEqual([["test", "vitest run"]]);
    expect(up?.folder).toBe(root);
  });

  test("the nearest file wins, and a broken nearest file is no package.json", () => {
    const root = checkoutWith({
      ".": '{"scripts":{"a":"tsc"}}',
      app: '{"scripts":{"b":"vitest run"}}',
      broken: "not json",
    });
    expect([...(packageScripts(join(root, "app")) ?? [])]).toEqual([["b", "vitest run"]]);
    // A file that exists and cannot be used ends the search: it is not skipped for the root's.
    expect(packageScripts(join(root, "broken"))).toBeNull();
  });

  test("a folder with no package.json asks the folders above it, up to the git root only", () => {
    const outer = tempDir("package-scripts-outer");
    writeFileSync(join(outer, "package.json"), '{"scripts":{"outer":"tsc"}}');
    const root = join(outer, "repo");
    mkdirSync(join(root, ".git"), { recursive: true });
    mkdirSync(join(root, "src"));
    // The checkout has no package.json: the one above the git root is never read.
    expect(packageScripts(join(root, "src"))).toBeNull();
    expect(packageScripts(root)).toBeNull();
  });

  test("a .git file (a linked worktree) is a git root too", () => {
    const outer = tempDir("package-scripts-linked");
    writeFileSync(join(outer, "package.json"), '{"scripts":{"outer":"tsc"}}');
    const root = join(outer, "wt");
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(join(root, ".git"), "gitdir: /somewhere/else\n");
    expect(packageScripts(join(root, "src"))).toBeNull();
  });

  test("with no git root above, only the folder itself is read", () => {
    const folder = tempDir("package-scripts-nogit");
    mkdirSync(join(folder, "child"));
    writeFileSync(join(folder, "package.json"), '{"scripts":{"a":"tsc"}}');
    expect(packageScripts(join(folder, "child"))).toBeNull();
    expect(packageScripts(folder)?.get("a")).toBe("tsc");
  });
});

describe("fileExistsIn", () => {
  test("is true for a file of the folder, and false for a folder, a missing path or an escape", () => {
    const folder = tempDir("file-exists");
    mkdirSync(join(folder, "app"));
    writeFileSync(join(folder, "a.test.ts"), "");
    writeFileSync(join(folder, "app", "b.test.ts"), "");
    expect(fileExistsIn(folder, "a.test.ts")).toBe(true);
    expect(fileExistsIn(folder, "./a.test.ts")).toBe(true);
    expect(fileExistsIn(folder, join(folder, "a.test.ts"))).toBe(true);
    expect(fileExistsIn(join(folder, "app"), "../a.test.ts")).toBe(true);
    expect(fileExistsIn(folder, "app")).toBe(false);
    expect(fileExistsIn(folder, "missing.ts")).toBe(false);
    expect(fileExistsIn(join(folder, "gone"), "a.test.ts")).toBe(false);
  });
});
