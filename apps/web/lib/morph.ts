"use client";

import { useSyncExternalStore } from "react";

/**
 * The circle transition between a "Needs your decision" card and its decision screen.
 *
 *   open:  grow (circle expands from the tap point) → covered (route swaps underneath)
 *          → fade (overlay fades, the decision plays its entrance) → idle
 *   back:  full (overlay covers the decision) → shrink (circle collapses into the card) → idle
 *
 * While the destination is hidden it is "held": its entrance animations wait for the reveal.
 */
export type MorphPhase = "idle" | "grow" | "covered" | "fade" | "full" | "shrink";

export interface MorphState {
  phase: MorphPhase;
  x: number;
  y: number;
  color: string;
  key: number;
}

let state: MorphState = { phase: "idle", x: 0, y: 0, color: "#ff7966", key: 0 };
let arrived = false;
let fullAt = 0;
/** How long the cover takes to fade in when going back. */
export const COVER_MS = 200;
let fallback: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();
/** Where each decision was opened from, so Back can collapse into the same spot. */
const origins = new Map<string, { x: number; y: number; color: string }>();

function set(next: Partial<MorphState>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useMorph(): MorphState {
  return useSyncExternalStore(subscribe, () => state, () => state);
}

/** True while the destination screen is still hidden under the circle. */
export function useMorphHold(): boolean {
  const s = useMorph();
  return s.phase === "grow" || s.phase === "covered";
}

const calm = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function morphOpen(opts: { id: string; x: number; y: number; color: string; href: string; push: (href: string) => void }) {
  if (calm() || state.phase !== "idle") {
    opts.push(opts.href);
    return;
  }
  origins.set(opts.id, { x: opts.x, y: opts.y, color: opts.color });
  arrived = false;
  set({ phase: "grow", x: opts.x, y: opts.y, color: opts.color, key: state.key + 1 });
  // Swap the route once the circle covers most of the screen.
  setTimeout(() => opts.push(opts.href), 400);
}

/** The overlay finished growing. */
export function morphGrown() {
  if (state.phase !== "grow") return;
  set({ phase: "covered" });
  if (arrived) set({ phase: "fade" });
  else fallback = setTimeout(() => state.phase === "covered" && set({ phase: "fade" }), 1400);
}

/** The new route has mounted. */
export function morphArrived() {
  arrived = true;
  clearTimeout(fallback);
  if (state.phase === "covered") set({ phase: "fade" });
  // Going back, let the cover finish fading in before the circle starts to close.
  if (state.phase === "full") setTimeout(() => state.phase === "full" && set({ phase: "shrink" }), Math.max(0, fullAt + COVER_MS - Date.now()));
}

export function morphBack(opts: { id: string; href: string; push: (href: string) => void }): boolean {
  const origin = origins.get(opts.id);
  if (!origin || calm() || state.phase !== "idle") return false;
  origins.delete(opts.id);
  arrived = false;
  fullAt = Date.now();
  set({ phase: "full", x: origin.x, y: origin.y, color: origin.color, key: state.key + 1 });
  // Swap the route once the cover is opaque.
  setTimeout(() => opts.push(opts.href), COVER_MS);
  fallback = setTimeout(() => state.phase === "full" && set({ phase: "shrink" }), 1600);
  return true;
}

export function morphDone() {
  clearTimeout(fallback);
  set({ phase: "idle" });
}

export function isMorphing(): boolean {
  return state.phase !== "idle";
}
