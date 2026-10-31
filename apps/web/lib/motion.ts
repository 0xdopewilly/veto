"use client";

import { createContext, useContext } from "react";
import { useMediaQuery } from "./media";
import type { Transition } from "motion/react";

/** Small UI: buttons, pills, indicators. Settles fast with a hint of overshoot. */
export const SPRING_UI: Transition = { type: "spring", stiffness: 380, damping: 32, mass: 0.9 };
/** Large surfaces: screens, sheets, panels. Softer and heavier. */
export const SPRING_SURFACE: Transition = { type: "spring", stiffness: 170, damping: 26, mass: 1 };
/** Things that should land with a bounce: icons, checks, toasts. */
export const SPRING_BOUNCE: Transition = { type: "spring", stiffness: 420, damping: 22, mass: 0.8 };
/** Odometer digits. */
export const SPRING_DIGIT: Transition = { type: "spring", stiffness: 140, damping: 20, mass: 1 };

/** The circle that opens a decision: fast start, long soft landing. */
export const EASE_REVEAL = [0.83, 0, 0.17, 1] as const;
export const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as const;

/**
 * True when the visitor has asked for less motion. False while hydrating (the server can't
 * know), then the real preference, so server and client markup always match.
 */
export function useCalm(): boolean {
  return useMediaQuery("(prefers-reduced-motion: reduce)");
}

/** True inside a screen you came back to (Back, or a pop): it shows as it was, without replaying its entrance. */
export const ReturnContext = createContext(false);

/** Whether entrance animations should play: not for reduced motion, not on a screen you returned to. */
export function useEntrance(): boolean {
  const calm = useCalm();
  return !calm && !useContext(ReturnContext);
}
