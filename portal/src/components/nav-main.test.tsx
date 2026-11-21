import { describe, expect, test } from "bun:test";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NAV_GROUPS } from "@/components/nav-items";
import { NavLinkItem, NavMain } from "@/components/nav-main";
import { SidebarMenuButton, SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";

/** The first element in a tree of elements whose type is `type`, without rendering it. */
function findElement(node: ReactNode, type: unknown): ReactElement | null {
  if (!isValidElement(node)) return null;
  if (node.type === type) return node;
  const children = (node.props as { children?: ReactNode }).children;
  for (const child of Array.isArray(children) ? children : [children]) {
    const found = findElement(child, type);
    if (found !== null) return found;
  }
  return null;
}

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
  test("the sidebar keeps the working pages without a Needs link or badge", () => {
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <SidebarProvider>
          <NavMain />
        </SidebarProvider>
      </TooltipProvider>,
    );
    expect(html).not.toContain('href="/needs"');
    expect(html).not.toContain("Needs you");
    expect(html).not.toContain('data-sidebar="menu-badge"');
    for (const path of ["/work", "/flow", "/guards", "/machine", "/settings"]) {
      expect(html).toContain(`href="${path}"`);
    }
  });
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

  // UI1: folded to icons, a group's label turns invisible and moves up over the last item of
  // the group above; it must let the pointer through, or that item loses half its hover.
  test("a folded group's invisible label never takes the pointer from the item under it", () => {
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <SidebarProvider>
          <NavMain />
        </SidebarProvider>
      </TooltipProvider>,
    );
    const labels = (html.match(/<div [^>]*>/g) ?? []).filter((tag) =>
      tag.includes('data-sidebar="group-label"'),
    );
    expect(labels.length).toBeGreaterThan(0);
    for (const tag of labels) {
      const classes = (tag.match(/class="([^"]*)"/)?.[1] ?? "").split(/\s+/);
      expect(classes).toContain("group-data-[collapsible=icon]:opacity-0");
      expect(classes).toContain("group-data-[collapsible=icon]:pointer-events-none");
    }
  });

  // T-lxjff2: the mobile sheet stayed open after a nav tap. A tap on the current page's link
  // changes no path, so the tap itself must close it, not the route change.
  test("a tap on a link closes the mobile sheet, the current page's link too", () => {
    const item = NAV_GROUPS[0]?.items[0];
    if (item === undefined) throw new Error("no nav item");
    for (const active of [true, false]) {
      let closed = 0;
      const tree = NavLinkItem({ item, active, onNavigate: () => closed++ });
      const button = findElement(tree, SidebarMenuButton);
      if (button === null) throw new Error("no menu button");
      const onClick = (button.props as { onClick?: () => void }).onClick;
      onClick?.();
      expect(closed).toBe(1);
    }
  });

  test("only the current page's link is marked as the page", () => {
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <SidebarProvider>
          <NavMain />
        </SidebarProvider>
      </TooltipProvider>,
    );
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toContain('href="/" aria-current="page"');
  });
});
