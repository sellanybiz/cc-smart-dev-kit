/**
 * The mobile sidebar's parts that static markup can show: the sheet's plain backdrop and its
 * state, the close button, and the 44px touch targets. Radix renders a sheet's content and a
 * tooltip's content through a portal, which static markup leaves empty, so what they do when
 * tapped, pressed or hovered is checked in a browser, on the export `scripts/portal-preview.ts`
 * serves.
 */
import { describe, expect, test } from "bun:test";
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Sheet, SheetBackdrop, SheetCloseButton } from "@/components/ui/sheet";
import {
  returnFocusWithoutScroll,
  SidebarMenuButton,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";

/** The opening tag of the first element whose attributes hold `needle`. */
function tagWith(html: string, needle: string): string {
  const tag = (html.match(/<[a-z]+ [^>]*>/g) ?? []).find((one) => one.includes(needle));
  if (tag === undefined) throw new Error(`no tag with ${needle} in ${html}`);
  return tag;
}

function classes(tag: string): string[] {
  return (tag.match(/class="([^"]*)"/)?.[1] ?? "").split(/\s+/);
}

describe("the sheet's backdrop", () => {
  test("an open sheet's backdrop is a plain div that says open and takes the pointer", () => {
    const html = renderToStaticMarkup(
      <Sheet open>
        <SheetBackdrop />
      </Sheet>,
    );
    const tag = tagWith(html, 'data-slot="sheet-overlay"');
    expect(tag.startsWith("<div ")).toBe(true);
    expect(tag).toContain('data-state="open"');
    expect(classes(tag)).toContain("pointer-events-auto");
    // The page policy: no style attribute in the markup.
    expect(html).not.toContain("style=");
  });

  test("the backdrop follows the sheet's state, controlled or not", () => {
    const state = (sheet: ReactElement) =>
      tagWith(renderToStaticMarkup(sheet), 'data-slot="sheet-overlay"').match(
        /data-state="(\w+)"/,
      )?.[1];
    expect(
      state(
        <Sheet open={false}>
          <SheetBackdrop />
        </Sheet>,
      ),
    ).toBe("closed");
    expect(
      state(
        <Sheet defaultOpen>
          <SheetBackdrop />
        </Sheet>,
      ),
    ).toBe("open");
    expect(
      state(
        <Sheet>
          <SheetBackdrop />
        </Sheet>,
      ),
    ).toBe("closed");
  });
});

describe("44px targets on a phone and on a touch screen", () => {
  test("the sheet's close button is a named button of at least 44px there", () => {
    const html = renderToStaticMarkup(
      <Sheet open>
        <SheetCloseButton />
      </Sheet>,
    );
    const tag = tagWith(html, 'data-slot="sheet-close"');
    expect(tag.startsWith("<button ")).toBe(true);
    expect(classes(tag)).toEqual(expect.arrayContaining(["max-md:size-11", "pointer-coarse:size-11"]));
    expect(html).toContain('<span class="sr-only">Close</span>');
  });

  test("the sidebar's switch is 44px at the mobile width and on touch", () => {
    const html = renderToStaticMarkup(
      <SidebarProvider>
        <SidebarTrigger />
      </SidebarProvider>,
    );
    const tag = tagWith(html, 'data-sidebar="trigger"');
    expect(classes(tag)).toEqual(expect.arrayContaining(["max-md:size-11", "pointer-coarse:size-11"]));
  });

  test("a menu button of the default and small sizes is 44px in the mobile sheet and on touch", () => {
    for (const size of ["default", "sm"] as const) {
      const html = renderToStaticMarkup(
        <SidebarProvider>
          <SidebarMenuButton size={size}>Work</SidebarMenuButton>
        </SidebarProvider>,
      );
      const tag = tagWith(html, 'data-sidebar="menu-button"');
      expect(classes(tag)).toEqual(
        expect.arrayContaining(["in-data-[mobile=true]:h-11", "pointer-coarse:h-11"]),
      );
    }
  });
});

describe("closing the mobile sheet", () => {
  test("focus goes back to the header's switch without scrolling the page to it", () => {
    const focused: (FocusOptions | undefined)[] = [];
    let prevented = false;
    const close = returnFocusWithoutScroll({
      current: { focus: (options?: FocusOptions) => focused.push(options) },
    });
    close({
      preventDefault: () => {
        prevented = true;
      },
    });
    // Radix's own return is stopped: it finds no trigger and would leave focus on the body.
    expect(prevented).toBe(true);
    expect(focused).toEqual([{ preventScroll: true }]);
  });

  test("with no switch mounted, the close still stops Radix's return and focuses nothing", () => {
    let prevented = false;
    returnFocusWithoutScroll({ current: null })({
      preventDefault: () => {
        prevented = true;
      },
    });
    expect(prevented).toBe(true);
  });
});
