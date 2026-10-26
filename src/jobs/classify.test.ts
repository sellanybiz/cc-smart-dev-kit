/**
 * `classifyHeavyCommand` (`classify.ts`): which kind a Bash command runs, behind the
 * common runners and wrappers, and never a tool that is only named (in quotes, an echo, a
 * here-doc, a commit message). Every expected kind is written by hand.
 */
import { describe, expect, test } from "bun:test";
import {
  classifyHeavyCommand,
  classifyRoutableLine,
  routableLine,
  type ScriptSource,
  sedScriptReadsOnly,
  toolCallOfArgv,
  toolName,
} from "./classify";
import { DEFAULT_KINDS, mergeKinds } from "./kinds";

const kindOf = (command: string) => classifyHeavyCommand(command, DEFAULT_KINDS);

function expectKind(kind: string, commands: string[]): void {
  for (const command of commands) {
    expect({ command, kind: kindOf(command) }).toEqual({ command, kind });
  }
}

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
      "bunx tsc --version --noEmit",
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
    ]);
    expect(kindOf("node node_modules\\vitest\\vitest.mjs run")).toBeNull();
    expectKind("test:coverage", [
      "bunx vitest run --coverage",
      "npx vitest run --coverage.enabled",
      "npx jest --coverage",
    ]);
  });

  test("lets print-only runs, other tools and Bun's own test runner through", () => {
    for (const command of [
      "bunx vitest --version",
      "vitest -v",
      "bunx vitest --help",
      "bun test",
      "bun test src/x.test.ts",
      "bunx playwright test",
      "bun add -d vitest",
      "npm install vitest",
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
   * mapped) has no package.json to read. Every read is kept, so a test can check the cache.
   */
  function readerOf(folders: Record<string, string[] | null>): {
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
          return scripts === undefined || scripts === null ? null : new Set(scripts);
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

describe("toolName and toolCallOfArgv", () => {
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
    expect(toolCallOfArgv(["bunx", "tsc", "--noEmit"])).toEqual({
      name: "tsc",
      args: ["--noEmit"],
    });
    expect(toolCallOfArgv(["vitest", "run", "a.ts"])).toEqual({
      name: "vitest",
      args: ["run", "a.ts"],
    });
    expect(toolCallOfArgv(["npm", "run", "x", "--", "a.ts"])).toEqual({
      name: "",
      args: ["--", "a.ts"],
      script: "x",
    });
    expect(toolCallOfArgv(["node", "--version"])).toEqual({ name: "node", args: ["--version"] });
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
      "rg --pre ./run.sh FAIL",
      "rg -z FAIL",
      "cat other.txt",
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

  test("filter before heavy refused: the filter would not be fed by the heavy command", () => {
    expect(line("cat tsconfig.json | bunx tsc --noEmit")).toBeNull();
    expect(line("tail -5 log.txt | bunx vitest run")).toBeNull();
  });

  test("two heavy steps piped: the whole line is queued, as before", () => {
    expect(line("bunx tsc --noEmit | bunx vitest run")).toEqual({
      filters: "",
      heavy: "bunx tsc --noEmit | bunx vitest run",
      kind: "tsc",
    });
  });

  test("a pipe whose meaning the cut would change stays raw", () => {
    // The filter read only the test run's output: queueing both would filter tsc's too.
    expect(line("bunx tsc --noEmit && bunx vitest run | tail -5")).toBeNull();
    // `!` turns the whole pipeline's exit code around, not the heavy command's.
    expect(line("! bunx tsc --noEmit | tail -5")).toBeNull();
    // `||` is no pipe, and a filter inside a shell string would be hidden in the queue's line.
    expect(line("bunx tsc --noEmit || tail -5 log.txt")).toBeNull();
    expect(line("bash -c 'bunx tsc --noEmit | tail -5'")).toBeNull();
    // A command after the filter, and a comment the cut cannot place, keep the line raw.
    expect(line("bunx tsc --noEmit | tail -5; rm -f x")).toBeNull();
    expect(line("bunx tsc --noEmit | tail -5 # last lines")).toBeNull();
  });

  test("classifyRoutableLine names the kind of such a line", () => {
    expect(classifyRoutableLine("bunx tsc --noEmit 2>&1 | tail -20", DEFAULT_KINDS)).toBe("tsc");
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
