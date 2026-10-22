"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * An action the portal cannot run yet (Stop, Resume, Remove): drawn where it will be, marked
 * `aria-disabled` so it still takes focus, and saying why on hover and on focus.
 */
export function LaterAction({
  icon,
  children,
  label,
}: {
  icon: ReactNode;
  children: ReactNode;
  label: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          aria-disabled="true"
          aria-label={`${label} (not available yet)`}
          className="cursor-not-allowed opacity-50"
          onClick={(event) => event.preventDefault()}
        >
          {icon}
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>This comes with the portal's actions.</TooltipContent>
    </Tooltip>
  );
}
