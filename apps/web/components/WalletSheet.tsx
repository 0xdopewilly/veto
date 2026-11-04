"use client";

import { useEffect, useState } from "react";
import { EXPLORER, NETWORK } from "@/lib/config";
import { nearBalance, useVault } from "@/lib/vault";
import { useWallet } from "@/lib/wallet";
import { Icon } from "./Icon";
import { Pill } from "./Pill";
import { Sheet, SheetHeader } from "./Sheet";
import { VLoader } from "./VLoader";
import styles from "./WalletSheet.module.css";

/** The connected wallet: who it is, what it can do here, its test NEAR, and a way out. */
export function WalletSheet({ open, onClose, onVaults }: { open: boolean; onClose: () => void; onVaults: () => void }) {
  const { accountId, isOwner, disconnect, gas } = useWallet();
  const { isSandbox } = useVault();
  const [balance, setBalance] = useState<bigint | null | undefined>(undefined);

  useEffect(() => {
    if (!open || !accountId) return;
    let live = true;
    setBalance(undefined);
    nearBalance(accountId)
      .then((b) => live && setBalance(b))
      .catch(() => live && setBalance(null));
    return () => {
      live = false;
    };
  }, [open, accountId, gas.state]);

  const role = isOwner ? "Owns this vault" : isSandbox ? "Anyone can act as the sandbox's owner" : "Not this vault's owner";

  return (
    <Sheet open={open && !!accountId} onClose={onClose} labelledBy="wallet-title" header={<SheetHeader id="wallet-title" title="Wallet" onClose={onClose} />}>
      {accountId && (
        <>
          <div className={styles.account}>
            <span className={styles.avatar} aria-hidden="true">
              {accountId[0].toUpperCase()}
            </span>
            <span className={styles.who}>
              <span className={`mono ${styles.id}`}>{accountId}</span>
              <span className={styles.role} data-owner={isOwner || undefined}>
                <span className={styles.roleDot} aria-hidden="true" />
                {role}
              </span>
            </span>
          </div>

          <dl className={styles.facts}>
            <div>
              <dt>Test NEAR for gas</dt>
              <dd>
                {balance === undefined ? <VLoader size={16} /> : balance === null ? "Couldn't read it" : `${(Number(balance) / 1e24).toFixed(4)} NEAR`}
              </dd>
            </div>
            <div>
              <dt>Network</dt>
              <dd>{NETWORK === "testnet" ? "NEAR testnet" : "NEAR mainnet"}</dd>
            </div>
          </dl>
          {gas.state === "sending" && <p className={styles.note}>Sending your wallet free test NEAR for gas…</p>}
          {gas.state === "sent" && <p className={`${styles.note} ${styles.good}`}>Sent your wallet {gas.amount} test NEAR for gas, free.</p>}
          {gas.state === "failed" && <p className={`${styles.note} ${styles.bad}`}>{gas.reason}</p>}

          <div className={styles.actions}>
            <Pill
              variant="secondary"
              size="md"
              full
              icon="users"
              onClick={() => {
                onClose();
                onVaults();
              }}
            >
              Your vaults
            </Pill>
            <a className={`${styles.link} press`} href={`${EXPLORER}/address/${accountId}`} target="_blank" rel="noreferrer">
              See this wallet on NearBlocks <Icon name="external" size={14} />
            </a>
            <Pill
              variant="ghost"
              size="md"
              full
              onClick={async () => {
                onClose();
                await disconnect();
              }}
            >
              Disconnect
            </Pill>
          </div>
        </>
      )}
    </Sheet>
  );
}
