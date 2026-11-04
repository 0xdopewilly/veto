"use client";

import { useCallback, useEffect, useState } from "react";
import { SANDBOX_ID } from "./config";
import { useVault } from "./vault";

// Payment numbers restart in every vault, so the choice is kept per vault. The sandbox also reads
// the key used before vaults had their own, so earlier choices there still count.
const LEGACY_KEY = "veto:kept-blocked";
const keyFor = (vaultId: string) => `veto:kept-blocked:${vaultId}`;

function read(vaultId: string): Set<string> {
  try {
    const saved = localStorage.getItem(keyFor(vaultId)) ?? (vaultId === SANDBOX_ID ? localStorage.getItem(LEGACY_KEY) : null);
    return new Set(JSON.parse(saved ?? "[]") as string[]);
  } catch {
    return new Set();
  }
}

/**
 * Vetoed payments the owner chose to keep blocked. Nothing on-chain changes when you keep a
 * payment blocked, so this is remembered per browser and per vault to clear it from "Needs your
 * decision".
 */
export function useKeptBlocked() {
  const { vaultId } = useVault();
  const [kept, setKept] = useState<Set<string>>(() => new Set());

  useEffect(() => setKept(vaultId ? read(vaultId) : new Set()), [vaultId]);

  const keep = useCallback(
    (id: string) => {
      if (!vaultId) return;
      setKept((current) => {
        const next = new Set(current).add(id);
        try {
          localStorage.setItem(keyFor(vaultId), JSON.stringify([...next]));
        } catch {
          // Storage may be unavailable (private mode); the choice still holds for this visit.
        }
        return next;
      });
    },
    [vaultId],
  );

  return { kept, keep };
}
