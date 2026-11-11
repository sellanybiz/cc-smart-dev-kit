/**
 * The filter rows' shared parts and the tab bars' counts, drawn from props alone: nothing in a
 * filter row or a tab bar may be wider than its column, or cut a word or a number without a way
 * to read all of it.
 */
import { describe, expect, test } from "bun:test";
import { Children, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { HistoryFilter } from "@/api/types";
import { FilterBar, FilterPick, FilterToggle } from "@/components/filter-bar";
import type { HistoryState } from "@/components/history-state";
import { TabCount } from "@/components/tab-count";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const LONG = "a-plan-subject-long-enough-to-push-a-filter-row-off-the-page (release-plan)";

type Props = Record<string, unknown> & { children?: ReactNode };

/**
 * What a component returns, drawn inside a host component so its hooks have a renderer (the
 * way `overview.test.tsx` reads the real card's props, without replacing a module).
 */
function drawn(run: () => ReactNode): ReactNode {
  let out: ReactNode = null;
  function Host() {
    out = run();
    return null;
  }
  renderToStaticMarkup(<Host />);
  return out;
}

/** The props of every element of the given type in a tree, in order. */
function propsOf(node: ReactNode, type: unknown): Props[] {
  const found: Props[] = [];
  Children.forEach(node, (child) => {
    if (!isValidElement<Props>(child)) return;
    if (child.type === type) found.push(child.props);
    found.push(...propsOf(child.props.children, type));
  });
  return found;
}

/** Call a handler found in the props, as the browser would. */
function fire(handler: unknown, ...args: unknown[]): void {
  if (typeof handler !== "function") throw new Error("no handler on that element");
  handler(...args);
}

/** A select's change event, as far as a picker reads it. */
function picked(value: string) {
  return { target: { value } };
}

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

describe("what a filter row's parts hand back", () => {
  /** The select's change handler of a picker, and every value the picker handed back. */
  function pickerSelect(value: null | string) {
    const sent: (null | string)[] = [];
    const tree = drawn(() =>
      FilterPick({
        label: "Plan",
        all: "All plans",
        value,
        options: [{ value: "long", label: LONG }],
        onChange: (next) => sent.push(next),
      }),
    );
    const selects = propsOf(tree, NativeSelect);
    expect(selects).toHaveLength(1);
    return { onChange: selects[0]?.onChange, sent };
  }

  test("picking a value hands back that value", () => {
    const { onChange, sent } = pickerSelect(null);
    fire(onChange, picked("long"));
    expect(sent).toEqual(["long"]);
  });

  test("picking the all-words again hands back null, never an empty value", () => {
    const { onChange, sent } = pickerSelect("long");
    fire(onChange, picked(""));
    expect(sent).toEqual([null]);
  });

  test("the switch hands back on and off as they are", () => {
    const sent: boolean[] = [];
    const tree = drawn(() =>
      FilterToggle({ label: "Errors only", checked: false, onChange: (on) => sent.push(on) }),
    );
    const switches = propsOf(tree, Switch);
    expect(switches).toHaveLength(1);
    fire(switches[0]?.onCheckedChange, true);
    fire(switches[0]?.onCheckedChange, false);
    expect(sent).toEqual([true, false]);
  });

  test("the charts' bar turns null into no filter, and keeps the other filters", () => {
    const set: HistoryFilter[] = [];
    const filter: HistoryFilter = { slot: "opus", model: "glm-5.3" };
    const state: HistoryState = {
      range: "1d",
      by: "target",
      filter,
      key: "",
      setRange: () => {},
      setBy: () => {},
      setFilter: (next) => set.push(next),
    };
    const tree = drawn(() => FilterBar({ state }));
    const picks = propsOf(tree, FilterPick);
    expect(picks.map((one) => one.label)).toEqual(["Slot", "Target", "Model", "Session"]);
    const [slot, target, model, session] = picks;
    fire(slot?.onChange, null);
    fire(slot?.onChange, "fable");
    fire(target?.onChange, "omniroute/deepseek");
    fire(model?.onChange, null);
    fire(session?.onChange, "s1");
    const toggles = propsOf(tree, FilterToggle);
    expect(toggles).toHaveLength(1);
    fire(toggles[0]?.onChange, true);
    fire(toggles[0]?.onChange, false);
    // `toEqual` would let a key set to undefined pass for a missing one; `toStrictEqual` does not.
    expect(set).toStrictEqual([
      { slot: undefined, model: "glm-5.3" },
      { slot: "fable", model: "glm-5.3" },
      { slot: "opus", target: "omniroute/deepseek", model: "glm-5.3" },
      { slot: "opus", model: undefined },
      { slot: "opus", model: "glm-5.3", session: "s1" },
      { slot: "opus", model: "glm-5.3", errorsOnly: true },
      { slot: "opus", model: "glm-5.3", errorsOnly: undefined },
    ]);
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
