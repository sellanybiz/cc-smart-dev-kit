/**
 * The task's definition as Task Scheduler itself reads it. `commands.test.ts` pins the text by
 * hand; this file proves Windows accepts that text the way `registerTask` hands it over: as a
 * string, from `Get-Content -Raw`. On Windows the definition goes through Task Scheduler's own
 * parser (`Schedule.Service`'s `NewTask(0).XmlText`), which reads it and registers nothing.
 */
import { describe, expect, it } from "bun:test";
import { renderTask, type TaskDefinitionInput } from "./service-windows";

const INPUT: TaskDefinitionInput = {
  account: "MACHINE\\me",
  bunPath: "C:\\bun\\bun.exe",
  copyPath: "C:\\Users\\me\\.local\\share\\cc-smart-dev-kit\\router.js",
  home: "C:\\Users\\me",
  port: 20100,
};

describe("the task's XML declaration", () => {
  it("names no encoding: Task Scheduler refuses a string whose declaration names UTF-8", () => {
    const first = renderTask(INPUT).split("\n")[0];
    expect(first).toBe('<?xml version="1.0"?>');
  });
});

describe.skipIf(process.platform !== "win32")("Task Scheduler's own parser", () => {
  it("reads the definition as registerTask hands it over, and registers nothing", () => {
    // The XML comes on stdin, so no quoting of it reaches PowerShell's command line.
    const script = [
      "$x=[Console]::In.ReadToEnd()",
      "$s=New-Object -ComObject Schedule.Service",
      "$s.Connect()",
      "$t=$s.NewTask(0)",
      "$t.XmlText=$x",
      "$a=@($t.Actions)[0]",
      "'path='+$a.Path",
      "'arguments='+$a.Arguments",
      "'working='+$a.WorkingDirectory",
    ].join(";");
    const run = Bun.spawnSync(["powershell", "-NoProfile", "-NonInteractive", "-Command", script], {
      stdin: new TextEncoder().encode(renderTask(INPUT)),
    });
    const output = `${run.stdout.toString()}${run.stderr.toString()}`;
    expect(output).not.toContain("ERROR");
    expect(run.exitCode).toBe(0);
    const lines = output.split(/\r?\n/);
    expect(lines).toContain(`path=${INPUT.bunPath}`);
    expect(lines).toContain(`arguments=--no-env-file "${INPUT.copyPath}"`);
    expect(lines).toContain(`working=${INPUT.home}`);
  });
});
