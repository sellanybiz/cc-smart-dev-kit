import { expect, test } from "bun:test";
import { readFileSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { tempDir } from "../testing/temp";
import { writeBrief } from "./brief";

test("brief is private, carries task and linked reporting only", async () => {
  const state = tempDir();
  const file = await writeBrief(state, "core", "kit-one", "Do the work.", true, "#7");
  expect(statSync(file).mode & 0o777).toBe(0o600);
  expect(statSync(dirname(file)).mode & 0o777).toBe(0o700);
  expect(readFileSync(file, "utf8")).toContain("Your task: #7\n");
  expect(readFileSync(file, "utf8")).toContain("never take, update or close the task");
  const independent = await writeBrief(state, "core", "kit-two", "Independent brief", false);
  expect(readFileSync(independent, "utf8")).toBe("Independent brief\n");
});
