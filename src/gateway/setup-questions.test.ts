import { describe, expect, test } from "bun:test";
import { createPrompts } from "../cli/ui/prompt";
import {
  addressProblem,
  askSetupQuestions,
  resolvePicks,
  type SetupFacts,
} from "./setup-questions";

describe("setup's address question", () => {
  test("an http or https address with no credential is taken", () => {
    expect(addressProblem("http://127.0.0.1:20128")).toBeNull();
    expect(addressProblem("https://omniroute.example.com/")).toBeNull();
  });

  test("anything else is asked again, with why", () => {
    expect(addressProblem("ftp://127.0.0.1")).toBe("the address starts with http:// or https://");
    expect(addressProblem("127.0.0.1:20128")).toBe(
      "give a full address, such as http://127.0.0.1:20128",
    );
    expect(addressProblem("not an address")).toBe(
      "give a full address, such as http://127.0.0.1:20128",
    );
    expect(addressProblem("http://user:pass@127.0.0.1:20128")).toBe(
      "give the address with no user or password in it",
    );
  });
});

describe("setup's slot picks", () => {
  const ids = ["m1", "m2"];

  test("a number is the model it stands for; a target or a slot word stays", () => {
    expect(resolvePicks("2, 1", ids, "omniroute")).toEqual({ text: "omniroute:m2,omniroute:m1" });
    expect(resolvePicks("1,claude-opus-5-5", ids, "omniroute")).toEqual({
      text: "omniroute:m1,claude-opus-5-5",
    });
    expect(resolvePicks("off", ids, "omniroute")).toEqual({ text: "off" });
  });

  test("a number that is not on the list is refused", () => {
    expect(resolvePicks("3", ids, "omniroute")).toEqual({
      error: "there is no model 3 on the list (1 to 2)",
    });
    expect(resolvePicks("0", ids, "omniroute")).toEqual({
      error: "there is no model 0 on the list (1 to 2)",
    });
  });
});

describe("setup's questions with a saved address that holds a credential", () => {
  test("the address is kept and never shown; the key is still asked", async () => {
    const shown: string[] = [];
    const printed: string[] = [];
    const prompts = createPrompts(
      { color: false, rich: false, unicode: true, width: Number.POSITIVE_INFINITY },
      {
        write: (text) => {
          shown.push(text);
        },
        readLine: (question) => {
          shown.push(`${question}\n`);
          return null;
        },
        readSecret: () => Promise.resolve(""),
      },
    );
    const saved = { apiKey: "saved-key", baseUrl: "http://user:SECRET-pass@127.0.0.1:20128" };
    const facts: SetupFacts = {
      backend: "omniroute",
      label: "OmniRoute",
      saved,
      defaultBaseUrl: "http://127.0.0.1:20128",
      slots: [],
      claudeWords: ["claude", "off"],
      listModels: () => Promise.resolve({ ids: ["m1"] }),
      checkChain: () => null,
      gatewayOn: true,
      keyFlags: "the flags",
      pickLater: "later",
      print: (line) => printed.push(line),
    };
    const asked = await askSetupQuestions(prompts, facts);
    expect(asked).toEqual({
      answers: { baseUrl: saved.baseUrl, chains: {}, ids: ["m1"], key: null, turnOn: false },
    });
    expect(printed).toContain(
      "· OmniRoute's address is kept as it is: it holds a user or password, so it is not shown",
    );
    expect(shown.join("")).toBe(
      "OmniRoute's API key for the router (Enter keeps the saved one) (it is not shown) \n",
    );
    expect(`${shown.join("")}${printed.join("\n")}`).not.toContain("SECRET");
  });
});
