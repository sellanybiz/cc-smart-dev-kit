import { describe, expect, test } from "bun:test";
import { createPrompts } from "../cli/ui/prompt";
import { addressProblem, askSetupQuestions, type SetupFacts } from "./setup-questions";

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
      label: "OmniRoute",
      saved,
      hasConfig: true,
      defaultBaseUrl: "http://127.0.0.1:20128",
      keyFlags: "the flags",
      print: (line) => printed.push(line),
    };
    const asked = await askSetupQuestions(prompts, facts);
    expect(asked).toEqual({ answers: { baseUrl: saved.baseUrl, key: null } });
    expect(printed).toContain(
      "· OmniRoute's address is kept as it is: it holds a user or password, so it is not shown",
    );
    expect(shown.join("")).toBe(
      "OmniRoute's API key for the router (Enter keeps the saved one) (it is not shown) \n",
    );
    expect(`${shown.join("")}${printed.join("\n")}`).not.toContain("SECRET");
  });
});

describe("D66: setup asks the address and the key, and nothing else", () => {
  /** Prompts that show every question and answer Enter (or a typed key). */
  function recorded() {
    const shown: string[] = [];
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
        readSecret: () => Promise.resolve("a-new-key"),
      },
    );
    return { prompts, shown: () => shown.join("") };
  }
  const facts = (print: (line: string) => void): SetupFacts => ({
    label: "OmniRoute",
    saved: null,
    hasConfig: false,
    defaultBaseUrl: "http://127.0.0.1:20128",
    keyFlags: "the flags",
    print,
  });

  test("a new machine: the address, the key, and no slot or turn-on question", async () => {
    const { prompts, shown } = recorded();
    const asked = await askSetupQuestions(
      prompts,
      facts(() => {}),
    );
    expect(asked).toEqual({ answers: { baseUrl: "http://127.0.0.1:20128", key: "a-new-key" } });
    expect(shown()).toBe(
      "OmniRoute's address [http://127.0.0.1:20128]\nOmniRoute's API key for the router (it is not shown) \n",
    );
  });

  test("a config with a key and a saved address: Enter keeps both, still only two questions", async () => {
    const { prompts, shown } = recorded();
    const saved = { apiKey: "saved-key", baseUrl: "http://127.0.0.1:20999" };
    const asked = await askSetupQuestions(prompts, { ...facts(() => {}), hasConfig: true, saved });
    expect(asked).toEqual({ answers: { baseUrl: "http://127.0.0.1:20999", key: "a-new-key" } });
    expect(shown()).toBe(
      "OmniRoute's address [http://127.0.0.1:20999]\nOmniRoute's API key for the router (Enter keeps the saved one) (it is not shown) \n",
    );
  });
});
