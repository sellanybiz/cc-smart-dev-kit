"use client";

/**
 * The portal's theme choice: Auto (the OS), Light or Dark.
 *
 * No inline script and no `next-themes`: the CSS tokens use `light-dark()`, so the first paint
 * already follows the OS. This provider only records an explicit choice in localStorage and
 * writes `data-theme` on <html>. That keeps the page compatible with a strict content policy
 * (`script-src 'self'`), with no un-hashed inline script of our own.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type Theme = "dark" | "light" | "system";
export type ResolvedTheme = "dark" | "light";

const STORAGE_KEY = "cc-smart-dev-kit-portal-theme";

interface ThemeContextValue {
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
  theme: Theme;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function isTheme(value: null | string): value is Theme {
  return value === "system" || value === "light" || value === "dark";
}

function systemTheme(): ResolvedTheme {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === "system") {
    delete root.dataset.theme;
  } else {
    root.dataset.theme = theme;
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("system");
  const [system, setSystem] = useState<ResolvedTheme>("light");

  useEffect(() => {
    let stored: null | string = null;
    try {
      stored = window.localStorage.getItem(STORAGE_KEY);
    } catch {
      // Private mode or blocked site data: the OS choice still works.
    }
    const initial = isTheme(stored) ? stored : "system";
    setThemeState(initial);
    applyTheme(initial);
    setSystem(systemTheme());

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setSystem(systemTheme());
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    applyTheme(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // A choice that cannot be stored still applies for this page.
    }
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ resolvedTheme: theme === "system" ? system : theme, setTheme, theme }),
    [system, setTheme, theme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (context === null) throw new Error("useTheme needs a ThemeProvider around it");
  return context;
}
