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

describe("the sidebar's menus", () => {
  // UI1: with no gap, a hovered item's background, the active item's background and the
  // keyboard focus ring (2px, drawn outside the item) ran into the next item.
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
      const gaps = classes.filter((name) => /^gap-/.test(name));
      expect(gaps).toHaveLength(1);
      expect(gaps[0]).not.toBe("gap-0");
    }
  });
});
