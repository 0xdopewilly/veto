"use client";

import Link from "next/link";
import type { Proposal } from "@veto/core/proposal";
import { metaOf, type VaultState } from "@/lib/vault";
import { imitated, reasonText } from "@/lib/decision";
import { formatAgo, formatShort, remaining, possessive } from "@/lib/format";
import { useNow } from "@/lib/useNow";
import { Icon } from "./Icon";
import styles from "./DecisionCard.module.css";

/** The coral "Needs your decision" card, or purple while an override counts down. */
export function DecisionCard({ state, proposal, style }: { state: VaultState; proposal: Proposal; style?: React.CSSProperties }) {
  const now = useNow(1000);
  const meta = metaOf(state, proposal.request.asset);
  const amount = formatShort(proposal.request.amount, meta);
  const look = imitated(state.payees, proposal);
  const pending = proposal.status === "OverridePending";

  let headline: string;
  let detail: string;
  if (pending && proposal.override_executes_at) {
    const left = remaining(proposal.override_executes_at, now);
    const span = left.hours ? `${left.hours} h ${left.minutes} min` : `${left.minutes} min ${left.seconds} s`;
    headline = left.done ? `${amount} override is due.` : `${amount} pays in ${span}.`;
    detail = left.done ? "Ready to pay · you can still cancel" : "Override pending · you can cancel";
  } else {
    headline = look
      ? `${amount} held. Sent to a lookalike of ${possessive(look.payee.name)} address.`
      : `${amount} held. ${proposal.verdict?.reasons[0] ? reasonText(proposal.verdict.reasons[0]) : "Stopped by the AI screen"}.`;
    detail = `Vetoed ${formatAgo(proposal.verdict?.recorded_at ?? proposal.created_at, now)} · ${proposal.request.chain.toUpperCase()}`;
  }

  return (
    <Link href={`/app/decisions/${proposal.id}`} className={`${styles.card} ${pending ? styles.pending : ""} rise press`} style={style}>
      <span className={styles.text}>
        <span className={styles.eyebrow}>{pending ? "Override pending" : "Needs your decision"}</span>
        <span className={styles.headline}>{headline}</span>
        <span className={styles.detail}>{detail}</span>
      </span>
      <span className={styles.go} aria-hidden="true">
        <Icon name="arrowRight" size={20} stroke={2.25} />
      </span>
    </Link>
  );
}
