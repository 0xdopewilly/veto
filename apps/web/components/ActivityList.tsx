"use client";

import Link from "next/link";
import { memo, useEffect, useRef, type MouseEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { Payee, Proposal, Status } from "@veto/core/proposal";
import { metaOf, type VaultState } from "@/lib/vault";
import type { AssetMeta } from "@/lib/format";
import { STATUS_TEXT, imitated, outcomeOf, payeeLabel, reasonText, toneOf, type Tone, type Totals } from "@/lib/decision";
import { formatAmount, formatWhen, chainLabel } from "@/lib/format";
import { SPRING_BOUNCE, SPRING_SURFACE, useCalm, useEntrance } from "@/lib/motion";
import { CORAL, useOpenDecision } from "./DecisionCard";
import { Icon } from "./Icon";
import { VLoader } from "./VLoader";
import styles from "./ActivityList.module.css";

export type Filter = "all" | "vetoed" | "paid" | "pending";

/** Vetoed means the AI screen said no and nothing was paid, kept blocked or not (see outcomeOf). */
export function filterProposals(proposals: Proposal[], f: Filter): Proposal[] {
  if (f === "all") return proposals;
  return proposals.filter((p) => outcomeOf(p.status) === f);
}

/** The tab options with counts, for <Segmented />. Pass the vault's all-time totals when the list is only the newest payments. */
export function filterOptions(proposals: Proposal[], totals?: Totals): { value: Filter; label: string; count?: number }[] {
  const n = (f: Exclude<Filter, "all">) => totals?.[f].n ?? filterProposals(proposals, f).length;
  return [
    { value: "all", label: "All" },
    { value: "vetoed", label: "Vetoed", count: n("vetoed") },
    { value: "paid", label: "Paid", count: n("paid") },
    { value: "pending", label: "Pending", count: n("pending") },
  ];
}

/** The line under the payee: why it was vetoed, else the invoice or payslip reference. */
function subtitle(p: Proposal, payees: Payee[]) {
  const vetoed = outcomeOf(p.status) === "vetoed";
  const look = imitated(payees, p);
  if (vetoed && look) return `Lookalike of ${look.payee.name}`;
  if (vetoed && p.verdict?.reasons[0]) return reasonText(p.verdict.reasons[0]);
  return p.request.memo || chainLabel(p.request.chain);
}

const GLYPH = { pass: "check", veto: "x", pending: "clock", neutral: "clock" } as const;

/** Kept-blocked payments read as vetoed: the screen said no and nothing was paid. */
const toneFor = (status: Status): Tone => (status === "Cancelled" ? "veto" : toneOf(status));

const isWorking = (status: Status) => status === "Screening" || status === "Executing";

/** The round status mark (phones and narrow tables). While Veto screens it shows the V loader, then morphs into ✓ or ✕. */
function StatusIcon({ status, tone }: { status: Status; tone: Tone }) {
  const calm = useCalm();
  const working = isWorking(status);
  return (
    <span className={`${styles.icon} ${styles[tone]}`} aria-hidden="true">
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.span
          key={working ? "loader" : tone}
          className={styles.glyph}
          initial={calm ? { opacity: 0 } : { opacity: 0, scale: 0.4, rotate: -45 }}
          animate={{ opacity: 1, scale: 1, rotate: 0 }}
          exit={calm ? { opacity: 0 } : { opacity: 0, scale: 0.4, rotate: 45, transition: { duration: 0.16 } }}
          transition={SPRING_BOUNCE}
        >
          {working ? <VLoader size={20} /> : <Icon name={GLYPH[tone]} size={16} stroke={2.5} />}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/** The status pill (wide tables). */
function StatusPill({ status, tone }: { status: Status; tone: Tone }) {
  return (
    <span className={`${styles.pill} ${styles[`pill_${tone}`]}`}>
      {isWorking(status) && <VLoader size={14} />}
      {STATUS_TEXT[status]}
    </span>
  );
}

/**
 * Payments as rows on phones and a table on desktop. Rows spring into place when the filter
 * changes; a payment that arrives while you watch slides in from the top with a sweep of light;
 * a status change morphs the mark.
 */
export function ActivityList({
  state,
  proposals,
  startDelay = 0,
  empty = "No payments yet. When your agent asks to pay, it appears here with Veto's decision.",
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
    <div className={styles.table} role="table" aria-label="Payments">
      <div className={styles.head} role="row">
        <span role="columnheader">Status</span>
        <span role="columnheader">Payee</span>
        <span role="columnheader" className={styles.chain}>Chain</span>
        <span role="columnheader" className={styles.right}>Amount</span>
        <span role="columnheader" className={styles.when}>When</span>
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
  meta,
  fresh,
  index,
  first,
  delay,
  open,
}: {
  p: Proposal;
  payees: Payee[];
  meta: AssetMeta;
  fresh: boolean;
  index: number;
  first: boolean;
  delay: number;
  open: (e: MouseEvent<HTMLElement>, id: string, color: string) => void;
}) {
  const calm = useCalm();
  const entrance = useEntrance();
  const tone = toneFor(p.status);
  const openVeto = p.status === "Vetoed";
  const nothingPaid = outcomeOf(p.status) === "vetoed";
  const label = payeeLabel(payees, p);
  const when = formatWhen(p.created_at);
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
      <Link href={`/app/decisions/${p.id}`} onClick={openVeto ? (e) => open(e, p.id, CORAL) : undefined} className={`${styles.row} press`}>
        {fresh && !calm && <span className={styles.sweep} aria-hidden="true" />}
        <span role="cell" className={styles.status}>
          <span className={styles.iconSlot}>
            <StatusIcon status={p.status} tone={tone} />
          </span>
          <span className={styles.pillSlot}>
            <StatusPill status={p.status} tone={tone} />
          </span>
        </span>
        <span role="cell" className={styles.payee}>
          <span className={`${styles.title} ${label.startsWith("0x") ? "mono" : ""}`}>{label}</span>
          <span className={styles.sub}>
            <span className={styles.subWhen}>{when} · </span>
            {subtitle(p, payees)}
          </span>
        </span>
        <span role="cell" className={styles.chain}>{chainLabel(p.request.chain)}</span>
        <span role="cell" className={styles.amountCell}>
          <span className={`${styles.amount} ${nothingPaid ? styles.struck : ""}`}>{formatAmount(p.request.amount, meta)}</span>
          <span className={`${styles.word} ${styles[`word_${tone}`]}`}>{STATUS_TEXT[p.status]}</span>
        </span>
        <span role="cell" className={styles.when}>{when}</span>
      </Link>
    </motion.div>
  );
});
