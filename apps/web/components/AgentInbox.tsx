"use client";

import { AnimatePresence, motion } from "motion/react";
import type { Proposal } from "@veto/core/proposal";
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
import { Sheet } from "./Sheet";
import { VLoader } from "./VLoader";
import styles from "./AgentInbox.module.css";

/** The demo agent's inbox: emails it will pay if you let it. Veto screens each payment. */
export function AgentInbox({ titleId = "inbox-title", compact = false }: { titleId?: string; compact?: boolean }) {
  const demo = useDemo();

  return (
    <div className={`${styles.inbox} ${compact ? styles.compact : ""}`}>
      <header className={styles.head}>
        <span className={styles.headIcon} aria-hidden="true">
          <Icon name="mail" size={18} />
        </span>
        <div className={styles.headText}>
          <h2 id={titleId} className={styles.title}>Agent inbox</h2>
          <p className={styles.sub}>
            {demo.info && demo.payFrom === "outlayer" && demo.info.outlayer ? (
              <>
                The agent pays from its OutLayer wallet <span className="mono">{shortAddress(demo.info.outlayer.wallet)}</span>. The wallet holds each payment until Veto approves it.
              </>
            ) : demo.info ? (
              <>
                <span className="mono">{demo.info.agent.account}</span> pays what these emails ask. Veto screens each payment first.
              </>
            ) : (
              "Your agent pays what these emails ask. Veto screens each payment first."
            )}
          </p>
        </div>
      </header>

      {demo.info && (
        <div className={styles.meta}>
          <span className={styles.metaChip}>
            <span className={styles.metaDot} data-test={demo.info.guardian.test_signer || undefined} />
            {demo.info.guardian.test_signer ? "Screened by a local test signer" : `Screened by ${demo.info.guardian.model}`}
          </span>
          <span className={styles.metaChip}>Testnet</span>
        </div>
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

      {demo.status === "ready" && demo.info && (
        <ul className={styles.list}>
          {demo.info.scenarios.map((s, i) => (
            <ScenarioCard
              key={s.id}
              scenario={s}
              run={demo.runs[s.id]}
              index={i}
              compact={compact}
              busy={Object.values(demo.runs).some((r) => r.proposalId === undefined && !r.error)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function ScenarioCard({ scenario, run, index, busy, compact }: { scenario: DemoScenario; run?: DemoRun; index: number; busy: boolean; compact: boolean }) {
  const demo = useDemo();
  const calm = useCalm();
  const { state } = useVault();
  const symbol = state ? metaOf(state, state.primaryAsset).symbol : "USDC";
  const coin = scenario.symbol ?? symbol;
  const amount = /^[\d.,]+$/.test(scenario.amount) ? (coin.toUpperCase().includes("USD") ? `$${scenario.amount}` : `${scenario.amount} ${coin}`) : scenario.amount;
  const proposal = run?.proposalId ? state?.proposals.find((p) => p.id === run.proposalId) : undefined;
  const sending = !!run && !run.proposalId && !run.error;
  const initial = scenario.from.trim()[0]?.toUpperCase() ?? "?";

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
        <span className={styles.mailFrom}>
          <span className={styles.from}>{scenario.from}</span>
          <span className={styles.payee}>to {shortAddress(scenario.payee)}</span>
        </span>
        <span className={styles.amount}>{amount}</span>
      </div>
      <p className={styles.subject}>{scenario.subject}</p>
      <p className={styles.preview}>{scenario.preview}</p>

      <AnimatePresence mode="popLayout" initial={false}>
        {!run || run.error ? (
          <motion.div key="cta" className={styles.cta} exit={{ opacity: 0, scale: 0.96 }} transition={{ duration: 0.18 }}>
            <Pill size={compact ? "sm" : "md"} full={!compact} icon="send" disabled={busy} onClick={() => demo.run(scenario.id)}>
              Let the agent pay this
            </Pill>
            {run?.error && <p className={styles.error} role="alert">{run.error}</p>}
          </motion.div>
        ) : (
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
                run.via === "outlayer"
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

/** The inbox as a bottom sheet on phones. */
export function InboxSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onClose={onClose} labelledBy="inbox-sheet-title" wide>
      <AgentInbox titleId="inbox-sheet-title" />
    </Sheet>
  );
}
