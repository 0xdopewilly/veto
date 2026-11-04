"use client";

import { AnimatePresence, motion } from "motion/react";
import type { Proposal } from "@veto/core/proposal";
import { useState } from "react";
import { useDemo, type DemoRun, type DemoScenario } from "@/lib/demoClient";
import { metaOf, useVault } from "@/lib/vault";
import { reasonText } from "@/lib/decision";
import { EXPLORER } from "@/lib/config";
import { SPRING_BOUNCE, SPRING_UI, useCalm } from "@/lib/motion";
import { shortAddress } from "@/lib/format";
import { CORAL, useOpenDecision } from "./DecisionCard";
import { Icon } from "./Icon";
import { Pill } from "./Pill";
import { Segmented } from "./Segmented";
import { Sheet, SheetHeader } from "./Sheet";
import { VLoader } from "./VLoader";
import styles from "./AgentInbox.module.css";

/** "Qwen/Qwen3-VL-30B-A3B-Instruct" → "Qwen3-VL-30B". */
const shortModel = (model: string) => (model.split("/").pop() ?? model).replace(/-Instruct$/i, "").replace(/-A\d+B$/i, "");

/** Who pays these emails, in a line. */
function InboxSub() {
  const demo = useDemo();
  if (demo.info && demo.payFrom === "outlayer" && demo.info.outlayer) {
    return (
      <>
        The agent pays from its OutLayer wallet <span className="mono">{shortAddress(demo.info.outlayer.wallet)}</span>, which holds each payment until Veto approves it.
      </>
    );
  }
  return (
    <>
      Emails your agent{demo.info && <> (<span className="mono">{shortAddress(demo.info.agent.account)}</span>)</>} will pay. Veto screens each payment first.
    </>
  );
}

function InboxMeta() {
  const demo = useDemo();
  if (!demo.info) return null;
  const { guardian } = demo.info;
  return (
    <div className={styles.meta}>
      <span className={styles.metaChip} title={guardian.test_signer ? undefined : guardian.model}>
        <span className={styles.metaDot} data-test={guardian.test_signer || undefined} />
        {guardian.test_signer ? "Screened by a local test signer" : `Screened by ${shortModel(guardian.model)} in an enclave`}
      </span>
      <span className={styles.metaChip}>Testnet</span>
    </div>
  );
}

