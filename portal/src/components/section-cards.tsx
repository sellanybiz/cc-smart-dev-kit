"use client";

import type { ReactNode } from "react";
import {
  Card,
  CardAction,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

/**
 * dashboard-01's section cards, as a grid any page fills. `columns` is the most a wide page
 * shows in one row; a narrower page folds to two, then one.
 */
export function SectionCards({
  children,
  columns = 4,
}: {
  children: ReactNode;
  columns?: 3 | 4 | 5;
}) {
  return (
    <div
      className={cn(
        "grid grid-cols-1 gap-4 px-4 *:data-[slot=card]:bg-gradient-to-t *:data-[slot=card]:from-primary/5 *:data-[slot=card]:to-card *:data-[slot=card]:shadow-xs lg:px-6 @xl/main:grid-cols-2 dark:*:data-[slot=card]:bg-card",
        columns === 3 && "@4xl/main:grid-cols-3",
        columns === 4 && "@5xl/main:grid-cols-4",
        columns === 5 && "@4xl/main:grid-cols-3 @7xl/main:grid-cols-5",
      )}
    >
      {children}
    </div>
  );
}

/** One card: what it counts, the number, a state at its corner, and two lines that explain. */
export function StatCard({
  label,
  value,
  badge,
  headline,
  detail,
  className,
}: {
  label: string;
  value: ReactNode;
  badge?: ReactNode;
  headline?: ReactNode;
  detail?: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("@container/card", className)}>
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
          {value}
        </CardTitle>
        {badge !== undefined && <CardAction>{badge}</CardAction>}
      </CardHeader>
      {(headline !== undefined || detail !== undefined) && (
        <CardFooter className="flex-col items-start gap-1.5 text-sm">
          {headline !== undefined && (
            <div className="line-clamp-1 flex items-center gap-2 font-medium">{headline}</div>
          )}
          {detail !== undefined && <div className="text-muted-foreground">{detail}</div>}
        </CardFooter>
      )}
    </Card>
  );
}
