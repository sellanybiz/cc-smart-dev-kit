/**
 * `classifyHeavyCommand` (`classify.ts`): which kind a Bash command runs, behind the
 * common runners and wrappers, and never a tool that is only named (in quotes, an echo, a
 * here-doc, a commit message). Every expected kind is written by hand.
 */
import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { toolName, toolOf } from "../shell/tool";
import {
  classifyHeavyCommand,
  classifyRoutableLine,
  classifyUnqueuedHeavy,
  mixedHeavyLine,
  routableLine,
  runWeight,
  type ScriptBodies,
  type ScriptSource,
  sedScriptReadsOnly,
  type WeightSource,
} from "./classify";
import { DEFAULT_KINDS, mergeKinds } from "./kinds";

const kindOf = (command: string) => classifyHeavyCommand(command, DEFAULT_KINDS);

function expectKind(kind: string, commands: string[]): void {
  for (const command of commands) {
    expect({ command, kind: kindOf(command) }).toEqual({ command, kind });
  }
}

test("dependency installs have no heavy kind", () => {
  for (const line of ["bun install", "bun add zod", "npm ci", "pnpm install", "yarn"])
    expect(kindOf(line)).toBeNull();
});

test("a line that installs and then runs a heavy job is named by the heavy one, so it takes a heavy slot", () => {
  expect(kindOf("bun install && bunx vitest run")).toBe("test:run");
  expect(kindOf("npm ci && npx tsc --noEmit")).toBe("tsc");
  expect(kindOf("pnpm i && pnpm exec next build")).toBe("build");
  expect(kindOf("bunx tsc && bun install")).toBe("tsc");
  // Light kinds alone keep the light one.
  expect(kindOf("bun install && bun add zod")).toBeNull();
});

describe("classifyHeavyCommand: type checks", () => {
  test("finds tsc, tsgo and vue-tsc behind every runner", () => {
    expectKind("tsc", [
      "tsc",
      "tsc --noEmit",
      "tsgo --noEmit",
      "bunx tsc --noEmit",
      "bunx tsgo --noEmit",
      "bunx -p typescript tsc --noEmit",
      "bun x tsc --noEmit",
      "bun tsgo --noEmit",
      "bun run tsc --noEmit",
      "npx tsc --noEmit",
      "npx -p typescript tsc --noEmit",
      "npm exec tsc -- --noEmit",
      "pnpm exec tsc --noEmit",
      "pnpm tsc --noEmit",
      "pnpm dlx vue-tsc --noEmit",
      "yarn tsc --noEmit",
      "./node_modules/.bin/tsc --noEmit",
      "node_modules/.bin/tsgo --noEmit",
      "node node_modules/typescript/bin/tsc --noEmit",
      "node node_modules/typescript/lib/tsc.js -p tsconfig.json",
      "bun node_modules/typescript/bin/tsc --noEmit",
      "time bunx tsgo --noEmit",
      "timeout 600 bunx tsgo --noEmit",
      "nice -n 10 npx tsc",
      "CI=1 npx tsc --noEmit",
      "cd app && bunx tsc --noEmit",
      'bash -c "bunx tsc --noEmit"',
      "sh -c 'cd app && npx tsc'",
    ]);
  });

  test("lets a type check that only prints through", () => {
    for (const command of [
      "tsc --version",
      "tsc -v",
      "bunx tsgo --help",
      "npx tsc -h",
      "bunx tsgo --showConfig",
      "bunx tsgo --listFilesOnly",
      "node node_modules/typescript/bin/tsc --version",
      // was: heavy. Any one print-only option prints and stops: one rule, `isPrintOnly`.
      "bunx tsc --version --noEmit",
      "tsc --noEmit --version",
    ]) {
      expect({ command, kind: kindOf(command) }).toEqual({ command, kind: null });
    }
  });
});

describe("classifyHeavyCommand: tests", () => {
  test("finds vitest and jest runs, and coverage as its own kind", () => {
    expectKind("test:run", [
      "vitest run src/x.test.ts",
      "bunx vitest run src/x.test.ts",
      "bunx vitest@latest run",
      "bunx --bun vitest run",
      "bun x vitest run",
      "bun vitest run",
      "bun run vitest run",
      "npx vitest run",
      "npx jest",
      "pnpm vitest run",
      "./node_modules/.bin/vitest run",
      "node node_modules/vitest/vitest.mjs run",
      "node --max-old-space-size=8192 node_modules/vitest/vitest.mjs run",
      // A Windows path in a Bash line is quoted: bash (Git Bash too) reads an unquoted `\` as
      // an escape, so `node node_modules\vitest\…` runs `node_modulesvitest…`, no vitest.
      'node "node_modules\\vitest\\vitest.mjs" run',
      "timeout -s KILL 120 vitest run",
      "echo start; bunx vitest run",
      // Bun's own test runner: a heavy test run like the others.
      "bun test",
      "bun test src/x.test.ts",
      "bun test ./src/x.test.ts",
      "bun --bun test",
      "bun test --bail",
      "cross-env NODE_ENV=test jest",
      "cross-env NODE_ENV=test CI=1 bunx vitest run",
      "env cross-env A=1 jest",
    ]);
    expect(kindOf("node node_modules\\vitest\\vitest.mjs run")).toBeNull();
    expectKind("test:coverage", [
      "bunx vitest run --coverage",
      "npx vitest run --coverage.enabled",
      "npx jest --coverage",
      "bun test --coverage",
      "bun test --coverage ./src/x.test.ts",
    ]);
  });

  test("lets print-only runs, other tools and a script with no reader through", () => {
    for (const command of [
      "bunx vitest --version",
      "vitest -v",
      "bunx vitest --help",
      "bunx playwright test --list",
      "bunx playwright show-report",
      "node scripts/other.js run",
      'node -e "console.log(1)"',
      "node --version",
      "npm test",
      "npm run test",
      "yarn test",
    ]) {
      expect({ command, kind: kindOf(command) }).toEqual({ command, kind: null });
    }
  });
});

describe("classifyHeavyCommand: the wrappers the guards read through", () => {
  test("CM-9: a wrapper's own options are stepped over: `time -p`, `env -i`, `sudo -u x`", () => {
    expectKind("tsc", [
      "time -p bunx tsc --noEmit",
      "env -i bunx tsc --noEmit",
      "env -u HOME PATH=/x bunx tsc --noEmit",
      "/usr/bin/env bunx tsc --noEmit",
      "sudo -u x bunx tsc --noEmit",
      "doas -u x bunx tsc --noEmit",
      "ionice -c 3 nice -n 5 bunx tsc --noEmit",
      "env -S 'bunx tsc --noEmit'",
    ]);
  });

  test("a keyword, a substitution, and a here-doc fed to a shell", () => {
    expectKind("tsc", [
      "if bunx tsc --noEmit; then echo ok; fi",
      "! bunx tsc --noEmit",
      "echo `bunx tsc --noEmit`",
      "cat <<EOF\n$(bunx tsc --noEmit)\nEOF",
      "sh <<'EOF'\nbunx tsc --noEmit\nEOF",
      "echo 'bunx tsc --noEmit' | sh",
      "bash -c -- 'bunx tsc --noEmit'",
    ]);
    expect(kindOf("cat <<'EOF'\nbunx tsc --noEmit\nEOF")).toBeNull();
    expect(kindOf("command -v tsc")).toBeNull();
  });

  test("a redirection is no argument: a type check that only prints, into a file, is not heavy", () => {
    expect(kindOf("bunx tsc --version > version.txt")).toBeNull();
    expect(kindOf("bunx tsc --noEmit > out.txt")).toBe("tsc");
  });
});

describe("classifyHeavyCommand: lint, builds and images", () => {
  test("finds a type-aware lint, but not a plain one", () => {
    expectKind("lint:typed", [
      "bunx eslint --config eslint.typed.config.mjs src",
      "npx eslint -c eslint.config.typed.mjs .",
      "npx eslint --config=eslint.type-checked.config.js .",
      "npx oxlint --type-aware",
    ]);
    for (const command of ["bunx eslint src", "npx eslint .", "npx oxlint ."]) {
      expect({ command, kind: kindOf(command) }).toEqual({ command, kind: null });
    }
  });

  test("finds next build, and not next dev", () => {
    expectKind("build", ["next build", "bunx next build", "npx next build --debug"]);
    for (const command of ["next dev", "bunx next start", "npx next lint"]) {
      expect({ command, kind: kindOf(command) }).toEqual({ command, kind: null });
    }
  });

  test("finds every form of an image build", () => {
    expectKind("image:build", [
      "docker build .",
      "docker build -t app:test -f Dockerfile .",
      "docker image build .",
      "docker builder build .",
      "docker buildx build --platform linux/amd64 .",
      "docker buildx b .",
      "docker buildx --builder fenced build .",
      "docker buildx bake",
      "docker compose build",
      "docker compose -f docker-compose.yml build app",
      "docker compose --project-name x --profile web build",
      "docker-compose build",
      "docker-compose -f x.yml build app",
      "docker -H tcp://host:2375 build .",
      "docker --context remote build .",
      "sudo docker build .",
      "DOCKER_BUILDKIT=1 docker build .",
      "/usr/bin/docker build .",
      "docker compose up --build",
      "docker compose -f x.yml up -d --build app",
      "podman build .",
      'bash -c "docker build ."',
    ]);
  });

  test("lets other docker commands through: a plain up, a service named build", () => {
    for (const command of [
      "docker compose up",
      "docker compose up -d",
      "docker compose pull",
      "docker compose logs build",
      "docker-compose up -d",
      "docker buildx ls",
      "docker buildx create --name x",
      "docker image ls",
      "docker run --rm alpine true",
      "docker builder prune",
    ]) {
      expect({ command, kind: kindOf(command) }).toEqual({ command, kind: null });
    }
  });
});

describe("classifyHeavyCommand: text is not a command", () => {
  test("a tool named in quotes, an echo, a comment, a here-doc or a commit message", () => {
    for (const command of [
      "echo tsc --noEmit",
      'echo "bunx vitest run"',
      "printf 'docker compose build'",
      "grep -rn 'next build' docs",
      'git commit -m "run bunx tsc --noEmit before pushing"',
      "git commit -m \"$(cat <<'EOF'\nfix\n\nbunx vitest run x\nEOF\n)\"",
      "cat <<'EOF' > note.md\ndocker build .\nEOF",
      "git status # bunx vitest run",
      'bash -c "echo docker build ."',
      "cat node_modules/.bin/vitest",
      "ls node_modules/.bin/tsc",
      "cat tsconfig.json",
    ]) {
      expect({ command, kind: kindOf(command) }).toEqual({ command, kind: null });
    }
  });
});

