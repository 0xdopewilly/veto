"use client";

import { AnimatePresence, motion } from "motion/react";
import type { Proposal } from "@veto/core/proposal";
import { useEffect, useRef, useState } from "react";
import { useDemo, type AgentApiOutcome, type DemoRun, type DemoScenario, type PayFrom } from "@/lib/demoClient";
import { metaOf, useVault } from "@/lib/vault";
import { reasonText } from "@/lib/decision";
import { EXPLORER } from "@/lib/config";
import { SPRING_BOUNCE, SPRING_UI, useCalm } from "@/lib/motion";
import { scaleDollars, shortAddress } from "@/lib/format";
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
  if (demo.info?.agentapi && demo.payFrom === "agentapi") {
    return (
      <>
        The agent asks its NEAR Intents Agent API wallet on mainnet to pay. The agent holds no grant; Veto holds the only one and sends just what passes. Amounts are scaled 1:{demo.info.agentapi.scale}, so each payment is a few cents of real USDC.
      </>
    );
  }
  if (demo.info && demo.payFrom === "outlayer" && demo.info.outlayer) {
    return (
      <>
        The agent pays from its OutLayer wallet <span className="mono">{shortAddress(demo.info.outlayer.wallet)}</span>, which holds each payment until Veto approves it.
      </>
    );
  }
  return (
    <>
      Emails your agent will pay. Veto screens each payment first.
    </>
  );
}

