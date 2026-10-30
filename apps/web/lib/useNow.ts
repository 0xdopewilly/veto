"use client";

import { useEffect, useState } from "react";

/** The current time, re-rendered every `intervalMs` for countdowns and "2 min ago". */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}