describe("classifyHeavyCommand: several steps, and a project's own kinds", () => {
  // A kind has no size (the queue counts jobs), so no step is "the largest": the first heavy one
  // the line runs names the job.
  test("names the first heavy step the line runs", () => {
    expect(kindOf("bunx tsc --noEmit && bunx next build")).toBe("tsc");
    expect(kindOf("bunx next build && bunx tsc --noEmit")).toBe("build");
    expect(kindOf("bunx tsc; bunx vitest run --coverage")).toBe("tsc");
    expect(kindOf("bunx vitest run a.ts; bunx tsc")).toBe("test:run");
    expect(kindOf("ls && echo done")).toBeNull();
  });

  // `vitest --coverage` matches the coverage kind and the test kind: the first listed wins.
  test("names the first listed kind when one command matches two", () => {
    expect(kindOf("bunx vitest run --coverage")).toBe("test:coverage");
    expect(kindOf("bunx vitest run")).toBe("test:run");
    const kinds = mergeKinds({ mine: { match: [{ tool: "vitest" }] } });
    // A project's own kind comes after the defaults.
    expect(classifyHeavyCommand("bunx vitest run", kinds)).toBe("test:run");
  });

  test("a line the hook can route names its first heavy kind", () => {
    expect(classifyRoutableLine("bunx tsc --noEmit && bunx next build", DEFAULT_KINDS)).toBe("tsc");
    expect(classifyRoutableLine("bunx next build && bunx tsc --noEmit", DEFAULT_KINDS)).toBe(
      "build",
    );
    expect(classifyRoutableLine("bunx vitest run a.ts; bunx tsc", DEFAULT_KINDS)).toBe("test:run");
  });

  test("finds a project's script by its name, through every package manager", () => {
    const kinds = mergeKinds({ typecheck: { match: [{ script: "typecheck" }] } });
    for (const command of [
      "bun run typecheck",
      "bun typecheck",
      "npm run typecheck",
      "npm run-script typecheck",
      "pnpm typecheck",
      "pnpm run typecheck",
      "yarn typecheck",
      "yarn run typecheck",
    ]) {
      expect({ command, kind: classifyHeavyCommand(command, kinds) }).toEqual({
        command,
        kind: "typecheck",
      });
    }
    expect(classifyHeavyCommand("bun run lint", kinds)).toBeNull();
    expect(classifyHeavyCommand("bunx typecheck", kinds)).toBeNull();
  });

  test("a project's kind can replace a default's rules", () => {
    const kinds = mergeKinds({ tsc: { match: [{ tool: "tsc" }] } });
    expect(classifyHeavyCommand("bunx tsgo --noEmit", kinds)).toBeNull();
    expect(classifyHeavyCommand("bunx tsc --noEmit", kinds)).toBe("tsc");
  });
});

describe("a package script is a script, not the tool of the same name", () => {
  /**
   * A reader over fixed folders, starting in `/repo`: a folder mapped to null (or not
   * mapped) has no package.json to read. A list of names gives each a body that runs nothing
   * heavy; a record gives the bodies. Every read is kept, so a test can check the cache.
   */
  function readerOf(folders: Record<string, string[] | Record<string, string> | null>): {
    asked: string[];
    source: ScriptSource;
  } {
    const asked: string[] = [];
    return {
      asked,
      source: {
        folder: "/repo",
        scriptsIn: (folder) => {
          asked.push(folder);
          const scripts = folders[folder];
          if (scripts === undefined || scripts === null) return null;
          const bodies = Array.isArray(scripts)
            ? Object.fromEntries(scripts.map((name) => [name, "echo built"]))
            : scripts;
          return new Map(Object.entries(bodies));
        },
      },
    };
  }

  test("J1: a name the project defines as a script never matches a tool rule", () => {
    const { source } = readerOf({ "/repo": ["tsc"], "/repo/app": ["tsc"] });
    // The three shapes the finding named, and the other package managers' forms.
    for (const command of [
      "bun run tsc --noEmit",
      "bun tsc",
      "bun tsc --noEmit",
      "cd app && bun run tsc --noEmit",
      "pnpm tsc --noEmit",
      "pnpm run tsc",
      "yarn tsc --noEmit",
      "yarn run tsc",
    ]) {
      expect([command, classifyHeavyCommand(command, DEFAULT_KINDS, source)]).toEqual([
        command,
        null,
      ]);
    }
  });

  test("a name that is no script there is the package manager's tool, as before", () => {
    const { source } = readerOf({ "/repo": ["typecheck"] });
    for (const command of [
      "bun run tsc --noEmit",
      "bun tsc",
      "pnpm tsc --noEmit",
      "yarn run tsc",
    ]) {
      expect([command, classifyHeavyCommand(command, DEFAULT_KINDS, source)]).toEqual([
        command,
        "tsc",
      ]);
    }
  });

  test("no package.json, or one that cannot be read: the tool, as before", () => {
    const none = readerOf({ "/repo": null });
    expect(classifyHeavyCommand("bun run tsc --noEmit", DEFAULT_KINDS, none.source)).toBe("tsc");
    const broken: ScriptSource = {
      folder: "/repo",
      scriptsIn: () => {
        throw new Error("EACCES: permission denied");
      },
    };
    expect(classifyHeavyCommand("bun run tsc --noEmit", DEFAULT_KINDS, broken)).toBe("tsc");
    // No reader at all keeps the answer the classifier gave before this rule.
    expect(classifyHeavyCommand("bun run tsc --noEmit", DEFAULT_KINDS)).toBe("tsc");
  });

  test("after a cd, the folder the line moves to decides", () => {
    // The root defines no tsc script; `app` does.
    const { source, asked } = readerOf({ "/repo": [], "/repo/app": ["tsc"] });
    expect(classifyHeavyCommand("bun run tsc --noEmit", DEFAULT_KINDS, source)).toBe("tsc");
    expect(
      classifyHeavyCommand("cd app && bun run tsc --noEmit", DEFAULT_KINDS, source),
    ).toBeNull();
    expect(
      classifyHeavyCommand("cd app && cd .. && bun run tsc --noEmit", DEFAULT_KINDS, source),
    ).toBe("tsc");
    expect(asked).toEqual(["/repo", "/repo/app", "/repo"]);
    // A folder the line does not name (`$DIR`, `-`) is no folder to read: the tool, as before.
    expect(classifyHeavyCommand("cd $DIR && bun run tsc", DEFAULT_KINDS, source)).toBe("tsc");
    expect(classifyHeavyCommand("cd - && bun run tsc", DEFAULT_KINDS, source)).toBe("tsc");
  });

  test("a nested shell's cd stays inside it, and does not move the line after it", () => {
    const { source } = readerOf({ "/repo": ["tsc"], "/repo/app": [] });
    // In the nested shell `app` is the folder, and tsc is no script there: it is the tool.
    expect(classifyHeavyCommand("bash -c 'cd app && bun run tsc'", DEFAULT_KINDS, source)).toBe(
      "tsc",
    );
    // The line itself stays in the root, where tsc is a script.
    expect(
      classifyHeavyCommand("bash -c 'cd app && true'; bun run tsc", DEFAULT_KINDS, source),
    ).toBeNull();
  });

  test("a script rule of the same name still matches the script", () => {
    const kinds = mergeKinds({ typecheck: { match: [{ script: "tsc" }] } });
    const { source } = readerOf({ "/repo": ["tsc"] });
    expect(classifyHeavyCommand("bun run tsc --noEmit", kinds, source)).toBe("typecheck");
    expect(classifyHeavyCommand("bun run tsc --noEmit", DEFAULT_KINDS, source)).toBeNull();
  });

  test("one read a folder, however many steps ask it", () => {
    const { source, asked } = readerOf({ "/repo": ["tsc"], "/repo/x": ["tsc"] });
    expect(
      classifyHeavyCommand(
        "bun run tsc && cd x && bun run tsc && bun run tsc",
        DEFAULT_KINDS,
        source,
      ),
    ).toBeNull();
    expect(asked).toEqual(["/repo", "/repo/x"]);
  });

  test("the route: a line whose only heavy command is a script stays raw", () => {
    const script = readerOf({ "/repo": ["tsc"], "/repo/app": ["tsc"] });
    expect(classifyRoutableLine("bun run tsc --noEmit", DEFAULT_KINDS, script.source)).toBeNull();
    expect(classifyRoutableLine("cd app && bun run tsc", DEFAULT_KINDS, script.source)).toBeNull();
    // A tool behind a runner is still heavy, and a name that is no script is the tool.
    const tool = readerOf({ "/repo": [] });
    expect(classifyRoutableLine("bunx tsc --noEmit", DEFAULT_KINDS, tool.source)).toBe("tsc");
    expect(classifyRoutableLine("bun run tsc --noEmit", DEFAULT_KINDS, tool.source)).toBe("tsc");
  });
});

describe("toolName and toolOf", () => {
  test("strips folders, .exe, @version and a script path's extension", () => {
    expect(toolName("./node_modules/.bin/vitest")).toBe("vitest");
    expect(toolName("vitest@latest")).toBe("vitest");
    expect(toolName("TSC.CMD")).toBe("tsc");
    expect(toolName("node_modules/vitest/vitest.mjs")).toBe("vitest");
    expect(toolName("next.js")).toBe("next.js");
    // A scoped package name is no path: its `.js` stays.
    expect(toolName("@scope/next.js")).toBe("next.js");
  });

  test("finds the tool's own arguments behind a runner", () => {
    expect(toolOf("bunx", ["tsc", "--noEmit"])).toEqual({
      name: "tsc",
      args: ["--noEmit"],
    });
    expect(toolOf("vitest", ["run", "a.ts"])).toEqual({
      name: "vitest",
      args: ["run", "a.ts"],
    });
    // The script's own call keeps what was written; a runner's `--` is dropped later, where the
    // script is known to be one (`runWeight`: "the `--` a package runner drops").
    expect(toolOf("npm", ["run", "x", "--", "a.ts"])).toEqual({
      name: "",
      args: ["--", "a.ts"],
      script: "x",
    });
    // `node` with no script path runs no tool the reader knows.
    expect(toolOf("node", ["--version"])).toBeUndefined();
  });
});

describe("the tool reader reads a script file: the classifier's answers are the same as before", () => {
  // `bash x.sh "…"` runs a script file (`src/shell/tool.ts`): its quoted word is the file's
  // argument, no command of the line, and the file is no heavy kind. These answers were the
  // classifier's before the reader learned to follow a shell to the file it is given.
  test("npx tsc --noEmit is a tsc run, and PowerShell reads npx tsc alike", () => {
    expect(classifyHeavyCommand("npx tsc --noEmit", DEFAULT_KINDS)).toBe("tsc");
    expect(classifyHeavyCommand("npx tsc", DEFAULT_KINDS, undefined, "powershell")).toBe("tsc");
  });

  test.each([
    ['bash x.sh "a; git push -f"'],
    ['bash x.sh "npx tsc --noEmit"'],
    ["bash -o pipefail x.sh 'bunx vitest run'"],
    ["source x.sh 'bunx tsc'"],
    [". x.sh 'bunx tsc'"],
    ["node deploy.js 'bunx tsc'"],
    ["python3 deploy.py 'bunx tsc'"],
  ])("%s runs no heavy kind", (command) => {
    expect(classifyHeavyCommand(command, DEFAULT_KINDS)).toBeNull();
    expect(classifyHeavyCommand(command, DEFAULT_KINDS, undefined, "powershell")).toBeNull();
  });

  test("a shell that runs a command string still runs what it holds", () => {
    expect(classifyHeavyCommand('bash -c "npx tsc --noEmit"', DEFAULT_KINDS)).toBe("tsc");
  });

  // The deploy guard reads a script file a shell is given (`callOf`); the classifier does not:
  // a project names `bash`, `python` or `source` as the tool of a kind, and a file a shell or
  // `node` is given is not the tool of the same name. Each answer below is what the classifier
  // gave before the tool reader moved.
  const PROJECT_KINDS = mergeKinds({
    django: { match: [{ tool: "python", sub: ["manage.py", "test"] }] },
    e2e: { match: [{ tool: "bash", sub: ["scripts/e2e.sh"] }, { tool: "source" }] },
  });

  test.each([
    ["bash scripts/e2e.sh", "e2e"],
    ["python manage.py test", "django"],
    ["source env.sh", "e2e"],
    ["source env.sh && vitest", "e2e"],
    ["bash scripts/other.sh", null],
    ["python manage.py runserver", null],
  ])("a project kind that names a shell or an interpreter: %s is %s", (command, kind) => {
    expect(classifyHeavyCommand(command, PROJECT_KINDS)).toBe(kind);
  });

  test.each([
    ["sh node_modules/.bin/vitest run"],
    ["zsh -o pipefail ./node_modules/.bin/jest"],
    [". ./node_modules/.bin/tsc"],
    ["bash ./tsc"],
    ["node tsc --noEmit"],
    ["node vitest"],
    ["node scripts/build.js"],
  ])("%s runs no heavy kind: the file is not the tool of its name", (command) => {
    expect(classifyHeavyCommand(command, PROJECT_KINDS)).toBeNull();
    expect(classifyHeavyCommand(command, DEFAULT_KINDS)).toBeNull();
  });

  test("node with a script path is still the tool the path names", () => {
    expect(classifyHeavyCommand("node node_modules/vitest/vitest.mjs run", DEFAULT_KINDS)).toBe(
      "test:run",
    );
  });
});

