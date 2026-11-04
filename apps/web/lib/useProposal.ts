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
    reader
      .proposal(id)
      .then((p) => {
        if (cancelled) return;
        setSingle(p);
        setMissing(!p);
      })
      .catch(() => !cancelled && setMissing(true));
    return () => {
      cancelled = true;
    };
  }, [state, fromList, id, reader]);

  return { proposal: fromList ?? single, missing: !fromList && missing };
}
