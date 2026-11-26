import { expect, test } from "bun:test";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { cliPaths } from "../cli/paths";
import { withLock } from "../setup/lock";
import { tempDir } from "../testing/temp";
import { MachinesFileError, machineRule, readMachines, writeMachines } from "./machines";

test("machine path shares the workflow config folder", () => {
  const paths = cliPaths({ HOME: tempDir() });
  expect(paths.machinesFile).toBe(join(dirname(paths.workflowConfigFile), "machines.json"));
});
test("a machine list saved with a byte order mark reads", () => {
  const file = join(tempDir(), "machines.json");
  writeFileSync(file, '﻿{"version":1,"machines":{"remote":{"allow":true}}}');
  expect(machineRule(readMachines(file), "remote")).toBe("free");
});
test("machine rules and locked private writes", async () => {
  const dir = tempDir(),
    file = join(dir, "config", "machines.json"),
    state = join(dir, "state");
  expect(readMachines(file)).toEqual({ version: 1, machines: {} });
  expect(machineRule(readMachines(file), "remote")).toBe("ask");
  await writeMachines(file, { verb: "allow", name: "remote" }, state);
  expect(machineRule(readMachines(file), "remote")).toBe("free");
  await writeMachines(file, { verb: "production", name: "remote" }, state);
  expect(readMachines(file).machines.remote).toEqual({ allow: true, production: true });
  expect(machineRule(readMachines(file), "remote")).toBe("production");
  if (process.platform !== "win32") expect(statSync(file).mode & 0o777).toBe(0o600);
  await withLock(state, async () =>
    expect(writeMachines(file, { verb: "forget", name: "remote" }, state)).rejects.toThrow("busy"),
  );
  await writeMachines(file, { verb: "forget", name: "remote" }, state);
  expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ version: 1, machines: {} });
  for (const content of [
    "",
    "{",
    '{"version":2,"machines":{}}',
    '{"version":1,"machines":{"r":{"allow":false}}}',
  ]) {
    writeFileSync(file, content);
    expect(() => readMachines(file)).toThrow(MachinesFileError);
    let message = "";
    try {
      readMachines(file);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message.startsWith(`${file} is not a machine list (`)).toBe(true);
    expect(message.endsWith("). Fix it or remove it.")).toBe(true);
    await expect(writeMachines(file, { verb: "allow", name: "other" }, state)).rejects.toThrow();
    expect(readFileSync(file, "utf8")).toBe(content);
  }
});