describe("a runner's line is never routed (the review of the runner follow-up)", () => {
  // find, watch, su and parallel do work of their own — a delete, a user switch, an endless
  // repeat, remote hosts — and the person's `Bash(find:*)` rules only see the words of the line
  // that runs. Once the reader knows what they run, the classifier must still leave them alone.
  test.each([
    "watch tsc --noEmit",
    "watch -n 5 bunx vitest run",
    "find . -delete -exec tsc \\;",
    "find . -name x -exec bunx tsc --noEmit {} +",
    "su -c 'tsc --noEmit' root",
    "parallel -S host1 tsc ::: a b",
    "parallel 'tsc {}' ::: a b",
    "cd app && watch tsc --noEmit",
  ])("%s runs raw", (command) => {
    expect(classifyRoutableLine(command, DEFAULT_KINDS)).toBeNull();
  });

  test("the heavy command inside is still counted for a reservation", () => {
    expect(classifyHeavyCommand("watch tsc --noEmit", DEFAULT_KINDS)).toBe("tsc");
    expect(classifyHeavyCommand("find . -exec tsc \\;", DEFAULT_KINDS)).toBe("tsc");
  });

  test("a heavy command alone, behind a wrapper, or in a shell is still routed", () => {
    expect(classifyRoutableLine("tsc --noEmit", DEFAULT_KINDS)).toBe("tsc");
    expect(classifyRoutableLine("timeout 60 tsc --noEmit", DEFAULT_KINDS)).toBe("tsc");
    expect(classifyRoutableLine("bash -c 'tsc --noEmit'", DEFAULT_KINDS)).toBe("tsc");
    expect(classifyRoutableLine("xargs tsc", DEFAULT_KINDS)).toBe("tsc");
  });
});

// A builder pipes a heavy command into a filter all the time (`tsc --noEmit 2>&1 | tail -20`).
// Such a line is routable when everything after the heavy command is a read-only filter fed by
// the pipe (`READ_ONLY_FILTERS`): the filters stay outside the queue's command, so the person's
// own Bash rules still see them. Anything that writes a file or runs a program is no filter.
describe("routableLine: a heavy command piped into read-only filters", () => {
  const line = (command: string) => routableLine(command, DEFAULT_KINDS);

  test("tail: the heavy part is queued, `| tail` stays after it", () => {
    expect(line("tsc --noEmit 2>&1 | tail -20")).toEqual({
      filters: "| tail -20",
      heavy: "tsc --noEmit 2>&1",
      kind: "tsc",
    });
  });

  test("grep: a test run whose failures are picked out", () => {
    expect(line("bunx vitest run src/a.test.ts | grep FAIL")).toEqual({
      filters: "| grep FAIL",
      heavy: "bunx vitest run src/a.test.ts",
      kind: "test:run",
    });
  });

  test("wc, after another filter: every filter after the heavy command stays outside", () => {
    expect(line("bunx tsc --noEmit | tail -5 | wc -l")).toEqual({
      filters: "| tail -5 | wc -l",
      heavy: "bunx tsc --noEmit",
      kind: "tsc",
    });
  });

  test("a cd before the heavy command goes into the queue with it", () => {
    expect(line("cd app && bunx tsc --noEmit | head -40")).toEqual({
      filters: "| head -40",
      heavy: "cd app && bunx tsc --noEmit",
      kind: "tsc",
    });
  });

  test("the other filters of the list, in their read-only forms", () => {
    for (const filter of [
      "head -n 5",
      "egrep -i 'error|fail'",
      "fgrep FAIL",
      "rg -n FAIL",
      "sort -u",
      "uniq -c",
      "cut -c1-80",
      "tr -d '\r'",
      "cat",
      "cat -n -",
      "tee",
      "tee -a /dev/null",
      "sed -n '1,20p'",
      "sed -E 's/\\x1b\\[[0-9;]*m//g'",
      "sed '/^$/d;5q'",
      "sed -n -e '/error/p' -e '$p'",
      "awk '{print $1}'",
      "awk -F: -v n=2 'NR<n {print}'",
      "tail -1 2>/dev/null",
    ]) {
      expect([filter, line(`bunx tsc --noEmit | ${filter}`)?.filters]).toEqual([
        filter,
        `| ${filter}`,
      ]);
    }
  });

  test("tee with a file refused: it writes the file, and a Bash(tee:*) rule must see it", () => {
    expect(line("bunx tsc --noEmit | tee out.txt")).toBeNull();
    expect(line("bunx tsc --noEmit | tee -a out.txt")).toBeNull();
    expect(line("bunx tsc --noEmit | tee /dev/null out.txt")).toBeNull();
  });

  test("sed -i refused, and every sed or awk script that writes, runs or cannot be read", () => {
    for (const filter of [
      "sed -i 's/a/b/' file.ts",
      "sed -ni '1p' file.ts",
      "sed --in-place 's/a/b/' file.ts",
      "sed -f script.sed",
      "sed 's/a/b/w out.txt'",
      "sed 's/a/b/e'",
      "sed -n '1w out.txt'",
      "sed '1r other.txt'",
      "sed '1e rm -f x'",
      "sed ':a;N;ba'",
      "awk '{print > \"out.txt\"}'",
      "awk '{print | \"sh\"}'",
      "awk '{system(\"rm -f x\")}'",
      "awk -f prog.awk",
      "gawk '@include \"x\"'",
    ]) {
      expect([filter, line(`bunx tsc --noEmit | ${filter}`)]).toEqual([filter, null]);
    }
  });

  test("the other forms that write or run something are refused", () => {
    for (const filter of [
      "sort -o out.txt",
      "sort -uo out.txt",
      "sort --output=out.txt",
      "sort --compress-program=gzip",
      "uniq in.txt out.txt",
      // `-` is the input, and the word after it the file uniq writes.
      "uniq - out.txt",
      "rg --pre ./run.sh FAIL",
      "rg -z FAIL",
      "tail -5 > out.txt",
      "tail -5 >> out.txt",
      "grep FAIL $(rm -f x)",
      "sudo tail -5",
      "LC_ALL=C sort",
      "less",
      "more",
      "xargs rm -f",
    ]) {
      expect([filter, line(`bunx tsc --noEmit | ${filter}`)]).toEqual([filter, null]);
    }
  });

  test("review #4: sort's unique starts of --compress-program and --output are refused", () => {
    // GNU sort takes any unique start of a long option: `--co` can only be --compress-program.
    for (const filter of [
      "sort --co=evil",
      "sort --co evil",
      "sort --compress=gzip",
      "sort --ou=out.txt",
      "sort --out out.txt",
      "sort -k1 --outp=out.txt",
    ]) {
      expect([filter, line(`tsc --noEmit | ${filter}`)]).toEqual([filter, null]);
    }
    // Options that only change the order still pass.
    expect(line("tsc --noEmit | sort -n --check")?.filters).toBe("| sort -n --check");
  });

  test("review #4: rg's --hostname-bin is refused, alone and with =", () => {
    expect(line("tsc --noEmit | rg --hostname-bin=evil x")).toBeNull();
    expect(line("tsc --noEmit | rg --hostname-bin evil x")).toBeNull();
    expect(line("tsc --noEmit | rg --hyperlink-format=default x")?.filters).toBe(
      "| rg --hyperlink-format=default x",
    );
  });

  test("review #4: a sed bracket that BSD sed reads past the delimiter is refused", () => {
    // BSD sed reads `/` inside `[...]` as a plain character, so there the script is
    // `s/[/]/;/` with the flag `w /p;p`: it writes a file.
    expect(line("tsc | sed 's/[/]/;/w /p;p'")).toBeNull();
    expect(line("tsc | sed '/[/]/w out'")).toBeNull();
    expect(line("tsc | sed 'y/[/]/;/w x/'")).toBeNull();
    // A plain bracket, with no delimiter in it, reads the same in both: still a filter.
    expect(line("tsc | sed 's/[0-9]//g'")?.filters).toBe("| sed 's/[0-9]//g'");
  });

  test("filter before heavy refused: it names a file, and a Read rule must see that", () => {
    expect(line("cat tsconfig.json | bunx tsc --noEmit")).toBeNull();
    expect(line("tail -5 log.txt | bunx vitest run")).toBeNull();
    expect(line("bunx tsc --noEmit | cat other.txt")).toBeNull();
  });

  test("a reader piped into the heavy command, with no file word, is glue: no cut", () => {
    // `echo x | grep x | bunx tsc`: nothing names a file, so the whole line is queued.
    expect(line("echo x | cat | bunx tsc --noEmit")).toEqual({
      filters: "",
      heavy: "echo x | cat | bunx tsc --noEmit",
      kind: "tsc",
    });
  });

  test("two heavy steps piped: the whole line is queued, as before", () => {
    expect(line("bunx tsc --noEmit | bunx vitest run")).toEqual({
      filters: "",
      heavy: "bunx tsc --noEmit | bunx vitest run",
      kind: "tsc",
    });
  });

  test("a pipe whose meaning the cut would change is not cut: the whole line is queued", () => {
    // The reader is glue, so nothing hides from the person's rules; and since the whole line
    // goes through the shell as written, its pipes and its exit code mean what they meant.
    for (const [command, kind] of [
      // The filter read only the test run's output: a cut would filter tsc's too.
      ["bunx tsc --noEmit && bunx vitest run | tail -5", "tsc"],
      // `!` turns the whole pipeline's exit code around, not the heavy command's.
      ["! bunx tsc --noEmit | tail -5", "tsc"],
      // A filter inside a shell string is part of the shell string.
      ["bash -c 'bunx tsc --noEmit | tail -5'", "tsc"],
      // A command after the filter, and a comment the cut cannot place.
      ["bunx tsc --noEmit | tail -5; echo done", "tsc"],
      ["bunx tsc --noEmit | tail -5 # last lines", "tsc"],
    ] as const) {
      expect([command, line(command)]).toEqual([command, { filters: "", heavy: command, kind }]);
    }
    // A command that is not glue after the filter keeps the line raw, and so does a reader that
    // is no pipe's (`||`) or names a file.
    expect(line("bunx tsc --noEmit | tail -5; rm -f x")).toBeNull();
    expect(line("bunx tsc --noEmit || tail -5 log.txt")).toBeNull();
  });

  test("classifyRoutableLine names the kind of such a line", () => {
    expect(classifyRoutableLine("bunx tsc --noEmit 2>&1 | tail -20", DEFAULT_KINDS)).toBe("tsc");
  });
});

/**
 * A reader over fixed package folders, and a fake file system, starting in `/repo`. A folder
 * maps to its scripts' bodies, or to null (no package.json to read). `packageAt` makes a folder
 * answer with the package.json of an ancestor, as the real reader walks up: the answer then
 * names that package's folder.
 */
