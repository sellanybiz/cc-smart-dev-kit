"use client";

import { NAV_GROUPS, navItemFor } from "@/components/nav-items";
import { AppLink, useAppPath } from "@/components/router";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";

/** The sidebar's pages, in their groups; the page you are on is marked for a screen reader too. */
export function NavMain() {
  const current = navItemFor(useAppPath());
  return (
    <>
      {NAV_GROUPS.map((group) => (
        <SidebarGroup key={group.label}>
          <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {group.items.map((item) => {
                const active = current?.href === item.href;
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton asChild isActive={active} tooltip={item.title}>
                      <AppLink href={item.href} {...(active ? { "aria-current": "page" } : {})}>
                        <item.icon aria-hidden="true" />
                        <span>{item.title}</span>
                      </AppLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ))}
    </>
  );
}
