import { expect, test } from "bun:test";
import { Children, type ComponentProps, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SwitchFacts } from "@/api/types";
import { SavedSwitch } from "@/components/saved-switch";
import { SwitchesCard } from "@/views/overview";

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
