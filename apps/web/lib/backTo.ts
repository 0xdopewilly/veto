"use client";

import { usePathname } from "next/navigation";

// Where "Back" goes: the screen you came from, not a fixed one. The shell records each screen as
// you move; returning to the screen before the current one counts as going back and pops it, so
// payment → proof → back → back ends where you started instead of bouncing between the two.
const stack: string[] = [];

export function recordPath(path: string) {
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
  const at = stack.lastIndexOf(pathname);
  const before = at > 0 ? stack[at - 1] : undefined;
  const label = before && labelOf(before);
  return before && label ? { href: before, label } : fallback;
}
