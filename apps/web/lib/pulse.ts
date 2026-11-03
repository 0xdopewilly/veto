"use client";

import { useRef } from "react";
import { toneOf } from "./decision";
import { useVault } from "./vault";

/**
 * The newest decision, once it differs from what was there when the app opened: a key that
 * restarts a CSS animation, and its tone. The brand mark uses it to pulse when a payment lands.
 */
export function useDecisionPulse(): { key: string; tone: "pass" | "veto" | "pending" } | null {
  const { state } = useVault();
  const latest = state?.proposals[0];
  const key = latest ? `${latest.id}:${latest.status}` : null;
  const initial = useRef<string | null | undefined>(undefined);
  if (initial.current === undefined && state) initial.current = key;
  if (!latest || key === initial.current) return null;
  const tone = toneOf(latest.status);
  return { key: key!, tone: tone === "neutral" ? "pending" : tone };
}
