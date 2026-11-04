"use client";

import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";

// Where "Back" goes: the screen you came from, not a fixed one. The shell records each screen as
// you move; returning to the screen before the current one counts as going back and pops it, so
// payment → proof → back → back ends where you started instead of bouncing between the two.
const stack: string[] = [];

const LAST_APP = "veto:last-app-screen";

export function recordPath(path: string) {
  // Kept for the tab too, so the site's "Back to …" survives a reload of Docs or Bench.
  try {
    sessionStorage.setItem(LAST_APP, path);
  } catch {}
  if (stack[stack.length - 1] === path) return;
  if (stack[stack.length - 2] === path) stack.pop();
  else stack.push(path);
  if (stack.length > 40) stack.shift();
}

const PLACES: [RegExp, string][] = [
  [/^\/app$/, "Home"],
  [/^\/app\/decisions$/, "Activity"],
  [/^\/app\/rules$/, "Rules"],
  [/^\/app\/agents$/, "Agents"],
  [/^\/app\/decisions\/[^/]+$/, "the payment"],
];

const labelOf = (path: string) => PLACES.find(([re]) => re.test(path))?.[1];

/** The screen before this one, or `fallback` when you arrived here directly (a link, a reload). */
export function useBackTo(fallback: { href: string; label: string } = { href: "/app/decisions", label: "Activity" }) {
  const pathname = usePathname();
  const n = stack.length;
  // A screen's first render comes before the shell records it. Recorded: the one before it.
  // Arriving by going back (it's the one before the top): the one before that. Arriving
  // forward: the last one recorded.
  const before = stack[n - 1] === pathname ? stack[n - 2] : stack[n - 2] === pathname ? stack[n - 3] : stack[n - 1];
  const label = before && labelOf(before);
  return before && label ? { href: before, label } : fallback;
}

// The app screens the public pages (landing, Docs, Bench) can send you back to.
const RETURNS: [RegExp, string][] = [
  [/^\/app$/, "the app"],
  [/^\/app\/decisions$/, "Activity"],
  [/^\/app\/rules$/, "Rules"],
  [/^\/app\/agents$/, "Agents"],
  [/^\/app\/decisions\/[^/]+$/, "the payment"],
  [/^\/app\/decisions\/[^/]+\/proof$/, "the proof"],
];

function lastAppScreen(): string | null {
  const recorded = stack[stack.length - 1];
  if (recorded) return recorded;
  try {
    return sessionStorage.getItem(LAST_APP);
  } catch {
    return null;
  }
}

const still = () => () => {};

/**
 * The app screen you left to read the site, or null if you haven't opened the app in this tab.
 * Null on the server and while hydrating, so the page renders the same as it was sent.
 */
export function useAppReturn(): { href: string; label: string } | null {
  const path = useSyncExternalStore(still, lastAppScreen, () => null);
  if (!path) return null;
  const label = RETURNS.find(([re]) => re.test(path))?.[1];
  return label ? { href: path, label } : { href: "/app", label: "the app" };
}
