"use client";

import { AppLink } from "@/components/router";
import { PagePad } from "@/components/states";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/** A page that does not exist. Next's own 404 holds inline styles; this one draws in the frame. */
export function NotFoundView() {
  return (
    <PagePad>
      <Card className="max-w-xl">
        <CardHeader>
          <CardTitle>There is no such page</CardTitle>
          <CardDescription>The address names a page the portal does not have.</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <AppLink href="/">Open Overview</AppLink>
          </Button>
        </CardContent>
      </Card>
    </PagePad>
  );
}
