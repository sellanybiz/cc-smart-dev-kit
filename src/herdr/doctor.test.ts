import { expect, test } from "bun:test";
import { herdrChecks } from "./doctor";
import type { HcRunner } from "./hc";

test("doctor counts children and warns about a blocked independent session", () => {
  const r: HcRunner = (args) => ({
    exitCode: 0,
    stderr: "",
    stdout:
      args[0] === "--version"
        ? "hc 0.1.20"
        : JSON.stringify(
            args[0] === "server"
              ? { core: { id: "core", name: "local" }, version: "0.1.20" }
              : args[0] === "ls"
                ? {
                    terminals: [
                      { address: "t1", state: "live" },
                      { address: "t2", state: "live" },
                    ],
                  }
                : {
                    address: args.at(-1),
                    name: "solo",
                    state: "live",
                    labels:
                      args.at(-1) === "t1"
                        ? { "kit.lead": "core/lead" }
                        : { "kit.independent": "1" },
                    status: { state: "blocked" },
                  },
          ),
  });
  expect(herdrChecks(r)).toEqual([
    { ok: true, text: "Herdr: hc 0.1.20 is new enough." },
    { ok: true, text: "Herdr: core core answers." },
    {
      ok: true,
      info: true,
      text: "Herdr: 1 live kit children, 1 independent sessions; 2 blocked.",
    },
    {
      ok: true,
      warn: true,
      text: "Herdr: independent session solo (t2) is blocked; nobody may be watching.",
      fix: "Open its pane: hc attach t2",
    },
  ]);
});

test("Herdr absence is information; old version warns with fix", () => {
  expect(
    herdrChecks(() => {
      throw new Error("missing");
    }),
  ).toEqual([
    {
      ok: true,
      info: true,
      text: "Herdr: hc is not installed; session orchestration is optional.",
    },
  ]);
  const old: HcRunner = () => ({ exitCode: 0, stdout: "hc 0.1.19", stderr: "" });
  expect(herdrChecks(old)).toEqual([
    {
      ok: true,
      warn: true,
      text: "Herdr: hc 0.1.19 is too old (needs 0.1.20).",
      fix: "Update Herdr and hc.",
    },
  ]);
});
