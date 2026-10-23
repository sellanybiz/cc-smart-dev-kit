import { describe, expect, test } from "bun:test";
import { checkGitBash, findGitBash, GIT_BASH_INSTALLS, GIT_BASH_VAR } from "./git-bash";

/** A machine with exactly these paths, and these commands on PATH. */
function machine(paths: string[], commands: string[] = []) {
  return {
    exists: (path: string) => paths.includes(path),
    which: (command: string) => (commands.includes(command) ? `C:\\fake\\${command}.exe` : null),
  };
}

const PROGRAM_FILES = GIT_BASH_INSTALLS[0];
const PROGRAM_FILES_X86 = GIT_BASH_INSTALLS[1];

describe("finding Git Bash", () => {
  test("the variable wins where it names bash.exe and the file is there", () => {
    const mine = "D:\\tools\\Git\\bin\\bash.exe";
    expect(findGitBash({ [GIT_BASH_VAR]: mine }, machine([mine, PROGRAM_FILES]))).toEqual({
      ignoredVariable: null,
      path: mine,
    });
  });

  test("a sh.exe, or a bare bash, is accepted too", () => {
    for (const name of ["C:\\Git\\bin\\sh.exe", "C:\\Git\\bin\\bash"]) {
      expect(findGitBash({ [GIT_BASH_VAR]: name }, machine([name])).path).toBe(name);
    }
  });

  test("a variable Claude Code will ignore is reported, and the search goes on", () => {
    // The name is not one Claude Code accepts (`git-bash.exe`), so it is ignored there too.
    const wrongName = "C:\\Git\\git-bash.exe";
    const found = findGitBash({ [GIT_BASH_VAR]: wrongName }, machine([wrongName, PROGRAM_FILES]));
    expect(found).toEqual({ ignoredVariable: wrongName, path: PROGRAM_FILES });
  });

  test("a variable pointing at a file that is not there is ignored as well", () => {
    const gone = "D:\\gone\\bash.exe";
    expect(findGitBash({ [GIT_BASH_VAR]: gone }, machine([PROGRAM_FILES]))).toEqual({
      ignoredVariable: gone,
      path: PROGRAM_FILES,
    });
  });

  test("Claude Code's two install folders, in its order", () => {
    expect(findGitBash({}, machine([PROGRAM_FILES])).path).toBe(PROGRAM_FILES);
    expect(findGitBash({}, machine([PROGRAM_FILES_X86])).path).toBe(PROGRAM_FILES_X86);
  });

  test("beside the git on PATH: <git folder>\\..\\bin\\bash.exe", () => {
    const bash = "C:\\Program Files\\Git\\bin\\bash.exe";
    const facts = {
      exists: (path: string) => path === bash,
      which: (command: string) =>
        command === "git" ? "C:\\Program Files\\Git\\cmd\\git.exe" : null,
    };
    expect(findGitBash({}, facts)).toEqual({ ignoredVariable: null, path: bash });
  });

  test("no Git Bash anywhere: a null path, and nothing reported as ignored", () => {
    expect(findGitBash({}, machine([]))).toEqual({ ignoredVariable: null, path: null });
  });
});

describe("doctor's Git Bash line", () => {
  test("nothing at all off Windows", () => {
    expect(checkGitBash("linux", {}, machine([PROGRAM_FILES]))).toBeNull();
    expect(checkGitBash("darwin", {}, machine([PROGRAM_FILES]))).toBeNull();
  });

  test("found: a ✓ naming where it is and what needs it", () => {
    expect(checkGitBash("win32", {}, machine([PROGRAM_FILES]))).toEqual({
      ok: true,
      text: `Git Bash is at ${PROGRAM_FILES}, which the hooks and the Bash tool run through`,
    });
  });

  test("found, but the variable is being ignored: a warning naming both", () => {
    const wrongName = "C:\\Git\\git-bash.exe";
    const check = checkGitBash(
      "win32",
      { [GIT_BASH_VAR]: wrongName },
      machine([wrongName, PROGRAM_FILES_X86]),
    );
    expect(check?.ok).toBe(true);
    expect(check?.warn).toBe(true);
    expect(check?.text).toBe(
      `Git Bash is at ${PROGRAM_FILES_X86}, which the hooks and the Bash tool run through — but ` +
        `${GIT_BASH_VAR} is set to ${wrongName}, which Claude Code ignores (it must name bash.exe, ` +
        "sh.exe, bash or sh, and the file must exist)",
    );
    expect(check?.fix).toBe(`remove ${GIT_BASH_VAR}, or point it at bash.exe`);
  });

  test("not found: a ✗ that says what to install, never a pass", () => {
    const check = checkGitBash("win32", {}, machine([]));
    expect(check?.ok).toBe(false);
    expect(check?.text).toContain("Git Bash was not found");
    expect(check?.fix).toBe(
      "install Git for Windows (https://git-scm.com/download/win), or set CLAUDE_CODE_GIT_BASH_PATH to bash.exe, then run: cc-smart-dev-kit doctor",
    );
  });

  test("not found, with the variable set: the ✗ names it", () => {
    const gone = "D:\\gone\\bash.exe";
    const check = checkGitBash("win32", { [GIT_BASH_VAR]: gone }, machine([]));
    expect(check?.ok).toBe(false);
    expect(check?.text).toContain(`${GIT_BASH_VAR} is set to ${gone}, which Claude Code ignores`);
  });
});
