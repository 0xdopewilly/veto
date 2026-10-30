"use client";

import { useWallet, useTx } from "@/lib/wallet";
import { Pill, type PillVariant } from "./Pill";
import type { IconName } from "./Icon";
import styles from "./OwnerButton.module.css";

/**
 * A button that sends one owner transaction to the vault. Signed-out visitors are asked to
 * connect the owner wallet; other accounts see why they can't act.
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
  const { accountId, isOwner, connect } = useWallet();
  const tx = useTx();
  const allowed = anyone ? !!accountId : isOwner;

  if (!accountId) {
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
        icon={tx.status === "done" ? "check" : icon}
        loading={tx.status === "pending"}
        disabled={!allowed}
        onClick={async () => {
          if (await tx.run(method, args, success)) onDone?.();
        }}
      >
        {tx.status === "done" ? success : children}
      </Pill>
      <span className={`${styles.note} ${confirmTone === "ink" ? styles.ink : ""}`} role="status" aria-live="polite">
        {!allowed ? `Signed in as ${accountId}, which isn't the vault owner.` : tx.status === "error" ? tx.message : ""}
      </span>
    </div>
  );
}
