"use client";

import { usePathname, useRouter } from "next/navigation";
import { FACTORY_ID, SANDBOX_ID, SANDBOX_NAME } from "@/lib/config";
import { useMyVaults } from "@/lib/myVaults";
import { rememberVault, useVault } from "@/lib/vault";
import { useWallet } from "@/lib/wallet";
import { Icon } from "./Icon";
import { Pill } from "./Pill";
import { Sheet } from "./Sheet";
import { VLoader } from "./VLoader";
import styles from "./VaultSwitcher.module.css";

/** Pick the vault to open: the shared sandbox, or one your wallet owns. */
export function VaultSwitcher({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const { vaultId, vaultName, state, selectVault } = useVault();
  const { accountId, connect } = useWallet();
  const mine = useMyVaults(open ? accountId : null);
  // A vault opened from a link that isn't this wallet's still shows, so it's clear what's open.
  const visiting = vaultId && vaultId !== SANDBOX_ID && mine !== null && !mine.some((v) => v.id === vaultId) ? vaultId : null;

  const pick = (id: string, label?: string) => {
    if (label) rememberVault(id, label);
    selectVault(id);
    onClose();
    // Decisions are numbered per vault, so another vault opens on its overview.
    if (pathname !== "/app") router.push("/app");
  };

  const row = (id: string, name: string, chip: string, sub: string, i: number, label?: string) => {
    const current = id === vaultId;
    return (
      <li key={id} className="rise" style={{ animationDelay: `${80 + i * 50}ms` }}>
        <button type="button" className={`${styles.row} press`} onClick={() => pick(id, label)} aria-current={current || undefined}>
          <span className={styles.avatar} aria-hidden="true">
            {name[0]?.toUpperCase()}
          </span>
          <span className={styles.text}>
            <span className={styles.name}>
              <span className={styles.nameText}>{name}</span>
              <span className={`${styles.chip} ${id === SANDBOX_ID ? styles.chipShared : styles.chipMine}`}>{chip}</span>
            </span>
            <span className={`mono ${styles.sub}`}>{sub}</span>
          </span>
          {current && <Icon name="check" size={18} stroke={2.2} className={styles.check} />}
        </button>
      </li>
    );
  };

  return (
    <Sheet open={open} onClose={onClose} labelledBy="vaults-title">
      <h2 id="vaults-title" className={styles.title}>Vaults</h2>
      <p className={styles.lead}>
        Anyone can act as the sandbox&apos;s owner. A vault you create belongs to your wallet: only you can change its rules or override a veto.
      </p>

      <ul className={styles.list}>
        {row(SANDBOX_ID, SANDBOX_NAME, "Shared sandbox", "No wallet needed", 0)}
        {accountId && mine === null && (
          <li className={styles.loading}>
            <VLoader size={20} />
            Finding your vaults
          </li>
        )}
        {mine?.map((v, i) => row(v.id, v.label, "Yours", v.id, i + 1, v.label))}
        {visiting && row(visiting, vaultName, "Owned vault", state?.config.owner ? `Owner ${state.config.owner}` : visiting, (mine?.length ?? 0) + 1)}
      </ul>

      {!accountId && FACTORY_ID && (
        <button type="button" className={`${styles.connect} press`} onClick={connect}>
          <Icon name="wallet" size={17} />
          Connect a wallet to see your vaults
        </button>
      )}
      {accountId && mine?.length === 0 && <p className={styles.none}>No vaults for {accountId} yet.</p>}

      <div className={styles.actions}>
        {FACTORY_ID && (mine?.length ?? 0) < 3 && (
          <Pill full icon="plus" href="/start/vault">
            Create your own vault
          </Pill>
        )}
        <Pill variant="secondary" size="md" full onClick={onClose}>
          Done
        </Pill>
      </div>
    </Sheet>
  );
}
