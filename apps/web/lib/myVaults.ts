"use client";

import { useEffect, useState } from "react";
import { FACTORY_ID } from "./config";
import { view, type FactoryVault } from "./vault";

export type OwnedVault = FactoryVault & { id: string };

/** Vaults the factory created for this account, newest first; null while it loads. */
export function useMyVaults(accountId: string | null, reloadKey = 0): OwnedVault[] | null {
  const [list, setList] = useState<OwnedVault[] | null>(null);

  useEffect(() => {
    if (!accountId || !FACTORY_ID) {
      setList([]);
      return;
    }
    let cancelled = false;
    setList(null);
    view<[string, FactoryVault][]>(FACTORY_ID, "vaults_of", { owner: accountId })
      .then((rows) => {
        if (cancelled) return;
        const vaults = rows.map(([id, v]) => ({ id, ...v }));
        vaults.sort((a, b) => (BigInt(b.created_at) > BigInt(a.created_at) ? 1 : -1));
        setList(vaults);
      })
      .catch(() => !cancelled && setList([]));
    return () => {
      cancelled = true;
    };
  }, [accountId, reloadKey]);

  return list;
}
