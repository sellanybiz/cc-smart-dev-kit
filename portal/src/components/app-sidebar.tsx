"use client";

import { WaypointsIcon } from "lucide-react";
import * as React from "react";
import { NavMachine } from "@/components/nav-machine";
import { NavMain } from "@/components/nav-main";
import { AppLink, useAppPath } from "@/components/router";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { KIT_NAME } from "@/lib/format";

/** dashboard-01's inset sidebar: it folds to its icons, and opens as a sheet on a phone. */
export function AppSidebar(props: React.ComponentProps<typeof Sidebar>) {
  const { setOpenMobile } = useSidebar();
  // The mobile sheet closes whenever the page changes, however it changed: a link, the
  // browser's back button, a link inside the page. A tap on a link closes it too, since a tap
  // on the current page's link changes no path.
  const path = useAppPath();
  const shownPath = React.useRef(path);
  React.useEffect(() => {
    if (shownPath.current === path) return;
    shownPath.current = path;
    setOpenMobile(false);
  }, [path, setOpenMobile]);
  return (
    <Sidebar collapsible="icon" {...props}>
      {/* In the mobile sheet the sheet's close button sits at the top right: the kit's link
          stops short of it, so a tap there never lands on both. */}
      <SidebarHeader className="in-data-[mobile=true]:pr-14">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              size="lg"
              tooltip={KIT_NAME}
              onClick={() => setOpenMobile(false)}
            >
              <AppLink href="/">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
                  <WaypointsIcon aria-hidden="true" />
                </span>
                <span className="grid flex-1 text-left leading-tight">
                  <span className="truncate text-sm font-semibold">{KIT_NAME}</span>
                  <span className="truncate text-xs text-muted-foreground">Portal</span>
                </span>
              </AppLink>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <NavMain />
      </SidebarContent>
      <SidebarFooter>
        <NavMachine />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}
