import { expect, test } from "bun:test";
import type { HcRunner } from "./hc";
import { checkedIdentity } from "./identity";

const runner =
  (change = {}): HcRunner =>
  (args) => ({
    exitCode: 0,
    stderr: "",
    stdout: JSON.stringify(
      args[0] === "server"
        ? { core: { id: "core", name: "local" }, version: "0.1.20" }
        : { address: "t1", state: "live", pid: 12, labels: {}, status: null, ...change },
    ),
  });
test("identity requires a live local terminal whose pid is an ancestor", () => {
  const facts = { pid: 30, ancestors: () => [20, 12] };
  expect(checkedIdentity({}, runner(), facts)).toEqual({
    why: "This session is not inside a Herdr terminal (HC_TERMINAL_ID is missing).",
  });
  expect(checkedIdentity({ HC_TERMINAL_ID: "t1" }, runner(), facts)).toEqual({
    core: "core",
    address: "t1",
    leadId: "core/t1",
  });
  for (const change of [
    { state: "finished" },
    { address: "remote/t1" },
    { pid: 99 },
    { pid: null },
  ])
    expect(checkedIdentity({ HC_TERMINAL_ID: "t1" }, runner(change), facts)).toHaveProperty("why");
});
