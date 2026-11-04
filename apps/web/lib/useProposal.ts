"use client";

import { useEffect, useState } from "react";
import type { Proposal } from "@veto/core/proposal";
import { useVault } from "./vault";

/** A proposal by id: from the polled list, or fetched on its own if it's older than that. */
export function useProposal(id: string): { proposal: Proposal | null; missing: boolean } {
  const { state, reader } = useVault();
  const fromList = state?.proposals.find((p) => p.id === id) ?? null;
  const [single, setSingle] = useState<Proposal | null>(null);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    if (!state || fromList) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Only the chain saying "no such payment" makes it missing; a failed read is retried.
    const load = (attempt: number) =>
      reader
        .proposal(id)
        .then((p) => {
          if (cancelled) return;
          setSingle(p);
          setMissing(!p);
        })
        .catch(() => {
          if (!cancelled && attempt < 5) timer = setTimeout(() => load(attempt + 1), 1200 * (attempt + 1));
        });
    void load(0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [state, fromList, id, reader]);

  return { proposal: fromList ?? single, missing: !fromList && missing };
}