function weightSourceOf(
  packages: Record<string, Record<string, string> | null>,
  files: readonly string[] = [],
  options: { packageAt?: Record<string, string>; folder?: string; yarnBerry?: boolean } = {},
): WeightSource & { asked: string[] } {
  const asked: string[] = [];
  const present = new Set(files);
  return {
    asked,
    folder: options.folder ?? "/repo",
    scriptsIn: (folder) => {
      asked.push(folder);
      const home = options.packageAt?.[folder] ?? folder;
      const scripts = packages[home];
      if (scripts === undefined || scripts === null) return null;
      const bodies: ScriptBodies = Object.assign(new Map(Object.entries(scripts)), {
        folder: home,
        yarnBerry: options.yarnBerry === true,
      });
      return bodies;
    },
    isFile: (folder, word) => present.has(resolve(folder, word)),
  };
}

describe("a package script is classified by its body", () => {
  const anyHeavy = (line: string, packages: Record<string, string>) =>
    classifyHeavyCommand(line, DEFAULT_KINDS, weightSourceOf({ "/repo": packages }));
  const routed = (line: string, packages: Record<string, string>) =>
    classifyRoutableLine(line, DEFAULT_KINDS, weightSourceOf({ "/repo": packages }));

  test("a script whose body is a heavy command is that command's kind, in every runner's form", () => {
    for (const line of [
      "bun run typecheck",
      "bun typecheck",
      "npm run typecheck",
      "npm run-script typecheck",
      "pnpm typecheck",
      "pnpm run typecheck",
      "yarn typecheck",
      "yarn run typecheck",
    ]) {
      expect([line, routed(line, { typecheck: "tsc --noEmit" })]).toEqual([line, "tsc"]);
      expect([line, anyHeavy(line, { typecheck: "tsc --noEmit" })]).toEqual([line, "tsc"]);
    }
    for (const line of ["npm test", "npm t", "yarn test", "pnpm test", "pnpm t"]) {
      expect([line, routed(line, { test: "vitest run" })]).toEqual([line, "test:run"]);
    }
    expect(routed("bun run test", { test: "vitest run" })).toBe("test:run");
  });

  test("`$npm_execpath` as the program is the runner that ran the script", () => {
    expect(routed("bun run test", { test: '"$npm_execpath" test' })).toBe("test:run");
    expect(routed("bun run test", { test: "$npm_execpath test" })).toBe("test:run");
    expect(routed("npm run lint:ts", { "lint:ts": '"$npm_execpath" exec tsc --noEmit' })).toBe(
      "tsc",
    );
    expect(
      routed("pnpm run check", { check: '"$npm_execpath" run tsc:only', "tsc:only": "tsc" }),
    ).toBe("tsc");
    // Not in a script: nothing says which runner `$npm_execpath` is.
    expect(classifyRoutableLine('"$npm_execpath" test', DEFAULT_KINDS)).toBeNull();
  });

  test("a mixed script is raw for the route, and found by the any-heavy walk", () => {
    const packages = { check: "biome check . && tsc --noEmit" };
    expect(routed("bun run check", packages)).toBeNull();
    expect(anyHeavy("bun run check", packages)).toBe("tsc");
    // Every command heavy: routable, with the first kind.
    expect(
      routed("bun run check", {
        check: "bun run typecheck && bun run test:unit",
        typecheck: "tsc --noEmit",
        "test:unit": "vitest run",
      }),
    ).toBe("tsc");
    // A cd and an assignment stay allowed, as on a line.
    expect(routed("bun run build", { build: "cd app && NODE_ENV=production next build" })).toBe(
      "build",
    );
  });

  test("a project's script rule wins, and its body is never read", () => {
    const kinds = mergeKinds({ check: { match: [{ script: "check" }] } });
    const source = weightSourceOf({ "/repo": { check: "biome check . && tsc --noEmit" } });
    expect(classifyRoutableLine("bun run check", kinds, source)).toBe("check");
    expect(classifyHeavyCommand("bun run check", kinds, source)).toBe("check");
  });

  test("pre and post scripts run with the script, and count in its body", () => {
    // Every runner here runs them: bun, npm, pnpm and yarn classic (their docs).
    expect(anyHeavy("bun run build", { prebuild: "tsc --noEmit", build: "echo hi" })).toBe("tsc");
    // `echo hi` is glue, so the script is queued whole; a body command that is not glue is not.
    expect(routed("bun run build", { prebuild: "tsc --noEmit", build: "echo hi" })).toBe("tsc");
    expect(routed("bun run build", { prebuild: "tsc --noEmit", build: "rm -rf dist" })).toBeNull();
    expect(routed("npm run build", { prebuild: "tsc --noEmit", build: "next build" })).toBe("tsc");
    expect(routed("pnpm build", { build: "next build", postbuild: "vitest run" })).toBe("build");
    expect(anyHeavy("yarn build", { build: "echo hi", postbuild: "docker build ." })).toBe(
      "image:build",
    );
    expect(routed("npm test", { pretest: "tsc --noEmit", test: "vitest run" })).toBe("tsc");
    // A name that merely starts with `pre` is no hook of a script that does not exist.
    expect(anyHeavy("bun run build", { prebuilder: "tsc --noEmit", build: "echo hi" })).toBeNull();
  });

  test("yarn berry runs no pre or post script; classic yarn, and every other runner, does", () => {
    const packages = { "/repo": { prebuild: "tsc --noEmit", build: "echo hi" } };
    const classic = weightSourceOf(packages);
    const berry = weightSourceOf(packages, [], { yarnBerry: true });
    expect(classifyHeavyCommand("yarn build", DEFAULT_KINDS, classic)).toBe("tsc");
    expect(classifyHeavyCommand("yarn run build", DEFAULT_KINDS, classic)).toBe("tsc");
    expect(classifyHeavyCommand("yarn build", DEFAULT_KINDS, berry)).toBeNull();
    expect(classifyHeavyCommand("yarn run build", DEFAULT_KINDS, berry)).toBeNull();
    // The flag is yarn's alone: bun, npm and pnpm read the hooks whatever the file says.
    for (const line of ["bun run build", "npm run build", "pnpm build"]) {
      expect([line, classifyHeavyCommand(line, DEFAULT_KINDS, berry)]).toEqual([line, "tsc"]);
    }
    // Berry still reads the script's own body.
    expect(
      classifyHeavyCommand(
        "yarn build",
        DEFAULT_KINDS,
        weightSourceOf({ "/repo": { build: "tsc" } }, [], { yarnBerry: true }),
      ),
    ).toBe("tsc");
  });

  test("a script that already queues itself is never routed again, whatever launcher it names", () => {
    // The queue nests on macOS and Windows: the inner job waits for its own parent's slot.
    const LAUNCHERS = [
      "cc-smart-dev-kit",
      '"$HOME/.local/bin/cc-smart-dev-kit"',
      "$HOME/.local/bin/cc-smart-dev-kit",
      "/usr/local/bin/cc-smart-dev-kit",
      "~/.local/bin/cc-smart-dev-kit",
    ];
    for (const launcher of LAUNCHERS) {
      const body = `${launcher} job run --kind tsc -- tsgo`;
      const source = weightSourceOf({ "/repo": { tsc: body, check: "bun run tsc" } });
      for (const line of ["bun run tsc", "bun tsc", "npm run tsc", "bun run check"]) {
        expect([launcher, line, classifyRoutableLine(line, DEFAULT_KINDS, source)]).toEqual([
          launcher,
          line,
          null,
        ]);
        expect([launcher, line, runWeight(line, DEFAULT_KINDS, source)]).toEqual([
          launcher,
          line,
          { weight: "none" },
        ]);
        // The any-heavy walk still reports the kind: the reservation and the hook's questions read it.
        expect([launcher, line, classifyHeavyCommand(line, DEFAULT_KINDS, source)]).toEqual([
          launcher,
          line,
          "tsc",
        ]);
      }
    }
    // The kind a caller may queue a line under: none for a line that queues itself, the kind
    // for the same script with a plain body.
    const own = weightSourceOf({ "/repo": { tsc: "cc-smart-dev-kit job run --kind tsc -- tsgo" } });
    expect(classifyUnqueuedHeavy("bun run tsc", DEFAULT_KINDS, own)).toBeNull();
    expect(
      classifyUnqueuedHeavy("cc-smart-dev-kit job run --kind tsc -- tsgo", DEFAULT_KINDS, own),
    ).toBeNull();
    expect(
      classifyUnqueuedHeavy(
        "bun run tsc",
        DEFAULT_KINDS,
        weightSourceOf({ "/repo": { tsc: "tsgo" } }),
      ),
    ).toBe("tsc");
    // The line itself, outside a script.
    const none = weightSourceOf({ "/repo": {} });
    const queued = "cc-smart-dev-kit job run --kind tsc -- bunx tsc --noEmit";
    expect(classifyRoutableLine(queued, DEFAULT_KINDS, none)).toBeNull();
    expect(runWeight(queued, DEFAULT_KINDS, none)).toEqual({ weight: "none" });
    expect(classifyRoutableLine(`cd app && ${queued}`, DEFAULT_KINDS, none)).toBeNull();
    // The same script with the tool alone in its body is routed, as the plan intends.
    expect(routed("bun run tsc", { tsc: "tsgo" })).toBe("tsc");
  });

  // The kit's command has one recogniser (`src/shell/kit-invocation.ts`): the queue's own line
  // is queued already under every spelling it knows, not only the bare name.
  test("a line that queues itself is queued already under every spelling of the kit's command", () => {
    const none = weightSourceOf({ "/repo": {} });
    for (const kit of [
      "cc-smart-dev-kit",
      "bunx cc-smart-dev-kit",
      "bun /opt/plugin/dist/cli.js",
      "sh /home/user/.local/bin/cc-smart-dev-kit",
      "/opt/plugin/bin/cc-smart-dev-kit-bun.sh /opt/plugin/dist/cli.js",
    ]) {
      // A heavy command beside the queue's own line: the line that queues itself decides.
      const line = `bun test && ${kit} job run --kind tsc -- tsc --noEmit`;
      expect([line, runWeight(line, DEFAULT_KINDS, none)]).toEqual([line, { weight: "none" }]);
      expect([line, classifyRoutableLine(line, DEFAULT_KINDS, none)]).toEqual([line, null]);
      expect([line, classifyUnqueuedHeavy(line, DEFAULT_KINDS, none)]).toEqual([line, null]);
    }
    // Another `job` command of the kit queues nothing: a heavy command beside it is still heavy.
    expect(
      classifyUnqueuedHeavy(
        "bunx cc-smart-dev-kit job status && tsc --noEmit",
        DEFAULT_KINDS,
        none,
      ),
    ).toBe("tsc");
    expect(runWeight("bunx tsc --noEmit", DEFAULT_KINDS, none)).toEqual({
      weight: "heavy",
      kind: "tsc",
    });
  });

  // The guards' recogniser leans toward yes (a guard asks or denies on it), and the queued flag
  // shares it: another tool whose bundle is a `dist/cli.js` with a `job run` command reads as the
  // kit, so the heavy line beside it runs without the queue. A missed queue, never a guard: one
  // recogniser for both (hooks-guards.md) is worth that.
  test("another tool's dist/cli.js job run reads as the kit's own: a missed queue, by design", () => {
    const none = weightSourceOf({ "/repo": {} });
    const line = "tsc --noEmit && bun node_modules/other-tool/dist/cli.js job run nightly";
    expect(runWeight(line, DEFAULT_KINDS, none)).toEqual({ weight: "none" });
    expect(classifyUnqueuedHeavy(line, DEFAULT_KINDS, none)).toBeNull();
  });

  test("a script named like a tool is read by its body, and the tool inside is the tool", () => {
    expect(routed("bun run tsc", { tsc: "tsc --noEmit" })).toBe("tsc");
    expect(routed("bun tsc --noEmit", { tsc: "tsc --noEmit" })).toBe("tsc");
    expect(routed("bun run vitest", { vitest: "vitest run" })).toBe("test:run");
  });

  test("a script that calls itself, or a loop of scripts, ends with no kind and no loop", () => {
    expect(anyHeavy("bun run a", { a: "bun run a" })).toBeNull();
    expect(routed("bun run a", { a: "bun run a" })).toBeNull();
    expect(anyHeavy("bun run a", { a: "bun run b", b: "bun run a" })).toBeNull();
    // A script that loops but also runs a heavy command: the any-heavy walk still finds it.
    expect(anyHeavy("bun run a", { a: "bun run a && tsc --noEmit" })).toBe("tsc");
    // The same script twice on one line is no loop.
    expect(routed("bun run t && bun run t", { t: "tsc --noEmit" })).toBe("tsc");
  });

  test("scripts calling scripts are followed to MAX_NESTING levels, and no further", () => {
    const chain = { s1: "bun run s2", s2: "bun run s3", s3: "tsc --noEmit" };
    expect(routed("bun run s1", chain)).toBe("tsc");
    const deep = { s1: "bun run s2", s2: "bun run s3", s3: "bun run s4", s4: "tsc --noEmit" };
    expect(routed("bun run s1", deep)).toBeNull();
    expect(anyHeavy("bun run s1", deep)).toBeNull();
  });

  test("a body the reader cannot read is no kind; no reader keeps the old answer", () => {
    expect(routed("bun run x", { x: "$(compute) --noEmit" })).toBeNull();
    expect(anyHeavy("bun run x", { x: "$(compute) --noEmit" })).toBeNull();
    expect(routed("bun run x", { x: "" })).toBeNull();
    // A name that is no script there is the package manager's tool, as before.
    expect(routed("bun run tsc --noEmit", { other: "tsc" })).toBe("tsc");
    expect(classifyRoutableLine("bun run typecheck", DEFAULT_KINDS)).toBeNull();
  });

  test("a runner's folder option moves the package folder", () => {
    const source = weightSourceOf({
      "/repo": { lint: "echo hi" },
      "/repo/app": { test: "vitest run" },
    });
    const at = (line: string) => classifyRoutableLine(line, DEFAULT_KINDS, source);
    for (const line of [
      "bun run --cwd app test",
      "bun --cwd app run test",
      "bun run --cwd=app test",
      "pnpm -C app test",
      "pnpm --dir app test",
      "pnpm --dir=app run test",
      "npm --prefix app test",
      "npm --prefix=app run test",
      "npm -C app run test",
      "yarn --cwd app test",
      "cd app && bun run test",
      "cd /repo/app && npm test",
    ]) {
      expect([line, at(line)]).toEqual([line, "test:run"]);
    }
    // Without the option, `test` is no script of the root: nothing to find.
    expect(at("bun run test")).toBeNull();
    expect(at("npm test")).toBeNull();
    // A folder the line does not name is no folder to read.
    expect(at("bun run --cwd $DIR test")).toBeNull();
  });

  test("the folder options are part of the tool call", () => {
    expect(toolOf("bun", ["run", "--cwd", "app", "test"])?.dir).toBe("app");
    expect(toolOf("pnpm", ["-C", "app", "test"])?.dir).toBe("app");
    expect(toolOf("npm", ["--prefix", "app", "run", "x"])?.dir).toBe("app");
    expect(toolOf("yarn", ["--cwd", "app", "x"])?.dir).toBe("app");
    expect(toolOf("bun", ["run", "test"])?.dir).toBeUndefined();
  });

  test("bun test is Bun's own runner: its options before and after `test` stay in the arguments", () => {
    expect(toolOf("bun", ["test", "./a.test.ts"])).toEqual({
      name: "bun",
      args: ["test", "./a.test.ts"],
    });
    expect(toolOf("bun", ["--bun", "test", "--watch"])?.args).toEqual(["test", "--bun", "--watch"]);
    // Every other Bun command of its own is still no tool call.
    for (const word of ["install", "add", "build", "pm", "x"]) {
      expect(classifyHeavyCommand(`bun ${word}`, DEFAULT_KINDS)).toBeNull();
    }
  });
});

