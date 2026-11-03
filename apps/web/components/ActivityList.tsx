"use client";

import Link from "next/link";
import { memo, useEffect, useRef, type MouseEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { Payee, Proposal, Status } from "@veto/core/proposal";
import { metaOf, type VaultState } from "@/lib/vault";
import type { AssetMeta } from "@/lib/format";
import { STATUS_TEXT, imitated, payeeLabel, reasonText, riskOf, toneOf, type Tone } from "@/lib/decision";
import { formatAgo, formatAmount, formatWhen, chainLabel } from "@/lib/format";
import { SPRING_BOUNCE, SPRING_SURFACE, useCalm, useEntrance } from "@/lib/motion";
import { CORAL, useOpenDecision } from "./DecisionCard";
import { Icon } from "./Icon";
import { SignalBar } from "./SignalBar";
import { VLoader } from "./VLoader";
import styles from "./ActivityList.module.css";

export type Filter = "all" | "vetoed" | "paid" | "pending";

const PENDING: Status[] = ["Screening", "Executing", "OverridePending"];

export function filterProposals(proposals: Proposal[], f: Filter): Proposal[] {
  if (f === "vetoed") return proposals.filter((p) => p.status === "Vetoed");
  if (f === "paid") return proposals.filter((p) => p.status === "Paid");
  if (f === "pending") return proposals.filter((p) => PENDING.includes(p.status));
  return proposals;
}

/** The tab options with counts, for <Segmented />. */
export function filterOptions(proposals: Proposal[]): { value: Filter; label: string; count?: number }[] {
  return [
    { value: "all", label: "All" },
    { value: "vetoed", label: "Vetoed", count: filterProposals(proposals, "vetoed").length },
    { value: "paid", label: "Paid" },
    { value: "pending", label: "Pending", count: filterProposals(proposals, "pending").length },
  ];
}

function subtitle(p: Proposal, payees: Payee[]) {
  const look = imitated(payees, p);
  if (p.status === "Vetoed" && look) return `Lookalike of ${look.payee.name}`;
  if (p.status === "Vetoed" && p.verdict?.reasons[0]) return reasonText(p.verdict.reasons[0]);
  return p.request.memo ?? chainLabel(p.request.chain);
}

const GLYPH = { pass: "check", veto: "x", pending: "clock", neutral: "clock" } as const;

/** The round status mark. While Veto screens it shows the V loader, then morphs into ✓ or ✕. */
function StatusIcon({ status, tone }: { status: Status; tone: Tone }) {
  const calm = useCalm();
  const screening = status === "Screening" || status === "Executing";
  const key = screening ? "loader" : tone;
  return (
    <span className={`${styles.icon} ${styles[tone]}`} aria-hidden="true">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={key}
          className={styles.glyph}
          initial={calm ? { opacity: 0 } : { opacity: 0, scale: 0.4, rotate: -45 }}
          animate={{ opacity: 1, scale: 1, rotate: 0 }}
          exit={calm ? { opacity: 0 } : { opacity: 0, scale: 0.4, rotate: 45, transition: { duration: 0.16 } }}
          transition={SPRING_BOUNCE}
        >
          {screening ? <VLoader size={20} /> : <Icon name={GLYPH[tone]} size={16} stroke={2.5} />}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

function StatusPill({ status, tone }: { status: Status; tone: Tone }) {
  return <span className={`${styles.pill} ${styles[`pill_${tone}`]}`}>{STATUS_TEXT[status]}</span>;
}

/**
 * Payment decisions as rows on phones and a table on desktop. Rows spring into place when the
 * filter changes; a payment that arrives while you watch slides in from the top with a sweep
 * of light; a status change morphs the icon.
 */
export function ActivityList({
  state,
  proposals,
  startDelay = 0,
  empty = "No payments yet. When your agent proposes one, it appears here with Veto's decision.",
}: {
  state: VaultState;
  proposals: Proposal[];
  startDelay?: number;
  empty?: string;
}) {
  const open = useOpenDecision();
  // Everything in the vault when the list first rendered counts as already seen.
  const seen = useRef<Set<string> | null>(null);
  if (seen.current === null) seen.current = new Set(state.proposals.map((p) => p.id));
  const fresh = new Set(state.proposals.filter((p) => !seen.current!.has(p.id)).map((p) => p.id));
  useEffect(() => {
    state.proposals.forEach((p) => seen.current!.add(p.id));
  }, [state.proposals]);
  const firstPaint = useRef(true);
  useEffect(() => {
    firstPaint.current = false;
  }, []);

  return (
    <div className={styles.table} role="table" aria-label="Payment decisions">
      <div className={styles.head} role="row">
        <span role="columnheader">Decision</span>
        <span role="columnheader">Payee</span>
        <span role="columnheader" className={styles.chain}>Chain</span>
        <span role="columnheader">Risk signals</span>
        <span role="columnheader" className={styles.right}>Amount</span>
        <span role="columnheader">When</span>
      </div>
      <AnimatePresence initial={false} mode="popLayout">
        {proposals.length === 0 && (
          <motion.p key="empty" className={styles.empty} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            {empty}
          </motion.p>
        )}
        {proposals.map((p, i) => (
          <Row
            key={p.id}
            p={p}
            payees={state.payees}
            history={state.proposals}
            meta={metaOf(state, p.request.asset)}
            fresh={fresh.has(p.id)}
            index={i}
            first={firstPaint.current}
            delay={(startDelay + i * 55) / 1000}
            open={open}
          />
        ))}
      </AnimatePresence>
    </div>
  );
}

/**
 * One payment. Memoised: with the vault keeping unchanged payments as the same objects, a row
 * re-renders only when its own payment changes, not on every poll or navigation.
 */
const Row = memo(function Row({
  p,
  payees,
  history,
  meta,
  fresh,
  index,
  first,
  delay,
  open,
}: {
  p: Proposal;
  payees: Payee[];
  history: Proposal[];
  meta: AssetMeta;
  fresh: boolean;
  index: number;
  first: boolean;
  delay: number;
  open: (e: MouseEvent<HTMLElement>, id: string, color: string) => void;
}) {
  const calm = useCalm();
  const entrance = useEntrance();
  const tone = toneOf(p.status);
  const vetoed = p.status === "Vetoed";
  const risk = riskOf(p, payees, history);
  const label = payeeLabel(payees, p);
  const enter = first ? { opacity: 0, y: 16 } : fresh ? { opacity: 0, y: -28, scale: 0.98 } : { opacity: 0, scale: 0.97 };
  return (
    <motion.div
      layout={calm ? false : "position"}
      layoutDependency={index}
      role="row"
      className={styles.rowWrap}
      initial={calm ? { opacity: 0 } : first && !entrance ? false : enter}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={calm ? { opacity: 0 } : { opacity: 0, scale: 0.97, transition: { duration: 0.16 } }}
      transition={{ ...SPRING_SURFACE, delay: first ? delay : 0 }}
    >
      <Link
        href={`/app/decisions/${p.id}`}
        onClick={vetoed ? (e) => open(e, p.id, CORAL) : undefined}
        className={`${styles.row} ${vetoed ? styles.vetoedRow : ""} press`}
      >
        {fresh && !calm && <span className={styles.sweep} aria-hidden="true" />}
        <span role="cell" className={styles.decision}>
          <StatusIcon status={p.status} tone={tone} />
          <span className={styles.desktopOnly}>
            <StatusPill status={p.status} tone={tone} />
          </span>
        </span>
        <span role="cell" className={styles.payee}>
          <span className={`${styles.title} ${label.startsWith("0x") ? "mono" : ""}`}>{label}</span>
          <span className={styles.sub}>
            {subtitle(p, payees)}
            <span className={styles.mobileOnly}> · {formatAgo(p.created_at)}</span>
          </span>
        </span>
        <span role="cell" className={styles.chain}>{chainLabel(p.request.chain)}</span>
        <span role="cell" className={styles.signals}>
          <SignalBar
            filled={risk.filled}
            tone={p.verdict && !p.verdict.pass ? "coral" : tone === "pending" ? "purple" : "green"}
            label={`${risk.signals} risk signal${risk.signals === 1 ? "" : "s"}`}
            delay={first ? delay + 0.2 : 0}
          />
        </span>
        <span role="cell" className={styles.amountCell}>
          <span className={`${styles.amount} ${vetoed ? styles.struck : ""}`}>{formatAmount(p.request.amount, meta)}</span>
          <span className={styles.pillUnder}>
            <StatusPill status={p.status} tone={tone} />
          </span>
        </span>
        <span role="cell" className={styles.when}>{formatWhen(p.created_at)}</span>
      </Link>
    </motion.div>
  );
});
