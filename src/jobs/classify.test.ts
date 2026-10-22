/**
 * `classifyHeavyCommand` (`classify.ts`): which kind a Bash command runs, behind the
 * common runners and wrappers, and never a tool that is only named (in quotes, an echo, a
 * here-doc, a commit message). Every expected kind is written by hand.
 */
import { describe, expect, test } from "bun:test";
import { classifyHeavyCommand, toolCallOfArgv, toolName } from "./classify";
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
  test("finds vitest and jest runs, and coverage as its own, larger kind", () => {
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
  test("names the step that reserves the most", () => {
    expect(kindOf("bunx tsc --noEmit && bunx next build")).toBe("build");
    expect(kindOf("bunx tsc; bunx vitest run --coverage")).toBe("test:coverage");
    // A tie (8 and 8 GB): the first.
    expect(kindOf("bunx vitest run a.ts; bunx tsc")).toBe("test:run");
    expect(kindOf("ls && echo done")).toBeNull();
  });

  test("finds a project's script by its name, through every package manager", () => {
    const kinds = mergeKinds({ typecheck: { gb: 8, match: [{ script: "typecheck" }] } });
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
    const kinds = mergeKinds({ tsc: { gb: 8, match: [{ tool: "tsc" }] } });
    expect(classifyHeavyCommand("bunx tsgo --noEmit", kinds)).toBeNull();
    expect(classifyHeavyCommand("bunx tsc --noEmit", kinds)).toBe("tsc");
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