describe("runWeight: light, heavy or none", () => {
  const FILES = [
    "/repo/a.test.ts",
    "/repo/app/a.test.ts",
    "/repo/src/a.ts",
    "/repo/b.test.ts",
    "/repo/app/src/a.ts",
  ];
  const weight = (line: string, packages: Record<string, Record<string, string> | null> = {}) =>
    runWeight(line, DEFAULT_KINDS, weightSourceOf({ "/repo": {}, ...packages }, FILES));
  const LIGHT = { weight: "light" } as const;
  const NONE = { weight: "none" } as const;
  const heavy = (kind: string) => ({ weight: "heavy", kind }) as const;

  test("e2e: every playwright test run takes a slot, a spec file too; the UI and the Inspector never", () => {
    expect(weight("bunx playwright test")).toEqual(heavy("e2e"));
    expect(weight("npx playwright test --project=chromium")).toEqual(heavy("e2e"));
    expect(weight("./node_modules/.bin/playwright test")).toEqual(heavy("e2e"));
    // `a.test.ts` exists: still a full run, it starts the app's web server and its browsers.
    expect(weight("bunx playwright test ./a.test.ts")).toEqual(heavy("e2e"));
    expect(weight("bunx playwright test a.test.ts:42 -g login")).toEqual(heavy("e2e"));
    expect(weight("bun run e2e", { "/repo": { e2e: "playwright test" } })).toEqual(heavy("e2e"));
    expect(weight("bunx playwright test --list")).toEqual(LIGHT);
    expect(weight("bunx playwright test --help")).toEqual(LIGHT);
    // They wait for a person, so a queued one would hold the slot for ever.
    expect(weight("bunx playwright test --ui")).toEqual(NONE);
    expect(weight("bunx playwright test --ui-port 0")).toEqual(NONE);
    expect(weight("bunx playwright test --debug")).toEqual(NONE);
    expect(weight("bunx playwright test --debug=cli a.test.ts")).toEqual(NONE);
    // Playwright's other commands are no test run.
    expect(weight("bunx playwright show-report")).toEqual(NONE);
    expect(weight("bunx playwright install chromium")).toEqual(NONE);
    expect(weight("bunx playwright codegen")).toEqual(NONE);
  });

  test("bun test: a file named with ./ or / is light; a filter, a bare name and bail are not", () => {
    expect(weight("bun test")).toEqual(heavy("test:run"));
    expect(weight("bun test ./a.test.ts")).toEqual(LIGHT);
    expect(weight("bun test /repo/a.test.ts")).toEqual(LIGHT);
    expect(weight("bun test ./a.test.ts ./b.test.ts")).toEqual(LIGHT);
    expect(weight("bun test --timeout 500 ./a.test.ts")).toEqual(LIGHT);
    expect(weight("bun test --concurrent ./a.test.ts")).toEqual(LIGHT);
    expect(weight("bun test a.test.ts")).toEqual(heavy("test:run"));
    expect(weight("bun test ./a.test.ts ./missing.test.ts")).toEqual(heavy("test:run"));
    expect(weight("bun test ./app")).toEqual(heavy("test:run"));
    // `--bail` takes an optional number: the file after it may be that value.
    expect(weight("bun test --bail ./a.test.ts")).toEqual(heavy("test:run"));
    expect(weight("bun test --bail=1 ./a.test.ts")).toEqual(LIGHT);
    expect(weight("bun test --someNewFlag ./a.test.ts")).toEqual(heavy("test:run"));
    expect(weight("bun test --coverage ./a.test.ts")).toEqual(heavy("test:coverage"));
    expect(weight("bun test --version")).toEqual(LIGHT);
  });

  test("a shell the route wraps a line in is read through, in the folder each command runs in", () => {
    expect(weight("zsh -c 'cd app && bunx vitest run a.test.ts'")).toEqual(LIGHT);
    expect(weight("bash -c 'cd app && bunx vitest run a.test.ts'")).toEqual(LIGHT);
    expect(weight("sh -c 'bunx vitest run a.test.ts'")).toEqual(LIGHT);
    expect(weight("zsh -c 'bunx vitest run'")).toEqual(heavy("test:run"));
    // `a.test.ts` is in `app`, not in `app/src`.
    expect(weight("zsh -c 'cd app/src && bunx vitest run a.test.ts'")).toEqual(heavy("test:run"));
    expect(weight("cd app && bunx vitest run a.test.ts")).toEqual(LIGHT);
    expect(weight("cd app && cd .. && bunx vitest run a.test.ts")).toEqual(LIGHT);
    // A `cd` inside a nested shell stays inside it: `b.test.ts` is in `/repo` only.
    expect(weight("bash -c 'cd app'; bunx vitest run b.test.ts")).toEqual(LIGHT);
    expect(weight("bash -c 'cd app && true' && cd app && bunx vitest run b.test.ts")).toEqual(
      heavy("test:run"),
    );
    // A folder the line does not name: the files cannot be checked.
    expect(weight("cd $DIR && bunx vitest run a.test.ts")).toEqual(heavy("test:run"));
  });

  test("tsc on named files is light; a project, a build, no operand and unknown options are not", () => {
    expect(weight("tsc --noEmit src/a.ts")).toEqual(LIGHT);
    expect(weight("bunx tsc --noEmit src/a.ts --pretty")).toEqual(LIGHT);
    expect(weight("tsc --target es2022 --noEmit src/a.ts")).toEqual(LIGHT);
    expect(weight("tsgo --noEmit src/a.ts")).toEqual(LIGHT);
    expect(weight("tsc --noEmit ./missing.ts")).toEqual(heavy("tsc"));
    expect(weight("tsc -p .")).toEqual(heavy("tsc"));
    expect(weight("tsc --project tsconfig.json")).toEqual(heavy("tsc"));
    expect(weight("tsc --build")).toEqual(heavy("tsc"));
    expect(weight("tsc -b src/a.ts")).toEqual(heavy("tsc"));
    expect(weight("tsc")).toEqual(heavy("tsc"));
    expect(weight("tsc --noEmit")).toEqual(heavy("tsc"));
    expect(weight("tsc --someNewFlag src/a.ts")).toEqual(heavy("tsc"));
    expect(weight("tsc -p . src/a.ts")).toEqual(heavy("tsc"));
  });

  test("a print-only option makes a run light, wherever it is among the arguments", () => {
    expect(weight("tsc --version")).toEqual(LIGHT);
    expect(weight("tsc --noEmit --version")).toEqual(LIGHT);
    expect(weight("tsc --version --noEmit")).toEqual(LIGHT);
    expect(weight("bunx vitest --help")).toEqual(LIGHT);
    expect(weight("tsc --noEmit --version && tsc --noEmit")).toEqual(heavy("tsc"));
  });

  test("a watch run never ends: it is none, never queued", () => {
    for (const line of [
      "bunx vitest --watch",
      "bunx vitest -w",
      "bunx vitest watch",
      "bunx vitest dev",
      "bunx vitest run --watch",
      "bun test --watch",
      "bun --watch test",
      "jest --watch",
      "jest --watchAll",
      "tsc --watch",
      "tsc -w --noEmit",
      "tsc --noEmit -W",
      "bun run test --watch",
    ]) {
      expect([line, weight(line, { "/repo": { test: "vitest run" } })]).toEqual([line, NONE]);
    }
    // `-w` is vitest's watch flag and jest's worker count: each read for its own tool.
    expect(weight("jest -w 2 ./a.test.ts")).toEqual(LIGHT);
    expect(weight("jest --watch=false ./a.test.ts")).toEqual(LIGHT);
  });

  test("a line with no heavy command is none", () => {
    for (const line of [
      "ls",
      "echo tsc --noEmit",
      "git status",
      "bun install",
      "bunx biome check .",
    ]) {
      expect([line, weight(line)]).toEqual([line, NONE]);
    }
  });

  test("light only when every heavy command is light; the first heavy kind otherwise", () => {
    expect(weight("tsc --noEmit src/a.ts && bunx vitest run a.test.ts")).toEqual(LIGHT);
    expect(weight("tsc --noEmit src/a.ts && tsc --noEmit")).toEqual(heavy("tsc"));
    expect(weight("tsc --noEmit src/a.ts && next build")).toEqual(heavy("build"));
    expect(weight("tsc --version && bunx vitest run")).toEqual(heavy("test:run"));
    // Light needs every command of the line understood: one the reader does not know may be
    // the heavy work (a build script, `make`), so the line keeps its slot.
    expect(weight("bunx vitest run a.test.ts && rm -f x")).toEqual(heavy("test:run"));
  });

  // Vitest's docs call `--ui` a watch-mode feature, but the route only sees the Bash tool's
  // calls, whose stdin is no terminal, and there Vitest falls back to a single run: run on
  // Vitest 3.2.7 (stdin from /dev/null), `vitest --ui`, `vitest run --ui` and `vitest --ui --run`
  // each print the report and exit 0. So `--ui` is no watch flag for Vitest, and it keeps a slot.
  test("vitest --ui ends when it has no terminal: it is a full run, not a watch run", () => {
    expect(weight("bunx vitest --ui")).toEqual(heavy("test:run"));
    expect(weight("bunx vitest run --ui")).toEqual(heavy("test:run"));
    expect(weight("bunx vitest --watch")).toEqual(NONE);
  });

  test("a line is light only when every command in it is understood", () => {
    // The finding: a shell string with a light run and an unknown command.
    expect(weight("sh -c 'bunx vitest run a.test.ts && make all'")).toEqual(heavy("test:run"));
    expect(weight("bunx vitest run a.test.ts && make all")).toEqual(heavy("test:run"));
    expect(weight("bunx vitest run a.test.ts && ./build.sh")).toEqual(heavy("test:run"));
    expect(weight("node scripts/heavy.js && bunx vitest run a.test.ts")).toEqual(heavy("test:run"));
    expect(weight("bunx tsc --noEmit src/a.ts; node scripts/heavy.js")).toEqual(heavy("tsc"));
    // What it understands: a cd, an assignment, a print-only run, a read-only filter, and a
    // script followed into its body.
    expect(weight("cd app && bunx vitest run a.test.ts")).toEqual(LIGHT);
    expect(weight("CI=1 bunx vitest run a.test.ts")).toEqual(LIGHT);
    expect(weight("bun test ./a.test.ts 2>&1 | tail -20")).toEqual(LIGHT);
    expect(weight("tsc --version && bunx vitest run a.test.ts")).toEqual(LIGHT);
    expect(weight("sh -c 'cd app && bunx vitest run a.test.ts'")).toEqual(LIGHT);
    expect(weight("bun run test a.test.ts", { "/repo": { test: "vitest run" } })).toEqual(LIGHT);
    // A filter that is not read-only is no filter.
    expect(weight("bun test ./a.test.ts | tee out.txt")).toEqual(heavy("test:run"));
  });

  test("several heavy runs sent to the background are heavy; one is not", () => {
    expect(weight("bunx vitest run a.test.ts &")).toEqual(LIGHT);
    expect(weight("tsc --noEmit src/a.ts & bunx vitest run a.test.ts &")).toEqual(heavy("tsc"));
    expect(weight("tsc --noEmit src/a.ts & bunx vitest run a.test.ts")).toEqual(heavy("tsc"));
    expect(weight("zsh -c 'tsc --noEmit src/a.ts & tsc --noEmit src/a.ts &'")).toEqual(
      heavy("tsc"),
    );
    // `&&` and `2>&1` are no background.
    expect(weight("tsc --noEmit src/a.ts 2>&1 && tsc --noEmit src/a.ts >/dev/null 2>&1")).toEqual(
      LIGHT,
    );
    // `|&` is a pipe, not a background: the filter after it is no command the route accepts
    // (the reader does not call it a pipe), so the line keeps its slot for that reason, not for
    // a background run.
    expect(weight("tsc --noEmit src/a.ts |& tail -3 && tsc --noEmit src/a.ts")).toEqual(
      heavy("tsc"),
    );
    // A piped reader with no file word is glue, so the line stays light.
    expect(weight("tsc --noEmit src/a.ts | tail -3 && tsc --noEmit src/a.ts")).toEqual(LIGHT);
  });

  test("a kind's tool decides the options: vitest, jest, tsc and bun each read their own", () => {
    expect(weight("bunx vitest run --project api a.test.ts")).toEqual(LIGHT);
    expect(weight("bunx vitest run --reporter=dot -t adds a.test.ts")).toEqual(LIGHT);
    expect(weight("bunx vitest run --config vitest.config.ts a.test.ts")).toEqual(LIGHT);
    expect(weight("bunx vitest run --shuffle a.test.ts")).toEqual(heavy("test:run"));
    expect(weight("npx jest --ci --runInBand a.test.ts")).toEqual(LIGHT);
    expect(weight("npx jest --config jest.config.js a.test.ts")).toEqual(LIGHT);
    expect(weight("npx jest --setupFilesAfterEnv setup.ts a.test.ts")).toEqual(heavy("test:run"));
    // An option no table knows is a full run.
    expect(weight("npx jest --brandNew a.test.ts")).toEqual(heavy("test:run"));
  });

  test("a project's script rule keeps the shared tables, whatever tool is behind it", () => {
    const kinds = mergeKinds({
      unit: { match: [{ script: "unit" }], noSlotForFiles: true, skipWords: ["run"] },
    });
    const source = weightSourceOf({ "/repo": { unit: "vitest run" } }, FILES);
    expect(runWeight("bun run unit a.test.ts", kinds, source)).toEqual(LIGHT);
    expect(runWeight("bun run unit --project api a.test.ts", kinds, source)).toEqual(LIGHT);
    expect(runWeight("bun run unit", kinds, source)).toEqual(heavy("unit"));
    expect(runWeight("bun run unit --shuffle a.test.ts", kinds, source)).toEqual(heavy("unit"));
    // The shared table, as before: `-w` is a valued option there.
    expect(runWeight("bun run unit -w 2 a.test.ts", kinds, source)).toEqual(LIGHT);
  });

  test("a script run by body: extra arguments go to a one-command body", () => {
    const test = { "/repo": { test: "vitest run" } };
    expect(weight("bun run test", test)).toEqual(heavy("test:run"));
    expect(weight("bun run test a.test.ts", test)).toEqual(LIGHT);
    expect(weight("npm test -- a.test.ts", test)).toEqual(LIGHT);
    expect(weight("npm run test -- ./missing.test.ts", test)).toEqual(heavy("test:run"));
    expect(weight("bun run test --reporter=dot a.test.ts", test)).toEqual(LIGHT);
    // A body of several commands is never light, with or without arguments.
    expect(
      weight("bun run test a.test.ts", { "/repo": { test: "echo start && vitest run" } }),
    ).toEqual(heavy("test:run"));
    expect(
      weight("bun run test a.test.ts", { "/repo": { pretest: "echo", test: "vitest run" } }),
    ).toEqual(heavy("test:run"));
    expect(weight("bun run test a.test.ts", { "/repo": { test: "bash -c 'vitest run'" } })).toEqual(
      heavy("test:run"),
    );
    // A typecheck script: tsc with no files is a full run, and print-only still is not.
    const typecheck = { "/repo": { typecheck: "tsc --noEmit" } };
    expect(weight("bun run typecheck", typecheck)).toEqual(heavy("tsc"));
    expect(weight("bun run typecheck src/a.ts", typecheck)).toEqual(LIGHT);
    expect(weight("bun run typecheck --version", typecheck)).toEqual(LIGHT);
    expect(weight("bun run lint", { "/repo": { lint: "biome check ." } })).toEqual(NONE);
  });

  // A package runner takes a `--` for itself and hands the script what follows it. Run for real
  // (a script that prints its argv): Bun 1.4.4 and Yarn 2+ (3.8.7, 4.9.2) drop a `--` that comes
  // first (`s -- --ui` gives `--ui`, `s a -- --ui` gives `a -- --ui`); Yarn 1.22.22 drops the
  // first one anywhere (`s a -- --ui` gives `a --ui`); pnpm 7 to 10 keep it (`s -- --ui` gives
  // `-- --ui`). npm: its docs, `npm run <command> [-- <args>]`, and a flag before the `--` is
  // npm's own.
  test("the `--` a package runner drops is not the script's: a watch flag behind it is seen", () => {
    const e2e = { "/repo": { e2e: "playwright test", test: "vitest run" } };
    expect(weight("bun run e2e -- --ui", e2e)).toEqual(NONE);
    expect(weight("bun e2e -- --ui", e2e)).toEqual(NONE);
    expect(weight("bun run test -- --watch", e2e)).toEqual(NONE);
    expect(weight("npm run e2e -- --ui", e2e)).toEqual(NONE);
    expect(weight("npm run e2e --silent -- --debug", e2e)).toEqual(NONE);
    // npm's `--` ends its own options wherever it stands; Bun's only when it comes first.
    expect(weight("npm run e2e a.test.ts -- --ui", e2e)).toEqual(NONE);
    expect(weight("bun run e2e a.test.ts -- --ui", e2e)).toEqual(heavy("e2e"));
    // Yarn 1 drops it anywhere, Yarn 2+ only first.
    expect(weight("yarn run e2e -- --ui", e2e)).toEqual(NONE);
    expect(weight("yarn run e2e a.test.ts -- --ui", e2e)).toEqual(NONE);
    const berry = weightSourceOf(e2e, FILES, { yarnBerry: true });
    expect(runWeight("yarn run e2e -- --ui", DEFAULT_KINDS, berry)).toEqual(NONE);
    expect(runWeight("yarn run e2e a.test.ts -- --ui", DEFAULT_KINDS, berry)).toEqual(heavy("e2e"));
    // pnpm passes it on: the flag is behind the script's own `--`, a positional word to it,
    // so the run is a full one.
    expect(weight("pnpm run e2e -- --ui", e2e)).toEqual(heavy("e2e"));
    // npm keeps a flag written before the `--` for itself: the plain script runs.
    expect(weight("npm run e2e --ui", e2e)).toEqual(heavy("e2e"));
    expect(weight("npm test --watch", e2e)).toEqual(heavy("test:run"));
    expect(weight("npm run test --silent a.test.ts", e2e)).toEqual(LIGHT);
    // Without a flag after it, a `--` changes nothing.
    expect(weight("bun run e2e --", e2e)).toEqual(heavy("e2e"));
    expect(weight("bun run test -- ./a.test.ts", e2e)).toEqual(LIGHT);
    expect(weight("bun run test -- ./missing.test.ts", e2e)).toEqual(heavy("test:run"));
    expect(weight("npm run test -- ./a.test.ts", e2e)).toEqual(LIGHT);
    expect(weight("pnpm run test -- ./a.test.ts", e2e)).toEqual(LIGHT);
    // A name that is no script is the tool, and its `--` stays the tool's.
    expect(weight("bun run vitest -- --watch")).toEqual(heavy("test:run"));
  });

  test("a script's files are read in its package folder, found by walking up", () => {
    const source = weightSourceOf(
      { "/repo/app": { test: "vitest run" } },
      ["/repo/app/a.test.ts"],
      {
        folder: "/repo/app/src",
        packageAt: { "/repo/app/src": "/repo/app" },
      },
    );
    // The script runs in `/repo/app`, whatever folder the line started in.
    expect(runWeight("bun run test a.test.ts", DEFAULT_KINDS, source)).toEqual(LIGHT);
    expect(runWeight("bun run test src/a.test.ts", DEFAULT_KINDS, source)).toEqual(
      heavy("test:run"),
    );
  });

  test("a runner's folder option moves the folder a tool's files are read in", () => {
    // `a.test.ts` is in `/repo` and `/repo/app`; `b.test.ts` in `/repo` only.
    expect(weight("pnpm -C app vitest run a.test.ts")).toEqual(LIGHT);
    expect(weight("pnpm -C app vitest run b.test.ts")).toEqual(heavy("test:run"));
    expect(weight("pnpm --dir app vitest run b.test.ts")).toEqual(heavy("test:run"));
    expect(weight("pnpm vitest run b.test.ts")).toEqual(LIGHT);
    expect(weight("bun run --cwd app vitest run b.test.ts")).toEqual(heavy("test:run"));
    expect(weight("bun run --cwd app vitest run a.test.ts")).toEqual(LIGHT);
    expect(weight("npm --prefix app exec vitest run b.test.ts")).toEqual(LIGHT);
    // A script rule's files are read in the package folder the script runs in.
    const kinds = mergeKinds({ unit: { match: [{ script: "unit" }], noSlotForFiles: true } });
    const source = weightSourceOf({ "/repo/app": { unit: "vitest run" } }, FILES);
    expect(runWeight("bun run --cwd app unit a.test.ts", kinds, source)).toEqual(LIGHT);
    expect(runWeight("bun run --cwd app unit b.test.ts", kinds, source)).toEqual(heavy("unit"));
  });

  test("`&>file` is one redirection: the run still names only its files", () => {
    expect(weight("tsc --noEmit src/a.ts &>/dev/null")).toEqual(LIGHT);
    expect(weight("tsc --noEmit src/a.ts &>> build.log")).toEqual(LIGHT);
    expect(weight("tsc --noEmit src/a.ts &> out.txt")).toEqual(LIGHT);
    expect(weight("bunx vitest run a.test.ts &>/dev/null")).toEqual(LIGHT);
    expect(weight("tsc --noEmit &>/dev/null")).toEqual(heavy("tsc"));
    // The `&` of `&>` is no background.
    expect(weight("tsc --noEmit src/a.ts &>/dev/null && tsc --noEmit src/a.ts")).toEqual(LIGHT);
  });

  test("cross-env, env and a wrapper in front of a tool are read through", () => {
    expect(weight("cross-env NODE_ENV=test jest")).toEqual(heavy("test:run"));
    expect(weight("cross-env NODE_ENV=test jest ./a.test.ts")).toEqual(LIGHT);
    expect(
      weight("bun run test a.test.ts", { "/repo": { test: "cross-env CI=1 vitest run" } }),
    ).toEqual(LIGHT);
  });

  test("the route's line rule still decides what is routable; a light line is told apart", () => {
    // `routableLine` knows the kind and says nothing about weight: `runWeight` does.
    const line = "bunx vitest run a.test.ts";
    expect(classifyRoutableLine(line, DEFAULT_KINDS)).toBe("test:run");
    expect(weight(line)).toEqual(LIGHT);
    expect(weight("bunx vitest run")).toEqual(heavy("test:run"));
    // A mixed line is not routable, and its heavy part still has a weight.
    expect(classifyRoutableLine("rm x && bunx vitest run", DEFAULT_KINDS)).toBeNull();
    expect(weight("rm x && bunx vitest run")).toEqual(heavy("test:run"));
  });
});

