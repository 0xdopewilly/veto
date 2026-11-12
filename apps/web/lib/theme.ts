"use client";

import { useCallback, useSyncExternalStore } from "react";

// The theme lives on <html data-theme>, set before the first paint by the script in
// app/layout.tsx. With nothing saved it follows the system; a tap on the toggle saves a choice.
export type Theme = "light" | "dark";

const KEY = "veto:theme";
const listeners = new Set<() => void>();

const current = (): Theme => (document.documentElement.dataset.theme === "light" ? "light" : "dark");

function apply(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) meta.setAttribute("content", theme === "light" ? "#f2f1e9" : "#000000");
  for (const l of listeners) l();
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  const system = window.matchMedia("(prefers-color-scheme: light)");
  const follow = () => {
    if (document.documentElement.dataset.themePref === "system") apply(system.matches ? "light" : "dark");
  };
  system.addEventListener("change", follow);
  return () => {
    listeners.delete(onChange);
    system.removeEventListener("change", follow);
  };
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, current, () => "dark" as Theme);
  // `from` is the toggle's centre: the new theme spreads from there as a circle.
  const toggle = useCallback((from?: { x: number; y: number }) => {
    const next: Theme = current() === "light" ? "dark" : "light";
    const root = document.documentElement;
    try {
      localStorage.setItem(KEY, next);
    } catch {}
    root.dataset.themePref = next;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!document.startViewTransition || still) return apply(next);
    if (from) {
      root.style.setProperty("--vt-x", `${from.x}px`);
      root.style.setProperty("--vt-y", `${from.y}px`);
    }
    root.dataset.themeSwitch = "";
    const t = document.startViewTransition(() => apply(next));
    t.finished.finally(() => delete root.dataset.themeSwitch);
  }, []);
  return { theme, toggle };
}
