"use client";

import { useState } from "react";
import type { Proposal } from "@veto/core/proposal";
import { SANDBOX_ID } from "@/lib/config";
import { reasonText } from "@/lib/decision";
import { Pill } from "./Pill";
import styles from "./ShareCatch.module.css";

/**
 * Share a veto: the link previews as a card of what was stopped and why (app/api/card), so a catch
 * posted on X shows itself and leads back here, to the proof. On a phone it opens the share sheet.
 */
export function ShareCatch({ p, vaultId, amount, to }: { p: Proposal; vaultId: string | null; amount: string; to: string }) {
  const [copied, setCopied] = useState(false);
  const link = () => {
    const url = new URL(`/app/decisions/${p.id}`, window.location.origin);
    if (vaultId && vaultId !== SANDBOX_ID) url.searchParams.set("vault", vaultId);
    return url.toString();
  };
  const why = p.verdict?.reasons[0] ? reasonText(p.verdict.reasons[0]) : "the payment didn't match the evidence";
  const text = `Veto just stopped an AI agent from paying ${amount} to ${to}.\n\nWhy: ${why}. Nothing moved.\n\nCan you fool it?`;

  const share = async () => {
    const url = link();
    // Phones: the system share sheet. Desktops: a post on X with the link in it.
    if (navigator.share && window.matchMedia("(pointer: coarse)").matches) {
      await navigator.share({ text, url }).catch(() => {});
      return;
    }
    window.open(`https://x.com/intent/post?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`, "_blank", "noopener,noreferrer");
  };
  const copy = () =>
    navigator.clipboard
      ?.writeText(link())
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      })
      .catch(() => {});

  return (
    <div className={styles.share}>
      <p className={styles.label}>Share this catch. The link shows what was stopped, and why.</p>
      <div className={styles.buttons}>
        <Pill variant="ink" size="md" icon="send" onClick={share}>
          Share
        </Pill>
        <Pill variant="inkOutline" size="md" icon={copied ? "check" : undefined} onClick={copy}>
          {copied ? "Link copied" : "Copy link"}
        </Pill>
      </div>
    </div>
  );
}