describe("sedScriptReadsOnly", () => {
  test("prints, deletes, quits and substitutions without w or e are read-only", () => {
    for (const script of [
      "p",
      "1,20p",
      "$p",
      "/x/,/y/d",
      "5q",
      "Q3",
      "s/a/b/g",
      "s|a|b|2",
      "y/ab/cd/",
      "1~2p",
      "/a/!d",
      "/x/{p;q}",
      // Plain brackets, and an escaped `\[`, read the same in GNU and BSD sed.
      "s/[0-9]//g",
      "/[a-z]/p",
      "s/[^ ]*$//",
      "s/\\[x\\]//",
    ]) {
      expect([script, sedScriptReadsOnly(script)]).toEqual([script, true]);
    }
  });

  test("w, e, r, a and anything unread are not", () => {
    for (const script of [
      "w out",
      "s/a/b/w out",
      "s/a/b/e",
      "1e ls",
      "r x",
      "a text",
      "b",
      ":a",
      "s/a/b",
      "1,p",
      // Review #4: a bracket two seds read differently.
      "s/[/]/;/w x/p",
      "/[/]/p",
      "s/[]x]//",
      "s/[^]x]//",
      "s/[[:digit:]]//",
      "s/[\\/]//",
      "s/[a//",
    ]) {
      expect([script, sedScriptReadsOnly(script)]).toEqual([script, false]);
    }
  });
});

