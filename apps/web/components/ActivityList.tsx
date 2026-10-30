"use client";

import Link from "next/link";
import type { Payee, Proposal } from "@veto/core/proposal";
import { metaOf, type VaultState } from "@/lib/vault";
import { STATUS_TEXT, imitated, payeeLabel, reasonText, toneOf } from "@/lib/decision";
import { formatAgo, formatAmount, formatWhen } from "@/lib/format";
import { Icon } from "./Icon";
import styles from "./ActivityList.module.css";

const ICON = { pass: "check", veto: "x", pending: "clock", neutral: "clock" } as const;

function subtitle(p: Proposal, payees: Payee[]) {
  const look = imitated(payees, p);
  if (p.status === "Vetoed" && look) return `Lookalike of ${look.payee.name}`;
  if (p.status === "Vetoed" && p.verdict?.reasons[0]) return reasonText(p.verdict.reasons[0]);
  return p.request.memo ?? p.request.chain.toUpperCase();
}

export function ActivityList({ state, proposals, startDelay = 0 }: { state: VaultState; proposals: Proposal[]; startDelay?: number }) {
  if (proposals.length === 0) {
    return <p className={styles.empty}>No payments yet. When your agent proposes one, it appears here with Veto's decision.</p>;
  }
  return (
    <div className={styles.table} role="table" aria-label="Payment decisions">
      <div className={styles.head} role="row">
        <span role="columnheader">Decision</span>
        <span role="columnheader">Payee</span>
        <span role="columnheader">Chain</span>
        <span role="columnheader" className={styles.right}>Amount</span>
        <span role="columnheader">Agent</span>
        <span role="columnheader">When</span>
      </div>
      {proposals.map((p, i) => {
        const tone = toneOf(p.status);
        const meta = metaOf(state, p.request.asset);
        const vetoed = p.status === "Vetoed";
        return (
          <Link
            key={p.id}
            href={`/app/decisions/${p.id}`}
            role="row"
            className={`${styles.row} ${vetoed ? styles.vetoedRow : ""} rise press`}
            style={{ animationDelay: `${startDelay + i * 60}ms` }}
          >
            <span role="cell" className={styles.decision}>
              <span className={`${styles.icon} ${styles[tone]}`} aria-hidden="true">
                <Icon name={ICON[tone]} size={16} stroke={2.5} />
              </span>
              <span className={styles.statusWord}>{STATUS_TEXT[p.status]}</span>
            </span>
            <span role="cell" className={styles.payee}>
              <span className={`${styles.title} ${payeeLabel(state.payees, p).startsWith("0x") ? "mono" : ""}`}>
                {payeeLabel(state.payees, p)}
              </span>
              <span className={styles.sub}>
                <span className={styles.mobileOnly}>{STATUS_TEXT[p.status]} · </span>
                {subtitle(p, state.payees)}
                <span className={styles.mobileOnly}> · {formatAgo(p.created_at)}</span>
              </span>
            </span>
            <span role="cell" className={styles.chain}>{p.request.chain.toUpperCase()}</span>
            <span role="cell" className={`${styles.amount} tabular ${vetoed ? styles.struck : ""}`}>
              {formatAmount(p.request.amount, meta)}
            </span>
            <span role="cell" className={`${styles.agent} mono`}>{p.agent}</span>
            <span role="cell" className={styles.when}>{formatWhen(p.created_at)}</span>
          </Link>
        );
      })}
    </div>
  );
}
