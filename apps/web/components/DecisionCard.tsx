"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, type MouseEvent } from "react";
import type { Proposal } from "@veto/core/proposal";
import { metaOf, type VaultState } from "@/lib/vault";
import { imitated, reasonText } from "@/lib/decision";
import { formatAgo, formatShort, remaining, possessive, chainLabel } from "@/lib/format";
import { morphOpen } from "@/lib/morph";
import { useNow } from "@/lib/useNow";
import { Icon } from "./Icon";
import styles from "./DecisionCard.module.css";

export const CORAL = "#ff7966";
export const PURPLE = "#9797ff";

/** The words on a decision card: what was held and why, or the override countdown. */
export function useDecisionCopy(state: VaultState, proposal: Proposal) {
  const now = useNow(1000);
  const meta = metaOf(state, proposal.request.asset);
  const amount = formatShort(proposal.request.amount, meta);
  const look = imitated(state.payees, proposal);
  const pending = proposal.status === "OverridePending";

  if (pending && proposal.override_executes_at) {
    const left = remaining(proposal.override_executes_at, now);
    const span = left.hours ? `${left.hours} h ${left.minutes} min` : `${left.minutes} min ${left.seconds} s`;
    return {
      pending,
      eyebrow: "Override pending",
      headline: left.done ? `${amount} override is due.` : `${amount} pays in ${span}.`,
      detail: left.done ? "Ready to pay · you can still cancel" : "Override pending · you can cancel",
    };
  }
  return {
    pending,
    eyebrow: "Needs your decision",
    headline: look
      ? `${amount} held. Sent to a lookalike of ${possessive(look.payee.name)} address.`
      : `${amount} held. ${proposal.verdict?.reasons[0] ? reasonText(proposal.verdict.reasons[0]) : "Stopped by the AI screen"}.`,
    detail: `Vetoed ${formatAgo(proposal.verdict?.recorded_at ?? proposal.created_at, now)} · ${chainLabel(proposal.request.chain)}`,
  };
}

// The router's "full" prefetch kind: route data and code, so the circle never waits on the network.
const FULL = { kind: "full" } as unknown as Parameters<ReturnType<typeof useRouter>["prefetch"]>[1];

/** Warms a decision route ahead of the tap, for cards that are likely to be opened. */
export function usePrefetchDecision(id: string) {
  const router = useRouter();
  useEffect(() => {
    router.prefetch(`/app/decisions/${id}`, FULL);
  }, [router, id]);
}

/**
 * Opens a decision with the circle transition, growing from where it was tapped (or from the
 * middle of the element for keyboard presses). Modified clicks keep the browser's behaviour.
 */
export function useOpenDecision() {
  const router = useRouter();
  return useCallback((e: MouseEvent<HTMLElement>, id: string, color: string) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    router.prefetch(`/app/decisions/${id}`, FULL);
    const rect = e.currentTarget.getBoundingClientRect();
    const keyboard = e.clientX === 0 && e.clientY === 0;
    morphOpen({
      id,
      x: keyboard ? rect.left + rect.width / 2 : e.clientX,
      y: keyboard ? rect.top + rect.height / 2 : e.clientY,
      color,
      href: `/app/decisions/${id}`,
      push: router.push,
    });
  }, [router]);
}

/** The coral "Needs your decision" card, or purple while an override counts down. */
export function DecisionCard({ state, proposal, style }: { state: VaultState; proposal: Proposal; style?: React.CSSProperties }) {
  const copy = useDecisionCopy(state, proposal);
  const open = useOpenDecision();
  usePrefetchDecision(proposal.id);

  return (
    <Link
      href={`/app/decisions/${proposal.id}`}
      onClick={(e) => open(e, proposal.id, copy.pending ? PURPLE : CORAL)}
      className={`${styles.card} ${copy.pending ? styles.pending : ""} rise press spot`}
      style={style}
    >
      <span className={styles.text}>
        <span className={styles.eyebrow}>
          <span className={styles.pulse} aria-hidden="true" />
          {copy.eyebrow}
        </span>
        <span className={styles.headline}>{copy.headline}</span>
        <span className={styles.detail}>{copy.detail}</span>
      </span>
      <span className={styles.go} aria-hidden="true">
        <Icon name="arrowRight" size={20} stroke={2.25} />
      </span>
    </Link>
  );
}