// A mixed line (`bun run check; echo "exit $?"`) is queued whole when everything beside the
// heavy commands is harmless glue (`GLUE_COMMANDS`, the readers of `READ_ONLY_FILTERS`, the
// structure of `{ … }` and `( … )`). Any other mix is no routable line (`mixedHeavyLine` then
// says what to refuse). Every expected value here is written by hand.
describe("routableLine: harmless glue rides in the queued line", () => {
  const SCRIPTS = {
    "/repo": { check: "tsc --noEmit", test: "vitest run" },
    "/repo/portal": { test: "vitest run" },
  };
  /** The start of a `${…}` parameter expansion, so a test string holds no template placeholder. */
  const BRACE = "${";
  const line = (command: string) => routableLine(command, DEFAULT_KINDS, weightSourceOf(SCRIPTS));
  const queuedWhole = (command: string, kind: string) =>
    expect(line(command)).toEqual({ filters: "", heavy: command, kind });

  test("an echo after a script: the exit code line a builder adds", () => {
    queuedWhole('bun run check; echo "exit $?"', "tsc");
  });

  test("an echo before a test run, and a group whose output goes to a file", () => {
    queuedWhole("echo start && bun test", "test:run");
    queuedWhole("{ echo a; bun test; } > out.log 2>&1", "test:run");
    queuedWhole("{ bunx tsc --noEmit; } > out.log 2>&1", "tsc");
  });

  test("a subshell with a cd, read in the folder it moves to", () => {
    queuedWhole("( cd portal && bun run test )", "test:run");
  });

  // A redirection-only step is the structure of a group, but `$(< .env)` reads and prints the
  // file: inside the queue's shell string Claude Code's Read rules would not see the `<` target.
  test("a substitution that reads a file is no structure: the line is not queued", () => {
    expect(line('bun test; echo "$(< .env)"')).toBeNull();
    expect(line('bun test; X=$(< .env); echo "$X"')).toBeNull();
    expect(line("bun test; echo `< .env`")).toBeNull();
    expect(line("{ bun test; } 0<.env")).toBeNull();
    expect(line("{ bun test; } <> .env")).toBeNull();
  });

  test("a group whose input is /dev/null is still structure: it reads nothing", () => {
    queuedWhole("{ bun test; } < /dev/null", "test:run");
    queuedWhole("( bunx tsc --noEmit ) </dev/null", "tsc");
    queuedWhole("{ bun test; } 0</dev/null > out.log 2>&1", "test:run");
  });

  test("a reader that reads the pipe: no file word, so no Read rule is hidden", () => {
    queuedWhole("bun test 2>&1 | tail -5; echo done", "test:run");
    queuedWhole("bun test 2>&1 | head -20; echo done", "test:run");
    queuedWhole("bun test | wc -l; echo done", "test:run");
    queuedWhole("bun test | cat; echo done", "test:run");
    queuedWhole("bun test | grep -E 'fail|error'; echo done", "test:run");
    queuedWhole("bun test | cut -d: -f1; echo done", "test:run");
    queuedWhole("bun test | tr -d '\\r'; echo done", "test:run");
    queuedWhole("bun test | grep -e a -e b; echo done", "test:run");
    queuedWhole("bun test | tail -n 5; echo done", "test:run");
  });

  test("a reader that names a file is no glue: a Read deny rule looks at that word", () => {
    for (const reader of [
      "tail -5 out.log",
      "cat out.log",
      "cat .env",
      "wc -l out.log",
      'grep -E x "$OUT"',
      "head -3 $OUT",
      "grep x out.log",
      "grep -e x out.log",
      "sed -n 1p out.log",
      "sort out.log",
      "uniq in out",
      "awk '{print $1}' out.log",
    ]) {
      // Beside the heavy run with no pipe, and fed by a pipe with the file word in it.
      expect([reader, line(`bun test; ${reader}`)]).toEqual([reader, null]);
      expect([reader, line(`bun test | ${reader}; echo done`)]).toEqual([reader, null]);
    }
  });

  test("an option that makes a reader read a file counts by any start, as GNU takes it", () => {
    for (const reader of [
      "sort --files0-from=-",
      "sort --files0=-",
      "sort --files0 -",
      "sort --file=-",
      "wc --files0-f=-",
      "grep --rec x",
      "grep --recursive x",
      "grep --dereference-recursive x",
      "grep --dereference-rec x",
      "grep --file=patterns x",
      "grep --fil patterns x",
      "grep --exclude-from=list x",
      "grep --exclude-f=list x",
      "grep --direct=recurse x",
    ]) {
      expect([reader, line(`bun test | ${reader}; echo done`)]).toEqual([reader, null]);
    }
    // Options that only look alike stay glue.
    queuedWhole("bun test | grep --files-with-matches x; echo done", "test:run");
    queuedWhole("bun test | grep --include=x y; echo done", "test:run");
    queuedWhole("bun test | sort --reverse; echo done", "test:run");
  });

  test("a reader with no pipe, an input redirection, or a search of the folder is no glue", () => {
    for (const reader of [
      "tail -5",
      "cat",
      "cat < .env",
      "grep x < .env",
      "grep -r x",
      "grep -rn x",
      "grep -f patterns x",
      "grep --recursive x",
      "wc --files0-from=list",
      "sort --files0-from=list",
      "rg x",
      "sed -f script",
      "/usr/bin/tail -5",
    ]) {
      expect([reader, line(`bun test; ${reader}`)]).toEqual([reader, null]);
    }
    expect(line("bun test | cat < .env; echo done")).toBeNull();
    expect(line("bun test | cat <.env; echo done")).toBeNull();
    expect(line("bun test | grep -r x; echo done")).toBeNull();
    // A here-doc or here-string is no file.
    queuedWhole("bun test | cat <<< hi; echo done", "test:run");
  });

  test("the readers that read their own script or options need the real words", () => {
    queuedWhole("bun test | sed -n '1,5p'; echo done", "test:run");
    queuedWhole("bun test | sed -n -e '/x/p' -e '$p'; echo done", "test:run");
    queuedWhole("bun test | awk '{print $1}'; echo done", "test:run");
    queuedWhole("bun test | awk -F: -v n=2 'NR<n {print}'; echo done", "test:run");
    queuedWhole("bun test | sort -u; echo done", "test:run");
    queuedWhole("bun test | uniq -c; echo done", "test:run");
    // A word the shell fills in could be a script, an option or a file.
    for (const reader of [
      'sed -n "$P"',
      'awk "$P"',
      'sort "$F"',
      'uniq "$F"',
      'tee "$F"',
      'grep "$P"',
    ]) {
      expect([reader, line(`bun test | ${reader}; echo done`)]).toEqual([reader, null]);
    }
    // `rg` searches the folder when nothing is piped, and has no listed shape.
    expect(line("bun test | rg x; echo done")).toBeNull();
  });

  test("tee is glue only with no file, as in the filter rule", () => {
    queuedWhole("bun test | tee; echo done", "test:run");
    expect(line("bun test | tee out.log; echo x")).toBeNull();
    expect(line("bun test | tee /dev/null; echo x")).toBeNull();
    expect(line("bun test; tee")).toBeNull();
  });

  test("glue that runs code: a subscript or an arithmetic expansion", () => {
    for (const code of [
      "test -v 'a[$(rm -rf x)]'",
      "[ -v 'a[$(rm -rf x)]' ]",
      "[ -R x ]",
      "test -R 'a[$(rm -rf x)]'",
      "printf -v 'a[$(rm -rf x)]' y",
      "printf -- '%s' x",
      'printf "$F" x',
      "echo $((X))",
      "echo $[X]",
      `echo ${BRACE}a[X]}`,
      `echo ${BRACE}X:1}`,
      // An indirect expansion and a prompt expansion run the value as code.
      `echo ${BRACE}!X}`,
      `echo ${BRACE}X@P}`,
      `echo ${BRACE}X@Q}`,
      "echo $(( $(pwd) ))",
      "echo $((1+1))",
    ]) {
      expect([code, line(`bun test; ${code}`)]).toEqual([code, null]);
    }
    // A test with a word the shell fills in can be `-v` itself.
    expect(line('bun test; [ -d "$DIR" ]')).toBeNull();
    expect(line("bun test; test $? -eq 0")).toBeNull();
    // The harmless forms stay glue.
    queuedWhole("bun test; printf '%s\\n' x $HOME", "test:run");
    queuedWhole(`bun test; echo ${BRACE}X:-default}`, "test:run");
    queuedWhole(`bun test; echo $HOME ${BRACE}#X}`, "test:run");
    queuedWhole("bun test; [ -f out.log ] && echo yes", "test:run");
  });

  test("a shell that takes its script from the pipe is never pure: the text is no promise", () => {
    // The reader gives `\\n` as a space, and `sh` runs two commands.
    for (const piped of [
      "printf 'bunx tsc --noEmit\\nrm -rf x' | sh",
      "printf 'bunx tsc --noEmit\\012rm -rf x' | sh",
      "printf '%b' 'bunx tsc --noEmit\\nrm -rf x' | sh",
      "echo 'bunx tsc --noEmit\\nrm -rf x' | sh",
      "echo 'bunx tsc --noEmit' | sh",
      "echo 'bunx tsc --noEmit' | bash",
    ]) {
      expect([piped, line(piped)]).toEqual([piped, null]);
      expect([piped, line(`bun test; ${piped}`)]).toEqual([piped, null]);
    }
    // A shell with its script in `-c` is still read.
    queuedWhole("echo go | bash -c 'bunx tsc --noEmit'", "tsc");
  });

  test("glue that writes a file with >&, attached or apart, is no glue", () => {
    expect(line("bun test; echo x >& out.txt")).toBeNull();
    expect(line("bun test; echo x >&out.txt")).toBeNull();
    expect(line("bun test; echo x &> out.txt")).toBeNull();
    queuedWhole("bun test; echo x >&2", "test:run");
    queuedWhole("bun test; echo x 2>&1", "test:run");
    queuedWhole("bun test; echo x >& /dev/null", "test:run");
  });

  test("a trailing filter is still cut off the queued part", () => {
    expect(line("bun test 2>&1 | tee")).toEqual({
      filters: "| tee",
      heavy: "bun test 2>&1",
      kind: "test:run",
    });
  });

  test("every command of the glue table, with expansions in its words", () => {
    for (const glue of [
      "echo hi",
      'echo "exit $?"',
      "printf '%s\\n' $HOME",
      "true",
      "false",
      ":",
      "pwd",
      "test -d node_modules",
      "[ -d node_modules ]",
    ]) {
      queuedWhole(`bun test; ${glue}`, "test:run");
    }
  });

  test("glue alone is not a line to queue: there must be a heavy command", () => {
    for (const only of ["echo hi", "cat out.log", "[ -d x ] && echo y", "{ echo a; } > out.log"]) {
      expect([only, line(only)]).toEqual([only, null]);
    }
  });

  test("a command that is not glue keeps the line raw, with the heavy command beside it", () => {
    for (const other of [
      "git status --short",
      "rm -f out.log",
      "bun install",
      "claude plugin validate plugin --strict",
      "ls",
      "sudo echo x",
      "FOO=1 echo x",
      "/bin/echo x",
      "echo x | xargs rm",
      "watch echo x",
      "bunx tsc --version",
    ]) {
      expect([other, line(`bun test; ${other}`)]).toEqual([other, null]);
    }
  });

  test("a substitution in glue is its own command, judged on its own", () => {
    expect(line("echo $(rm -rf x) && bun test")).toBeNull();
    expect(line("bun test; echo `rm -f x`")).toBeNull();
    expect(line("bun test; grep x $(rm -f x)")).toBeNull();
    // Harmless inside: still glue.
    queuedWhole("bun test; echo $(pwd)", "test:run");
  });

  test("glue that writes a file, or a group that holds a command that is not glue", () => {
    expect(line("bun test; echo done > status.txt")).toBeNull();
    expect(line("bun test; echo done >> status.txt")).toBeNull();
    expect(line("bun test; tail -5 out.log > last.txt")).toBeNull();
    queuedWhole("bun test; echo done > /dev/null", "test:run");
    expect(line("{ bun test; git status; } > out.log 2>&1")).toBeNull();
    expect(line("( cd portal && bun run test; claude plugin validate x )")).toBeNull();
  });

  test("the test for a missing directory, then an install: the install is not glue", () => {
    expect(line("[ -d node_modules ] || bun install && bun test")).toBeNull();
    queuedWhole("[ -d node_modules ] || echo missing; bun test", "test:run");
  });

  test("a script whose own body holds glue is read the same way", () => {
    const source = weightSourceOf({ "/repo": { build: "echo building && tsc --noEmit" } });
    expect(routableLine("bun run build", DEFAULT_KINDS, source)?.kind).toBe("tsc");
  });

  test("the split line a refusal suggests is routable (no refusal loop)", () => {
    queuedWhole("bun run check > log 2>&1", "tsc");
    queuedWhole("bun test 2>&1", "test:run");
    expect(line("bun run check 2>&1 | tail -20")).toEqual({
      filters: "| tail -20",
      heavy: "bun run check 2>&1",
      kind: "tsc",
    });
  });
});

