import { Badge } from "@/components/ui/badge";

/**
 * A count on a tab (dashboard-01's round grey badge): a circle for one digit that grows into a
 * pill for more (`min-w-5`, never a fixed `size-5`), so a count like 128 is never cut by the
 * badge's own `overflow-hidden`.
 */
export function TabCount({ count }: { count: number }) {
  return (
    <Badge
      variant="secondary"
      className="h-5 min-w-5 rounded-full bg-muted-foreground/30 px-1 tabular-nums"
    >
      {count}
    </Badge>
  );
}
