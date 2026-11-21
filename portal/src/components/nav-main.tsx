"use client";

import { NAV_GROUPS, type NavItem, navItemFor } from "@/components/nav-items";
import { AppLink, useAppPath } from "@/components/router";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";

/**
 * One page's link. A tap calls `onNavigate`, the current page's link too: that tap changes no
 * path, so only the tap itself can close the mobile sheet.
 */
export function NavLinkItem({
  item,
  active,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  onNavigate: () => void;
}) {
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={active} tooltip={item.title} onClick={onNavigate}>
        <AppLink href={item.href} {...(active ? { "aria-current": "page" } : {})}>
          <item.icon aria-hidden="true" />
          <span>{item.title}</span>
        </AppLink>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

/** The sidebar's pages, in their groups; the page you are on is marked for a screen reader too. */
export function NavMain() {
  const current = navItemFor(useAppPath());
  const { setOpenMobile } = useSidebar();
  const closeMobile = () => setOpenMobile(false);
  return (
    <>
      {NAV_GROUPS.map((group) => (
        <SidebarGroup key={group.label}>
          <SidebarGroupLabel>{group.label}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {group.items.map((item) => (
                <NavLinkItem
                  key={item.href}
                  item={item}
                  active={current?.href === item.href}
                  onNavigate={closeMobile}
                />
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ))}
    </>
  );
}