describe("runWeight: glue beside a light run keeps it light", () => {
  const source = (files: readonly string[] = ["/repo/a.test.ts"]) => weightSourceOf({}, files);
  test("a run on a file that exists, then an echo or a reader: light", () => {
    for (const line of [
      "bun test ./a.test.ts; echo done",
      "echo start && bun test ./a.test.ts",
      "bun test ./a.test.ts 2>&1 | tail -5; echo done",
      "{ bun test ./a.test.ts; } > out.log 2>&1",
    ]) {
      expect([line, runWeight(line, DEFAULT_KINDS, source())]).toEqual([line, { weight: "light" }]);
    }
  });

  test("a command that is not glue still makes the line heavy, and a full run is heavy", () => {
    expect(runWeight("bun test ./a.test.ts; git status", DEFAULT_KINDS, source())).toEqual({
      kind: "test:run",
      weight: "heavy",
    });
    expect(runWeight("bun test; echo done", DEFAULT_KINDS, source())).toEqual({
      kind: "test:run",
      weight: "heavy",
    });
  });
});

describe("mixedHeavyLine: heavy work beside commands that are not glue", () => {
  const source = (
    packages: Record<string, Record<string, string>> = {},
    files: readonly string[] = [],
  ) => weightSourceOf({ "/repo": {}, ...packages }, files);
  const mixed = (command: string, s: WeightSource = source()) =>
    mixedHeavyLine(command, DEFAULT_KINDS, s);

  test("names the heavy kind, the heavy step and the first command that is not glue", () => {
    expect(mixed("bun test; git status --short")).toEqual({
      kind: "test:run",
      other: "git status --short",
      run: "bun test",
    });
    expect(mixed("echo start; bunx tsc --noEmit && git commit -m x")).toEqual({
      kind: "tsc",
      other: "git commit -m x",
      run: "bunx tsc --noEmit",
    });
  });

  test("a script is the heavy step, as the line wrote it", () => {
    const check = source({ "/repo": { check: "tsc --noEmit" } });
    expect(mixed("bun run check && claude plugin validate plugin --strict", check)).toEqual({
      kind: "tsc",
      other: "claude plugin validate plugin --strict",
      run: "bun run check",
    });
  });

  test("a substitution in glue, a tee with a file, an install, a print-only run", () => {
    expect(mixed("echo $(rm -rf x) && bun test")?.other).toBe("rm -rf x");
    expect(mixed("bun test | tee out.log && ls")?.other).toBe("tee out.log");
    expect(mixed("[ -d node_modules ] || bun install && bun test")?.other).toBe("bun install");
    expect(mixed("bun test; bunx tsc --version")?.other).toBe("bunx tsc --version");
  });

  test("a heavy run in a shell fed by a pipe is named by its kind only", () => {
    // The text the reader gives for the pipe's input is a guess, so it is never quoted.
    expect(mixed("printf 'bunx tsc --noEmit\\nrm -rf x' | sh")).toEqual({
      kind: "tsc",
      other: "sh",
      run: null,
    });
    expect(mixed("bun test; printf 'bunx tsc --noEmit' | sh")?.run).toBe("bun test");
  });

  test("a shell string is read too: its inner commands can be split by the person", () => {
    expect(mixed("bash -c 'bunx tsc --noEmit && rm -f x'")?.other).toBe("rm -f x");
  });

  test("nothing to refuse: a line the route queues, a heavy command alone, no heavy command", () => {
    for (const line of [
      "bun test",
      'bun test; echo "exit $?"',
      "bun test 2>&1 | tail -20",
      "git status && ls",
      "echo hi",
    ]) {
      expect([line, mixed(line)]).toEqual([line, null]);
    }
  });

  test("a run that takes no slot is not refused: a light run, a watch run, a queued line", () => {
    const files = source({}, ["/repo/a.test.ts"]);
    expect(mixed("bun test ./a.test.ts; git status", files)).toBeNull();
    expect(mixed("bun test --watch; git status")).toBeNull();
    expect(mixed("bunx vitest --watch && rm x")).toBeNull();
    expect(mixed("cc-smart-dev-kit job run --kind test:run -- bun test; git status")).toBeNull();
  });

  test("a script whose own body cannot be split is not refused: the person cannot fix it", () => {
    const mixedBody = source({ "/repo": { check: "tsc --noEmit && rm -rf dist" } });
    expect(mixed("bun run check", mixedBody)).toBeNull();
    expect(mixed("bun run check && git status", mixedBody)).toBeNull();
  });
});
