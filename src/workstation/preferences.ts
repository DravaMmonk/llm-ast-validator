/**
 * Per-browser UI preferences: theme, nav rail collapse, the active dataset.
 *
 * These are conveniences, not business state — losing them changes nothing
 * that is saved — so they live in localStorage, behind try/catch, and every
 * reader tolerates their absence.
 */

import { useCallback, useEffect, useState } from "react";

const PREFIX = "wb:";

export function readPreference<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function writePreference(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Storage may be unavailable (private mode); the preference just won't stick.
  }
}

const listeners = new Map<string, Set<(value: unknown) => void>>();

/** A preference shared by every component that reads the same key. */
export function usePreference<T>(key: string, fallback: T): [T, (next: T) => void] {
  const [value, setValue] = useState<T>(() => readPreference(key, fallback));
  useEffect(() => {
    const set = listeners.get(key) ?? new Set();
    const listener = (next: unknown) => setValue(next as T);
    set.add(listener);
    listeners.set(key, set);
    return () => {
      set.delete(listener);
    };
  }, [key]);
  const update = useCallback(
    (next: T) => {
      writePreference(key, next);
      for (const listener of listeners.get(key) ?? []) listener(next);
    },
    [key],
  );
  return [value, update];
}

export type Theme = "light" | "dark";

function systemTheme(): Theme {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  } catch {
    return "light";
  }
}

/** Applies the theme class the console tokens key off (`.dark` on <html>). */
export function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle("dark", theme === "dark");
}

export function useTheme(): [Theme, (theme: Theme) => void] {
  const [stored, setStored] = usePreference<Theme | null>("theme", null);
  const theme = stored ?? systemTheme();
  useEffect(() => applyTheme(theme), [theme]);
  return [theme, setStored];
}