function InboxMeta() {
  const demo = useDemo();
  if (!demo.info) return null;
  const { guardian } = demo.info;
  return (
    <div className={styles.meta}>
      <span className={styles.metaChip} title={demo.info.nearai === "down" ? "NEAR AI Cloud isn't serving this model right now" : guardian.test_signer ? undefined : guardian.model}>
        <span className={styles.metaDot} data-test={guardian.test_signer || undefined} data-down={demo.info.nearai === "down" || undefined} />
        {guardian.test_signer ? "Screened by a local test signer" : `Screened by ${shortModel(guardian.model)} in an enclave`}
      </span>
      <span className={styles.metaChip}>{demo.payFrom === "agentapi" ? "Mainnet" : "Testnet"}</span>
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

      {(demo.info?.outlayer || demo.info?.agentapi) && (
        <div className={styles.payFrom}>
          <span className={styles.payFromLabel}>Pay from</span>
          <Segmented
            label="Pay from"
            value={demo.payFrom}
            onChange={demo.setPayFrom}
            options={[
              { value: "vault" as PayFrom, label: "Vault" },
              ...(demo.info.outlayer ? [{ value: "outlayer" as PayFrom, label: "OutLayer" }] : []),
              ...(demo.info.agentapi ? [{ value: "agentapi" as PayFrom, label: "Agent API" }] : []),
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

      {(demo.status === "unavailable" || demo.status === "off") && (
        <div className={styles.state}>
          <span className={styles.stateIcon}>
            <Icon name="bot" size={20} />
          </span>
          <span>
            {demo.status === "off" ? (
              <>
                This copy of Veto has no demo agent set up yet (<span className="mono">pnpm demo:setup</span> makes one). The vault, decisions and proofs are
                still read live from testnet, and the hosted demo at <a href="https://veto-beta.vercel.app/app">veto-beta.vercel.app</a> runs the agent.
              </>
            ) : (
              "The demo agent isn't running right now. The vault, decisions and proofs below are all live on testnet."
            )}
          </span>
        </div>
      )}

      {demo.status === "ready" && demo.info?.nearai === "down" && (
        <motion.div className={styles.state} role="status" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={SPRING_UI}>
          <span className={styles.stateIcon}>
            <Icon name="shield" size={20} />
          </span>
          <span>
            NEAR AI Cloud isn&apos;t serving Veto&apos;s enclave model right now. Veto only pays on a verdict signed inside that enclave, so until it&apos;s back, payments started here
            expire unpaid. No signed PASS, no payment.
          </span>
        </motion.div>
      )}

      {demo.status === "ready" && demo.info && <Composer vault={demo.info.vault} compact={compact} />}

      {demo.status === "ready" && demo.info && (
        <ul className={styles.list}>
          {[...demo.composed, ...demo.info.scenarios.filter((s) => demo.payFrom !== "agentapi" || !s.symbol || s.agentapi)].map((s, i) => (
            <ScenarioCard
              key={s.id}
              scenario={s}
              run={demo.runs[s.id]}
              index={i}
              busy={Object.values(demo.runs).some(inFlight)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

/** An email's amount, by the app's one rule: "$180.00", "$0.09", "0.0001 ETH". */
function inboxAmount(value: string, coin: string) {
  const n = Number(value.replace(/,/g, ""));
  if (!coin.toUpperCase().includes("USD")) return `${value} ${coin}`;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: n < 1 ? 4 : 2 })}`;
}

/** Invoice and payslip references ("INV-7742", "PAY-2026-11-TB") never break at their hyphens. */
function keepRefs(text: string) {
  return text.split(/(\b[A-Z]{2,}(?:-[A-Z0-9]+)+\b)/).map((part, i) => (i % 2 ? <span key={i} className={styles.ref}>{part}</span> : part));
}

/** A run still waiting on its answer: no vault proposal, no Agent API outcome and no error yet. */
const inFlight = (r: DemoRun) => r.proposalId === undefined && !r.agentapi && !r.error;

function ScenarioCard({ scenario: email, run, index, busy }: { scenario: DemoScenario; run?: DemoRun; index: number; busy: boolean }) {
  const demo = useDemo();
  // On the Agent API path a payroll email is a USDC salary paid out on Base through NEAR Intents.
  const variant = demo.payFrom === "agentapi" ? email.agentapi : undefined;
  const scenario: DemoScenario = variant ? { ...email, ...variant, symbol: undefined } : email;
  const calm = useCalm();
  const { state } = useVault();
  const symbol = state ? metaOf(state, state.primaryAsset).symbol : "USDC";
  const coin = scenario.symbol ?? symbol;
  const own = scenario.id.startsWith("mail-");
  const scale = demo.payFrom === "agentapi" && !own && coin.toUpperCase().includes("USD") ? (demo.info?.agentapi?.scale ?? 1) : 1;
  const shown = scale > 1 && /^[\d.,]+$/.test(scenario.amount) ? scaleDollars(scenario.amount, scale) : scenario.amount;
  const amount = /^[\d.,]+$/.test(shown) ? inboxAmount(shown, coin) : shown;
  const proposal = run?.proposalId ? state?.proposals.find((p) => p.id === run.proposalId) : undefined;
  const sending = !!run && !run.proposalId && !run.agentapi && !run.error;
  const initial = scenario.from.trim()[0]?.toUpperCase() ?? "?";
  const stage = `${run?.proposalId ?? (run ? "sending" : "idle")}:${run?.error ?? ""}:${proposal?.status ?? ""}`;

  // The card grows as each stage lands, often past the bottom of the list, so it keeps itself in view
  // until the verdict. Only the copy that was clicked: the desktop home shows the inbox twice.
  const card = useRef<HTMLLIElement>(null);
  const clicked = useRef(false);
  useEffect(() => {
    if (!clicked.current || stage.startsWith("idle")) return;
    const settle = setTimeout(() => card.current?.scrollIntoView({ block: "nearest", behavior: calm ? "auto" : "smooth" }), 320);
    return () => clearTimeout(settle);
  }, [stage, calm]);

  return (
    <motion.li
      ref={card}
      className={styles.card}
      initial={calm ? false : { opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...SPRING_UI, delay: 0.08 + index * 0.06 }}
      layout
      // Measure only when this card's own content can change size, not on every render.
      layoutDependency={stage}
    >
      <div className={styles.mailTop}>
        <span className={styles.avatar} aria-hidden="true">{initial}</span>
        <span className={styles.from}>{scenario.from}</span>
        <span className={styles.amount}>{amount}</span>
      </div>
      <p className={styles.subject}>{keepRefs(scenario.subject)}</p>
      <p className={styles.preview}>{scenario.preview}</p>

      <div className={styles.foot}>
        <span className={styles.payee}>
          Pays{" "}
          {demo.payFrom === "agentapi" && !own ? (
            agentApiPayee(scenario.payee, run?.agentapi, variant?.payee_label)
          ) : (
            <span className="mono">{shortAddress(scenario.payee)}</span>
          )}
        </span>
        <AnimatePresence initial={false}>
          {(!run || (run.error && !own)) && (
            <motion.span key="cta" className={styles.cta} exit={{ opacity: 0, scale: 0.94 }} transition={{ duration: 0.16 }}>
              <Pill
                size="sm"
                variant="soft"
                icon="send"
                disabled={busy}
                onClick={() => {
                  clicked.current = true;
                  demo.run(scenario.id);
                }}
              >
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
                  : run.via === "agentapi"
                  ? sending
                    ? "Agent is asking its Agent API wallet to pay"
                    : "Agent asked its Agent API wallet. It holds no grant, so it can't pay"
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
            {run.agentapi ? (
              <>
                <Stage done active={false} label={`Screened privately in the enclave, ${(run.agentapi.verdict.ms / 1000).toFixed(1)} s`} />
                <AgentApiVerdict outcome={run.agentapi} />
              </>
            ) : (
              <>
                {!sending && <Stage done={!!proposal && proposal.status !== "Screening"} active={!proposal || proposal.status === "Screening"} label="Screening in the enclave" />}
                {!sending && proposal?.status === "Screening" && <SlowScreen startedAt={run.startedAt} deadline={proposal.screen_deadline} />}
                {proposal && proposal.status !== "Screening" && <Verdict proposal={proposal} />}
              </>
            )}
          </motion.ol>
        )}
      </AnimatePresence>
    </motion.li>
  );
}

/** NEAR AI usually answers in about 2 s. If it hasn't after 45 s, say what happens if it never does. */
function SlowScreen({ startedAt, deadline }: { startedAt: number; deadline: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(tick);
  }, []);
  if (now - startedAt < 45_000) return null;
  const at = new Date(Number(BigInt(deadline) / 1_000_000n)).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  return (
    <motion.li className={styles.slow} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={SPRING_UI}>
      NEAR AI hasn&apos;t answered yet. If it doesn&apos;t by {at}, the payment expires unpaid: without a signed PASS, Veto never pays.
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

/** On the Agent API path the sandbox's suppliers stand for the account's mainnet ones. */
function agentApiPayee(payee: string, outcome?: AgentApiOutcome, label?: string) {
  if (outcome) {
    if (!outcome.request.payee_name) return "an address the owner's policy doesn't list";
    return outcome.request.chain === "near" ? outcome.request.payee_name : `${outcome.request.payee_name}, on ${chainName(outcome.request.chain)}`;
  }
  if (label) return label;
  if (payee.startsWith("kano-cotton.")) return "Kano Cotton Mills";
  if (payee.startsWith("ibadan-dye.")) return "Ibadan Dye Works";
  return "an address the owner's policy doesn't list";
}

const chainName = (chain: string) => ({ base: "Base", arb: "Arbitrum", eth: "Ethereum", sol: "Solana", op: "Optimism" })[chain] ?? chain;

/** What the Agent API's refusal means, in words; the owner's policy is the layer that says no. */
function refusalText(code: string, message: string) {
  if (code === "insufficient_balance") return "The demo wallet is out of USDC right now, so the Agent API refused it. Nothing was charged.";
  if (code === "policy_destination_denied") return "The owner's policy doesn't allow this payee, so the Agent API refused it.";
  if (code === "policy_transaction_limit_exceeded") return "It's above the owner's per-payment limit, so the Agent API refused it.";
  if (code === "spend_budget_exceeded" || code === "policy_limit_exceeded") return "It's over the owner's daily limit, so the Agent API refused it.";
  if (code === "wallet_frozen") return "The owner froze this wallet.";
  if (code === "vault_frozen") return "The owner froze the vault, so Veto sent nothing.";
  return message;
}

function AgentApiVerdict({ outcome }: { outcome: AgentApiOutcome }) {
  const { verdict, execution } = outcome;
  const vetoed = verdict.verdict === "VETO";
  const paid = execution.kind === "sent" && execution.status === "SUCCESS";
  const label = vetoed ? "Vetoed" : paid ? "Paid" : execution.kind === "sent" ? "Passed, sending" : "Passed";
  const text = vetoed
    ? `${verdict.reasons[0] ? reasonText(verdict.reasons[0]) : "The screen said no."} Nothing was sent: Veto didn't use its grant.`
    : execution.kind === "refused"
      ? execution.code === "vault_frozen"
        ? `Passed, but ${refusalText(execution.code, execution.message).charAt(0).toLowerCase()}${refusalText(execution.code, execution.message).slice(1)}`
        : `Veto sent it with its grant. ${refusalText(execution.code, execution.message)}`
      : paid
        ? outcome.request.chain === "near"
          ? "Veto sent it with its grant and the Agent API paid it on mainnet."
          : `Veto sent it with its grant and NEAR Intents paid it out on ${chainName(outcome.request.chain)}.`
        : execution.kind === "sent"
          ? `Veto sent it with its grant; the Agent API says ${execution.status.toLowerCase().replace(/_/g, " ")}.`
          : "Passed.";

  return (
    <motion.li className={styles.verdict} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={SPRING_BOUNCE}>
      <span className={`${styles.verdictPill} ${vetoed ? styles.pillVeto : paid || execution.kind !== "refused" ? styles.pillPass : styles.pillIdle}`}>
        <Icon name={vetoed ? "x" : paid ? "check" : execution.kind === "refused" ? "shield" : "check"} size={13} stroke={3} />
        {label}
      </span>
      <span className={styles.verdictText}>{text}</span>
      {execution.kind === "sent" && execution.tx_hash && (
        <a href={`https://nearblocks.io/txns/${execution.tx_hash}`} target="_blank" rel="noreferrer" className={styles.open}>
          See it on NearBlocks <Icon name="external" size={13} stroke={2.25} />
        </a>
      )}
      <span className={styles.signer}>
        Signed in the enclave by <span className="mono">{verdict.signer.slice(0, 8)}…{verdict.signer.slice(-4)}</span>
        {verdict.approved_signer ? ", a key the vault approves" : ", not a key the vault approves"}
      </span>
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

const AGENT_EMAIL = process.env.NEXT_PUBLIC_AGENT_EMAIL;

/** Write the agent an email: a real model reads it and proposes whatever it asks for. */
function Composer({ vault, compact }: { vault: string; compact: boolean }) {
  const demo = useDemo();
  const root = vault.split(".").slice(1).join(".");
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState("accounts@kanocottonmills.ng");
  const [subject, setSubject] = useState("Invoice INV-3001: 40 bales of combed cotton");
  // Real USDC on the Agent API path is paid as written, so its sample asks for cents, inside the owner's cap.
  // The sample follows the path until someone edits it.
  const sampleDue = demo.payFrom === "agentapi" && demo.info?.agentapi ? "$0.06" : "$120.00";
  const [edited, setBody] = useState<string | null>(null);
  const body =
    edited ?? `Good morning. Please pay invoice INV-3001 for 40 bales of combed cotton. Amount due: ${sampleDue} USDC to our usual account kano-cotton.${root}. Thank you.`;
  const busy = Object.values(demo.runs).some(inFlight);

  if (!open) {
    // The sandbox agent also has a real inbox (app/api/inbox/email): mail it from your own account.
    const realInbox = AGENT_EMAIL && demo.info?.sandbox && demo.payFrom !== "agentapi";
    const mailto = `mailto:${AGENT_EMAIL}?subject=${encodeURIComponent("Invoice INV-7731")}&body=${encodeURIComponent(`Hello, please pay invoice INV-7731 for 120 USDC to kano-cotton.${root}. Thanks!`)}`;
    return (
      <>
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
        {realInbox && (
          <p className={styles.realInbox}>
            <Icon name="mail" size={15} />
            <span>
              Or email it for real at{" "}
              <a href={mailto} className="mono">
                {AGENT_EMAIL}
              </a>
              . It replies with Veto&apos;s decision.
            </span>
          </p>
        )}
      </>
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
        {demo.payFrom === "agentapi" && demo.info?.agentapi ? (
          <>Your email is paid as written, in real USDC on mainnet. The owner&apos;s policy allows at most $0.10 a payment, to its listed payees, so anything bigger is refused there.</>
        ) : (
          <>
            USDC goes to a NEAR account (like <span className="mono">kano-cotton.{root}</span>); ETH goes to a 0x address on Base Sepolia.
            {demo.info?.sandbox && <> The shared sandbox publishes what you write with its proof, so keep it made up.</>}
          </>
        )}
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
