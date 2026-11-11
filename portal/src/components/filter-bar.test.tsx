/**
 * The filter rows' shared parts and the tab bars' counts, drawn from props alone: nothing in a
 * filter row or a tab bar may be wider than its column, or cut a word or a number without a way
 * to read all of it.
 */
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { FilterPick, FilterToggle } from "@/components/filter-bar";
import { TabCount } from "@/components/tab-count";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const LONG = "a-plan-subject-long-enough-to-push-a-filter-row-off-the-page (release-plan)";

/** The class list of the first tag the pattern finds. */
function classesOf(html: string, tag: RegExp): string[] {
  const found = html.match(tag)?.[0] ?? "";
  return (found.match(/class="([^"]*)"/)?.[1] ?? "")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .split(/\s+/);
}

function pick(value: null | string): string {
  return renderToStaticMarkup(
    <FilterPick
      label="Plan"
      all="All plans"
      value={value}
      options={[
        { value: "short", label: "Short plan" },
        { value: "long", label: LONG },
      ]}
      onChange={() => {}}
    />,
  );
}

describe("a filter row's picker", () => {
  test("never wider than its row, capped from the xl size up, a cut name ends in an ellipsis", () => {
    const wrapper = classesOf(pick("long"), /<div[^>]*data-slot="native-select-wrapper"[^>]*>/);
    expect(wrapper).toContain("max-w-full");
    expect(wrapper).toContain("@xl/main:max-w-72");
    // The ellipsis is on the select itself, which holds the text.
    expect(wrapper).toContain("[&>select]:truncate");
  });

  test("its title holds the whole chosen name, or the all-words when it narrows nothing", () => {
    const select = (html: string) => html.match(/<select[^>]*>/)?.[0] ?? "";
    expect(select(pick("long"))).toContain(`title="${LONG}"`);
    expect(select(pick(null))).toContain('title="All plans"');
    // A value no option has (an old link) shows as itself, never an empty title.
    expect(select(pick("gone"))).toContain('title="gone"');
  });

  test("muted while it narrows nothing, bold once it does, and labelled for a screen reader", () => {
    const wrapper = (html: string) =>
      classesOf(html, /<div[^>]*data-slot="native-select-wrapper"[^>]*>/);
    expect(wrapper(pick(null))).toContain("text-muted-foreground");
    expect(wrapper(pick("short"))).toContain("font-medium");
    expect(pick(null)).toMatch(/<label[^>]*class="sr-only"[^>]*>Plan<\/label>/);
  });
});

describe("a filter row's switch", () => {
  test("its words stay on one line beside it", () => {
    const html = renderToStaticMarkup(
      <FilterToggle label="Running sessions only" checked={false} onChange={() => {}} />,
    );
    expect(classesOf(html, /<label[^>]*>/)).toContain("whitespace-nowrap");
    expect(html).toContain("Running sessions only");
  });
});

describe("a tab bar", () => {
  test("wider than its column, it scrolls as a whole and starts at its first tab", () => {
    const html = renderToStaticMarkup(
      <Tabs defaultValue="a">
        <TabsList aria-label="Example">
          <TabsTrigger value="a">First</TabsTrigger>
        </TabsList>
      </Tabs>,
    );
    const list = classesOf(html, /<div[^>]*role="tablist"[^>]*>/);
    expect(list).toContain("max-w-full");
    expect(list).toContain("overflow-x-auto");
    // Plain `justify-center` would push an overflowing bar's first tab out of reach.
    expect(list).toContain("justify-center-safe");
    expect(list).not.toContain("justify-center");
    // A tab never wraps its words.
    expect(classesOf(html, /<button[^>]*role="tab"[^>]*>/)).toContain("whitespace-nowrap");
  });

  test("a count grows with its number instead of cutting it", () => {
    const badge = classesOf(
      renderToStaticMarkup(<TabCount count={128} />),
      /<span[^>]*data-slot="badge"[^>]*>/,
    );
    expect(badge).toContain("min-w-5");
    expect(badge).toContain("h-5");
    expect(badge).not.toContain("size-5");
    expect(badge).not.toContain("w-5");
  });
});
