"use client";

import { useCallback, useEffect, useState } from "react";

const KEY = "veto:kept-blocked";

function read(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(KEY) ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

/**
 * Vetoed payments the owner chose to keep blocked. Nothing on-chain changes when you keep a
 * payment blocked, so this is remembered per browser to clear it from "Needs your decision".
 */
export function useKeptBlocked() {
  const [kept, setKept] = useState<Set<string>>(() => new Set());

  useEffect(() => setKept(read()), []);

  const keep = useCallback((id: string) => {
    setKept((current) => {
      const next = new Set(current).add(id);
      try {
        localStorage.setItem(KEY, JSON.stringify([...next]));
      } catch {
        // Storage may be unavailable (private mode); the choice still holds for this visit.
      }
      return next;
    });
  }, []);

  return { kept, keep };
}
