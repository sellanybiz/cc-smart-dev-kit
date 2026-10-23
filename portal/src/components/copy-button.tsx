"use client";

import { CheckIcon, CopyIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

type CopyState = "idle" | "copied" | "failed";

/** Copies a command for the person to run. It says what it did, in words a screen reader hears. */
export function CopyButton({
  text,
  label,
  size = "sm",
}: {
  text: string;
  label: string;
  size?: "sm" | "default";
}) {
  const [state, setState] = useState<CopyState>("idle");
  useEffect(() => {
    if (state === "idle") return;
    const timer = setTimeout(() => setState("idle"), 2000);
    return () => clearTimeout(timer);
  }, [state]);
  return (
    <Button
      variant="outline"
      size={size}
      onClick={() => {
        navigator.clipboard.writeText(text).then(
          () => setState("copied"),
          () => setState("failed"),
        );
      }}
      aria-label={`${label}: ${text}`}
    >
      {state === "copied" ? (
        <CheckIcon data-icon="inline-start" aria-hidden="true" />
      ) : (
        <CopyIcon data-icon="inline-start" aria-hidden="true" />
      )}
      <span aria-live="polite">
        {state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : label}
      </span>
    </Button>
  );
}

/** A command to copy, in the page's mono text, with its copy button beside it. */
export function CommandLine({ command, label }: { command: string; label: string }) {
  return (
    <span className="flex flex-wrap items-center gap-2">
      <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs wrap-anywhere">
        {command}
      </code>
      <CopyButton text={command} label={label} />
    </span>
  );
}