/** The demo agent's inbox: emails it will pay if you let it. Veto screens each payment. */
export function AgentInbox({ titleId = "inbox-title", compact = false, head = true }: { titleId?: string; compact?: boolean; head?: boolean }) {
  const demo = useDemo();

  return (
    <div className={`${styles.inbox} ${compact ? styles.compact : ""} ${head ? "" : styles.headless}`}>
      {head && (
        <header className={styles.head}>
          <h2 id={titleId} className={styles.title}>Agent inbox</h2>
          <p className={styles.sub}>
            <InboxSub />
          </p>
          <InboxMeta />
        </header>
      )}

      {demo.info?.outlayer && (
        <div className={styles.payFrom}>
          <span className={styles.payFromLabel}>Pay from</span>
          <Segmented
            label="Pay from"
            value={demo.payFrom}
            onChange={demo.setPayFrom}
            options={[
              { value: "vault", label: "Veto vault" },
              { value: "outlayer", label: "OutLayer wallet" },
            ]}
          />
        </div>
      )}

      {demo.status === "loading" && (
        <div className={styles.state}>
          <VLoader size={36} />
          <span>Opening the inbox</span>
        </div>
      )}

      {demo.status === "unavailable" && (
        <div className={styles.state}>
          <span className={styles.stateIcon}>
            <Icon name="bot" size={20} />
          </span>
          <span>The demo agent isn't running right now. The vault, decisions and proofs below are all live on testnet.</span>
        </div>
      )}

      {demo.status === "ready" && demo.info && <Composer vault={demo.info.vault} compact={compact} />}

      {demo.status === "ready" && demo.info && (
        <ul className={styles.list}>
          {[...demo.composed, ...demo.info.scenarios].map((s, i) => (
            <ScenarioCard
              key={s.id}
              scenario={s}
              run={demo.runs[s.id]}
              index={i}
              busy={Object.values(demo.runs).some((r) => r.proposalId === undefined && !r.error)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function ScenarioCard({ scenario, run, index, busy }: { scenario: DemoScenario; run?: DemoRun; index: number; busy: boolean }) {
  const demo = useDemo();
  const calm = useCalm();
  const { state } = useVault();
  const symbol = state ? metaOf(state, state.primaryAsset).symbol : "USDC";
  const coin = scenario.symbol ?? symbol;
  const amount = /^[\d.,]+$/.test(scenario.amount) ? (coin.toUpperCase().includes("USD") ? `$${scenario.amount}` : `${scenario.amount} ${coin}`) : scenario.amount;
  const proposal = run?.proposalId ? state?.proposals.find((p) => p.id === run.proposalId) : undefined;
  const sending = !!run && !run.proposalId && !run.error;
  const initial = scenario.from.trim()[0]?.toUpperCase() ?? "?";
  const own = scenario.id.startsWith("mail-");

  return (
    <motion.li
      className={styles.card}
      initial={calm ? false : { opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...SPRING_UI, delay: 0.08 + index * 0.06 }}
      layout
      // Measure only when this card's own content can change size, not on every render.
      layoutDependency={`${run?.proposalId ?? (run ? "sending" : "idle")}:${run?.error ?? ""}:${proposal?.status ?? ""}`}
    >
      <div className={styles.mailTop}>
        <span className={styles.avatar} aria-hidden="true">{initial}</span>
        <span className={styles.from}>{scenario.from}</span>
        <span className={styles.amount}>{amount}</span>
      </div>
      <p className={styles.subject}>{scenario.subject}</p>
      <p className={styles.preview}>{scenario.preview}</p>

      <div className={styles.foot}>
        <span className={styles.payee}>
          Pays <span className="mono">{shortAddress(scenario.payee)}</span>
        </span>
        <AnimatePresence initial={false}>
          {(!run || (run.error && !own)) && (
            <motion.span key="cta" className={styles.cta} exit={{ opacity: 0, scale: 0.94 }} transition={{ duration: 0.16 }}>
              <Pill size="sm" variant="soft" icon="send" disabled={busy} onClick={() => demo.run(scenario.id)}>
                Let the agent pay
              </Pill>
            </motion.span>
          )}
        </AnimatePresence>
      </div>
      {run?.error && (
        <motion.p className={styles.error} role="alert" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          {run.error}
        </motion.p>
      )}

      <AnimatePresence initial={false}>
        {run && !run.error && (
          <motion.ol
            key="stages"
            className={styles.stages}
            initial={calm ? { opacity: 0 } : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={SPRING_UI}
            aria-live="polite"
          >
            <Stage
              done={!sending}
              active={sending}
              label={
                own && sending
                  ? "The agent is reading your email"
                  : run.via === "outlayer"
                  ? sending
                    ? "Agent is asking its OutLayer wallet to pay"
                    : "OutLayer is holding it for Veto"
                  : sending
                    ? "Agent is proposing the payment"
                    : "Agent proposed the payment"
              }
            >
              {run.tx && (
                <a className={styles.tx} href={`${EXPLORER}/txns/${run.tx}`} target="_blank" rel="noreferrer">
                  tx <Icon name="external" size={11} stroke={2.25} />
                </a>
              )}
            </Stage>
            {!sending && <Stage done={!!proposal && proposal.status !== "Screening"} active={!proposal || proposal.status === "Screening"} label="Screening privately" />}
            {proposal && proposal.status !== "Screening" && <Verdict proposal={proposal} />}
          </motion.ol>
        )}
      </AnimatePresence>
    </motion.li>
  );
}

function Stage({ done, active, label, children }: { done: boolean; active: boolean; label: string; children?: React.ReactNode }) {
  return (
    <motion.li className={styles.stage} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={SPRING_UI}>
      <span className={`${styles.stageDot} ${done ? styles.stageDone : ""}`}>
        {active ? <VLoader size={18} /> : done ? <Icon name="check" size={12} stroke={3} /> : null}
      </span>
      <span className={styles.stageLabel}>{label}</span>
      {children}
    </motion.li>
  );
}

function Verdict({ proposal }: { proposal: Proposal }) {
  const open = useOpenDecision();
  const vetoed = proposal.status === "Vetoed" || proposal.status === "OverridePending";
  const paid = proposal.status === "Paid" || proposal.status === "Executing";
  const reason = proposal.verdict?.reasons[0];
  const label = vetoed ? "Vetoed" : paid ? (proposal.status === "Executing" ? "Passed, sending" : "Paid") : proposal.status;
  const href = `/app/decisions/${proposal.id}`;

  return (
    <motion.li className={styles.verdict} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={SPRING_BOUNCE}>
      <span className={`${styles.verdictPill} ${vetoed ? styles.pillVeto : paid ? styles.pillPass : styles.pillIdle}`}>
        <Icon name={vetoed ? "x" : paid ? "check" : "clock"} size={13} stroke={3} />
        {label}
      </span>
      <span className={styles.verdictText}>
        {vetoed && reason ? reasonText(reason) : paid ? (proposal.external ? "Both checks passed. Veto approved it on OutLayer." : "Both checks passed.") : ""}
      </span>
      <a
        href={href}
        className={styles.open}
        onClick={(e) => open(e, proposal.id, vetoed ? CORAL : "#00ec97")}
      >
        Open the decision <Icon name="arrowRight" size={14} stroke={2.25} />
      </a>
    </motion.li>
  );
}

/** The inbox as a sheet: its title and who pays stay put while the emails scroll. */
export function InboxSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      labelledBy="inbox-sheet-title"
      wide
      header={
        <SheetHeader id="inbox-sheet-title" title="Agent inbox" sub={<InboxSub />} onClose={onClose}>
          <InboxMeta />
        </SheetHeader>
      }
    >
      <AgentInbox head={false} />
    </Sheet>
  );
}

/** Write the agent an email: a real model reads it and proposes whatever it asks for. */
function Composer({ vault, compact }: { vault: string; compact: boolean }) {
  const demo = useDemo();
  const root = vault.split(".").slice(1).join(".");
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState("accounts@kanocottonmills.ng");
  const [subject, setSubject] = useState("Invoice INV-3001: 40 bales of combed cotton");
  const [body, setBody] = useState(
    `Good morning. Please pay invoice INV-3001 for 40 bales of combed cotton. Amount due: $120.00 USDC to our usual account kano-cotton.${root}. Thank you.`,
  );
  const busy = Object.values(demo.runs).some((r) => r.proposalId === undefined && !r.error);

  if (!open) {
    return (
      <button type="button" className={`${styles.composeToggle} press`} onClick={() => setOpen(true)}>
        <span className={styles.composeIcon} aria-hidden="true">
          <Icon name="plus" size={16} stroke={2.5} />
        </span>
        <span className={styles.composeText}>
          <strong>Write your own email</strong>
          <span>A real AI agent reads it and pays what it asks. Try to sneak a scam past Veto.</span>
        </span>
        <Icon name="arrowRight" size={16} className={styles.composeChevron} />
      </button>
    );
  }
  return (
    <form
      className={`${styles.compose} ${compact ? styles.composeCompact : ""}`}
      onSubmit={(e) => {
        e.preventDefault();
        setOpen(false);
        void demo.compose({ from, subject, body });
      }}
    >
      <label className={styles.composeField}>
        <span>From</span>
        <input value={from} onChange={(e) => setFrom(e.target.value)} maxLength={120} />
      </label>
      <label className={styles.composeField}>
        <span>Subject</span>
        <input value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} />
      </label>
      <label className={styles.composeField}>
        <span>Email</span>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={compact ? 5 : 4} maxLength={4000} />
      </label>
      <p className={styles.composeHint}>
        USDC goes to a NEAR account (like <span className="mono">kano-cotton.{root}</span>); ETH goes to a 0x address on Base Sepolia.
      </p>
      <div className={styles.composeActions}>
        <Pill type="submit" size="sm" icon="send" disabled={busy || body.trim().length < 10}>
          Send to the agent
        </Pill>
        <Pill type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
          Cancel
        </Pill>
      </div>
    </form>
  );
}
