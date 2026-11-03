"use client";

import { useEffect, useState, type ReactNode } from "react";

/**
 * Mounts its children a moment after the screen around them, so a heavy screen paints its hero
 * in the first frame and builds the rest in smaller pieces. Callers subtract this wait from their
 * entrance delays, so nothing appears later than designed.
 */
export function Deferred({ children, ms = 260 }: { children: ReactNode; ms?: number }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setReady(true), ms);
    return () => clearTimeout(t);
  }, [ms]);
  return ready ? <>{children}</> : null;
}
