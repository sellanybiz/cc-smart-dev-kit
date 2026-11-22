import { expect, test } from "bun:test";
import { Children, type ComponentProps, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SwitchFacts } from "@/api/types";
import { SavedSwitch } from "@/components/saved-switch";
import { PlanCard, SwitchesCard } from "@/views/overview";

const OFFLINE: SwitchFacts = {
  gateway: false,
  judge: false,
  judgeUntested: false,
  settingsBaseUrl: null,
  warnings: [],
};

/** Inspect the real card's switch props without replacing a module for other tests. */
function switchProps(node: ReactNode): ComponentProps<typeof SavedSwitch>[] {
  const found: ComponentProps<typeof SavedSwitch>[] = [];
  Children.forEach(node, (child) => {
    if (!isValidElement<{ children?: ReactNode }>(child)) return;
    if (child.type === SavedSwitch && isValidElement<ComponentProps<typeof SavedSwitch>>(child)) {
      found.push(child.props);
    } else {
      found.push(...switchProps(child.props.children));
    }
  });
  return found;
}

test("Overview keeps two switches and gates the auto-mode judge without changing its action", () => {
  const offline = renderToStaticMarkup(<SwitchesCard switches={OFFLINE} port={12345} />);
  const buttons = offline.match(/<button[^>]*role="switch"[^>]*>/g) ?? [];
  expect(buttons).toHaveLength(2);
  expect(buttons[0]).not.toMatch(/\sdisabled(?:=|\s|>)/);
  expect(buttons[1]).toMatch(/\sdisabled(?:=|\s|>)/);
  expect(offline).toContain("Works only with the gateway on");

  for (const judge of [false, true]) {
    const facts = { ...OFFLINE, gateway: true, judge };
    const html = renderToStaticMarkup(<SwitchesCard switches={facts} port={12345} />);
    expect(html.match(/role="switch"/g)).toHaveLength(2);
    expect(html).not.toContain("Works only with the gateway on");
    expect(html).toContain(judge ? "Your judge chain judges" : "Claude judges");
    const switches = switchProps(SwitchesCard({ port: 12345, switches: facts }));
    expect(switches.map((one) => one.label)).toEqual(["Gateway", "Auto-mode judge"]);
    const judgeSwitch = switches[1];
    expect(judgeSwitch?.disabled).toBe(false);
    expect(judgeSwitch?.checked).toBe(judge);
    expect(judgeSwitch?.action).toBe("switch");
    expect(judgeSwitch?.body(false)).toEqual({ name: "judge", on: false });
    expect(judgeSwitch?.body(true)).toEqual({ name: "judge", on: true });
  }
});

const NOW = Date.UTC(2026, 9, 23, 12, 0, 0);
const FIVE_HOUR = { percent: 61, resetsAt: Date.UTC(2026, 9, 23, 14, 7, 0) };
const SEVEN_DAY = { percent: 33, resetsAt: Date.UTC(2026, 9, 27, 9, 0, 0) };

test("the plan card shows one labelled row for each window the status line recorded", () => {
  const both = renderToStaticMarkup(
    <PlanCard fiveHour={FIVE_HOUR} sevenDay={SEVEN_DAY} limit={undefined} now={NOW} />,
  );
  // Two rows, each with its label, its percent, a meter that speaks and its reset.
  expect(both.match(/<meter /g)).toHaveLength(2);
  expect(both).toContain("5-hour window");
  expect(both).toContain("7-day window");
  expect(both).toContain("61 %");
  expect(both).toContain("33 %");
  expect(both).toContain('max="100" value="61"');
  expect(both).toContain('max="100" value="33"');
  expect(both).toContain("Resets in 2 h 7 min");
  // More than a day away, a clock time alone would not say which day: the span says it.
  expect(both).toContain("Resets in 3 d 21 h<");
  expect(both).toContain("From the status line");
  expect(both).not.toContain("written nowhere");
  // The page policy forbids a style attribute: the bar's width is an SVG attribute.
  expect(both).not.toContain("style=");

  // A file from before 2.2.0, or a 7-day window that is over: the 5-hour row alone.
  const fiveOnly = renderToStaticMarkup(
    <PlanCard fiveHour={FIVE_HOUR} sevenDay={null} limit={undefined} now={NOW} />,
  );
  expect(fiveOnly.match(/<meter /g)).toHaveLength(1);
  expect(fiveOnly).toContain("5-hour window");
  expect(fiveOnly).not.toContain("7-day window");

  // No reading at all: the card's empty state, and no row.
  const none = renderToStaticMarkup(
    <PlanCard fiveHour={null} sevenDay={null} limit={undefined} now={NOW} />,
  );
  expect(none).not.toContain("<meter");
  expect(none).toContain("no reading");
  expect(none).toContain("The status line has recorded none yet");

  // A limit the router saw names the model and the window that ran out.
  const limited = renderToStaticMarkup(
    <PlanCard
      fiveHour={FIVE_HOUR}
      sevenDay={SEVEN_DAY}
      limit={{ claim: "the 5-hour window", model: "claude-opus-5-5", resets: "14:07" }}
      now={NOW}
    />,
  );
  expect(limited).toContain("limit until 14:07");
  expect(limited).toContain("claude-opus-5-5 ran out of the 5-hour window");
});
