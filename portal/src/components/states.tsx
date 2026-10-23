"use client";

import { CircleAlertIcon, PlugZapIcon, RotateCwIcon, SearchXIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { Resource } from "@/api/hooks";
import { CommandLine } from "@/components/copy-button";
import { AppLink } from "@/components/router";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { KIT_NAME } from "@/lib/format";

/** The page's padding, the block's own (`px-4 lg:px-6`). */
export function PagePad({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`px-4 lg:px-6 ${className}`}>{children}</div>;
}

/** A page still loading: grey shapes where the cards and the table will be. */
export function LoadingState({ label }: { label: string }) {
  return (
    <PagePad>
      <div role="status" aria-live="polite" className="flex flex-col gap-4 md:gap-6">
        <span className="sr-only">Loading {label}…</span>
        <div className="grid grid-cols-1 gap-4 @xl/main:grid-cols-2 @5xl/main:grid-cols-4">
          {["a", "b", "c", "d"].map((key) => (
            <Skeleton key={key} className="h-32 rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-72 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    </PagePad>
  );
}

/** A page whose data did not come: what failed, in words, and a way to ask again. */
export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <PagePad>
      <Card role="alert" className="max-w-2xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CircleAlertIcon className="size-5 text-bad" aria-hidden="true" />
            This page could not load
          </CardTitle>
          <CardDescription>{message}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <Button onClick={onRetry} variant="outline">
            <RotateCwIcon aria-hidden="true" />
            Try again
          </Button>
          <p className="text-sm text-muted-foreground">
            If the portal stopped, start it again with{" "}
            <code className="font-mono text-foreground">{KIT_NAME} portal</code>.
          </p>
        </CardContent>
      </Card>
    </PagePad>
  );
}

/** Overview, Slots and Health need the gateway: with none, this page says so (portal.md). */
export function GatewayNotSetUp() {
  return (
    <PagePad>
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <PlugZapIcon className="size-5 text-muted-foreground" aria-hidden="true" />
            The gateway is not set up
          </CardTitle>
          <CardDescription>
            This page shows the gateway's slots and traffic, and this machine has no gateway yet.
            Set it up in a terminal:
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-start gap-4">
          <CommandLine command={`${KIT_NAME} gateway setup`} label="Copy" />
          <Button asChild variant="outline">
            <AppLink href="/machine">Open Machine</AppLink>
          </Button>
        </CardContent>
      </Card>
    </PagePad>
  );
}

/** A page whose subject is not there (the server answered 404): why, and the way back. */
export function MissingState({
  message,
  back,
}: {
  message: string;
  back: { href: string; label: string };
}) {
  return (
    <PagePad>
      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SearchXIcon className="size-5 text-muted-foreground" aria-hidden="true" />
            Nothing here by that name
          </CardTitle>
          <CardDescription>{message}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <AppLink href={back.href}>{back.label}</AppLink>
          </Button>
        </CardContent>
      </Card>
    </PagePad>
  );
}

/** Nothing to show yet: what will appear here, and what makes it appear. */
export function EmptyState({
  title,
  children,
  icon,
}: {
  title: string;
  children: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-10 text-center">
      {icon}
      <p className="font-medium">{title}</p>
      <div className="max-w-prose text-sm text-muted-foreground">{children}</div>
    </div>
  );
}

/** Draws a resource's loading and error states, and the page once its data is there. */
export function ResourceView<T>({
  resource,
  label,
  children,
  back = { href: "/", label: "Open Overview" },
}: {
  resource: Resource<T> & { reload: () => void };
  label: string;
  children: (data: T) => ReactNode;
  /** Where a page whose subject is not there sends the person. */
  back?: { href: string; label: string };
}) {
  if (resource.status === "loading") return <LoadingState label={label} />;
  if (resource.status === "error") {
    if (resource.gateway) return <GatewayNotSetUp />;
    if (resource.missing) return <MissingState message={resource.message} back={back} />;
    return <ErrorState message={resource.message} onRetry={resource.reload} />;
  }
  return <>{children(resource.data)}</>;
}
