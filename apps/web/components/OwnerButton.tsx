"use client";

import { useState } from "react";
import { useWallet, txHashOf } from "@/lib/wallet";
import { useVault } from "@/lib/vault";
import { useDemo } from "@/lib/demoClient";
import { Pill, type PillVariant } from "./Pill";
import { useToast } from "./Toaster";
import type { IconName } from "./Icon";
import styles from "./OwnerButton.module.css";

/**
 * A button that sends one owner transaction to the vault. With the owner wallet connected it
 * signs there; on the testnet demo, visitors without it act through the server's demo owner
 * key, and the button says so. Every send shows a transaction toast.
 */
export function OwnerButton({
  method,
  args = {},
  children,
  variant = "primary",
  size = "lg",
  icon,
  full,
  success = "Done",
  anyone = false,
  onDone,
  confirmTone = "dark",
}: {
  method: string;
  args?: Record<string, unknown>;
  children: string;
  variant?: PillVariant;
  size?: "lg" | "md" | "sm";
  icon?: IconName;
  full?: boolean;
  success?: string;
  /** Methods anyone may call, like executing an override that is due. */
  anyone?: boolean;
  onDone?: () => void;
  confirmTone?: "dark" | "ink";
}) {
  const { accountId, isOwner, connect, callVault } = useWallet();
  const { refresh } = useVault();
  const demo = useDemo();
  const toast = useToast();
  const [status, setStatus] = useState<"idle" | "pending" | "done" | "error">("idle");

  const viaDemo = !accountId && demo.canActAsOwner(method);
  const allowed = viaDemo || (anyone ? !!accountId : isOwner);

  const send = async () => {
    setStatus("pending");
    const result = await toast.track({
      pending: `${children}…`,
      success,
      run: async () => {
        const tx = viaDemo ? (await demo.owner(method, args)).tx : txHashOf(await callVault(method, args));
        return { tx };
      },
    });
    if (result) {
      setStatus("done");
      await refresh();
      onDone?.();
      setTimeout(() => setStatus("idle"), 2400);
    } else {
      setStatus("error");
    }
  };

  if (!accountId && !viaDemo) {
    return (
      <Pill variant={variant} size={size} full={full} icon="wallet" onClick={connect}>
        {anyone ? "Connect a wallet" : "Connect the owner wallet"}
      </Pill>
    );
  }

  return (
    <div className={`${styles.wrap} ${full ? styles.full : ""}`}>
      <Pill
        variant={variant}
        size={size}
        full={full}
        icon={status === "done" ? "check" : icon}
        loading={status === "pending"}
        disabled={!allowed}
        onClick={send}
      >
        {status === "done" ? success : children}
      </Pill>
      {viaDemo ? (
        <span className={`${styles.demo} ${confirmTone === "ink" ? styles.ink : ""}`}>
          <span className={styles.chip}>Testnet demo owner</span>
          <button type="button" className={styles.useWallet} onClick={connect}>
            Use my wallet
          </button>
        </span>
      ) : (
        <span className={`${styles.note} ${confirmTone === "ink" ? styles.ink : ""}`} role="status" aria-live="polite">
          {!allowed ? `Signed in as ${accountId}, which isn't the vault owner.` : ""}
        </span>
      )}
    </div>
  );
}
