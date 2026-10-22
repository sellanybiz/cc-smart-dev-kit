"use client";

import { WaypointsIcon } from "lucide-react";
import type * as React from "react";
import { NavMachine } from "@/components/nav-machine";
import { NavMain } from "@/components/nav-main";
import { AppLink } from "@/components/router";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { KIT_NAME } from "@/lib/format";

/** dashboard-01's inset sidebar: it folds to its icons, and opens as a sheet on a phone. */
export function AppSidebar(props: React.ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild size="lg" tooltip={KIT_NAME}>
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
