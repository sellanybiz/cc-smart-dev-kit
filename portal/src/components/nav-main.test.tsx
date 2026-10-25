import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { NavMain } from "@/components/nav-main";
import { SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";

/** The class lists of every menu (`ul[data-sidebar="menu"]`) in the markup. */
function menuClasses(html: string): string[][] {
  const lists: string[][] = [];
  for (const tag of html.match(/<ul [^>]*>/g) ?? []) {
    if (!tag.includes('data-sidebar="menu"')) continue;
    lists.push((tag.match(/class="([^"]*)"/)?.[1] ?? "").split(/\s+/));
  }
  return lists;
}

/** A Tailwind gap class's step (4px each), or null when it is not a numbered step. */
function gapStep(name: string): number | null {
  const step = name.match(/^gap-(\d+(?:\.\d+)?)$/)?.[1];
  return step === undefined ? null : Number(step);
}

describe("the sidebar's menus", () => {
  // UI1: with no gap, a hovered item's background met the active item's, and the 2px focus
  // outline, drawn outside the item, covered the next item. One step (4px) clears the outline.
  test("every menu leaves room between its items, so a hovered item never meets the next", () => {
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <SidebarProvider>
          <NavMain />
        </SidebarProvider>
      </TooltipProvider>,
    );
    const menus = menuClasses(html);
    expect(menus.length).toBeGreaterThan(0);
    for (const classes of menus) {
      const gaps = classes.filter((name) => name.startsWith("gap-"));
      expect(gaps).toHaveLength(1);
      expect(gapStep(gaps[0] ?? "")).toBeGreaterThanOrEqual(1);
    }
  });
});
