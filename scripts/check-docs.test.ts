import { describe, expect, test } from "bun:test";
import {
  checkDocs,
  headingNames,
  headingsOf,
  longestHeadingIn,
  type SourceFile,
} from "./check-docs";

function world(extra: SourceFile[] = []): SourceFile[] {
  return [
    {
      path: "docs/design.md",
      text: "# Design\n\n| Page |\n|---|\n| [The portal](design/portal.md) |\n",
    },
    {
      path: "docs/design/portal.md",
      text: "# The portal\n\n## How it starts (D10)\n\nText.\n",
    },
    {
      path: "README.md",
      text: "# kit\n\n## Install\n\n## The AI gateway (optional)\n\n## doctor\n",
    },
    ...extra,
  ];
}

describe("check-docs", () => {
  test("a section reference to a page resolves", () => {
    const files = world([
      { path: "src/a.ts", text: "/** see `docs/design/portal.md` § The portal */" },
    ]);
    expect(checkDocs(files)).toEqual([]);
  });

  test("a wrapped section name resolves across the line break", () => {
    const files = world([
      { path: "src/a.ts", text: "/** `docs/design/portal.md` § How it starts\n * (D10) */" },
    ]);
    expect(checkDocs(files)).toEqual([]);
  });

  test("the section may come before the path", () => {
    const files = world([
      { path: "docs/x.md", text: "See § The portal in `docs/design/portal.md`." },
    ]);
    expect(checkDocs(files)).toEqual([]);
  });

  test("a case variant and a leading The agree", () => {
    const files = world([{ path: "src/a.ts", text: "// docs/design/portal.md § the portal" }]);
    expect(checkDocs(files)).toEqual([]);
  });

  test("a heading's own qualifier may be left out", () => {
    const files = world([
      {
        path: "install.sh",
        text: '# LEFT+=("the gateway: README § The AI gateway (its router needs systemd)")',
      },
    ]);
    expect(checkDocs(files)).toEqual([]);
  });

  test("a section that is not on the page fails", () => {
    const files = world([{ path: "src/a.ts", text: "// docs/design/portal.md § The browser" }]);
    const broken = checkDocs(files);
    expect(broken).toHaveLength(1);
    expect(broken[0]?.why).toContain('has no section "The browser"');
  });

  test("a backticked reference is read the same way", () => {
    const files = world([
      { path: "src/a.ts", text: "// see `docs/design/portal.md` § The browser" },
    ]);
    expect(checkDocs(files)).toHaveLength(1);
  });

  test("the index form resolves while a page holds the section", () => {
    const files = world([{ path: "src/a.ts", text: "// docs/design.md § The portal" }]);
    expect(checkDocs(files)).toEqual([]);
  });

  test("the index form fails when no page holds the section", () => {
    const files = world([{ path: "src/a.ts", text: "// docs/design.md § A section that is gone" }]);
    const broken = checkDocs(files);
    expect(broken).toHaveLength(1);
    expect(broken[0]?.why).toContain("no page under");
  });

  test("a page that does not exist fails", () => {
    const files = world([{ path: "src/a.ts", text: "// docs/design/nothing.md § Anything" }]);
    expect(checkDocs(files)[0]?.why).toContain("does not exist");
  });

  test("a bare reference resolves to the file itself", () => {
    const files = world([
      { path: "README.md", text: "# kit\n\nSee [the design](docs/design.md).\n" },
    ]);
    expect(checkDocs(files)).toEqual([]);
  });

  test("a README section resolves, in both forms", () => {
    const files = world([
      { path: "src/a.ts", text: "// `README.md` § Install\n// README, section doctor\n" },
    ]);
    expect(checkDocs(files)).toEqual([]);
  });

  test("a README section that is gone fails", () => {
    const files = world([{ path: "src/a.ts", text: "// `README.md` § Moving from anymodel" }]);
    const broken = checkDocs(files);
    expect(broken).toHaveLength(1);
    expect(broken[0]?.why).toContain("no section");
  });

  test("the plans and the archives are history, not pointers", () => {
    const files = world([
      { path: ".claude/plans/briefs/x.md", text: "docs/design.md § A section that never existed" },
      { path: ".claude/research/archive/y.md", text: "README.md § Gone" },
    ]);
    expect(checkDocs(files)).toEqual([]);
  });

  test("a link to a missing heading in the same file fails", () => {
    const files = world([
      { path: "README.md", text: "# kit\n\n## Install\n\nSee [the gateway](#the-gateway).\n" },
    ]);
    const broken = checkDocs(files);
    expect(broken).toHaveLength(1);
    expect(broken[0]?.why).toContain('no heading in this file has the anchor "#the-gateway"');
  });

  test("a link to a heading in the same file resolves", () => {
    const files = world([
      {
        path: "README.md",
        text: "# kit\n\n## The `gateway` (optional)\n\nSee [it](#the-gateway-optional).\n",
      },
    ]);
    expect(checkDocs(files)).toEqual([]);
  });

  test("a build output folder is not read", () => {
    const files = world([{ path: "plugin/dist/cli.js", text: "docs/design.md § Gone" }]);
    expect(checkDocs(files)).toEqual([]);
  });
});

describe("headings", () => {
  test("a heading inside a fenced code block is not a heading", () => {
    const headings = headingsOf("# A\n\n```sh\n## not a heading\n```\n\n## B\n");
    expect(headings.map((h) => h.name)).toEqual(["A", "B"]);
  });

  test("a heading's names drop a trailing qualifier", () => {
    expect(headingNames("The AI gateway (optional)")).toEqual([
      "The AI gateway (optional)",
      "The AI gateway",
    ]);
    expect(headingNames("The usage limit: the alert, and `usage`")).toEqual([
      "The usage limit: the alert, and `usage`",
      "The usage limit",
    ]);
  });

  test("the longest heading wins at a word boundary", () => {
    const headings = headingsOf("## The hooks\n## The hooks and guards\n");
    expect(longestHeadingIn("The hooks and guards", headings)?.name).toBe("The hooks and guards");
    expect(longestHeadingIn("The hooksz", headings)).toBeNull();
  });
});
