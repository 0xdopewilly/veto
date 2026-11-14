"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Proposal } from "@veto/core/proposal";
import { metaOf, useVault, type VaultState } from "@/lib/vault";
import { useProposal } from "@/lib/useProposal";
import { useKeptBlocked } from "@/lib/dismissed";
import { useNow } from "@/lib/useNow";
import { evmTxUrl, imitated, isTestSigner, listedPayee, payeeHistory, payeeLabel, payoutTxUrl, reasonDetail, reasonText, STATUS_TEXT } from "@/lib/decision";
import { chainLabel, formatAmount, formatDuration, formatParts, formatShort, formatTime, formatWhen, formatWhenInline, possessive, remaining, shortAddress, shortHash } from "@/lib/format";
import { Screen, BackLink, delay } from "@/components/Screen";
import { useBackTo } from "@/lib/backTo";
import { Boot } from "@/components/Boot";
import { Circuit } from "@/components/Circuit";
import { LineReveal } from "@/components/LineReveal";
import { MaskedLetters } from "@/components/MaskedLetters";
import { Odometer } from "@/components/Odometer";
import { useMorphHold } from "@/lib/morph";
import { AddressCompare } from "@/components/AddressCompare";
import { Icon } from "@/components/Icon";
import { Pill } from "@/components/Pill";
import { OwnerButton } from "@/components/OwnerButton";
import { VLoader } from "@/components/VLoader";
import { Deferred } from "@/components/Deferred";
import { ShareCatch } from "@/components/ShareCatch";
import styles from "./DecisionView.module.css";

const periodName = (secs: string) => (secs === "604800" ? "weekly" : secs === "86400" ? "daily" : "period");

/** Who asked, in plain words: the account lives on the Agents page. */
const asker = (p: Proposal) => (p.external ? "Your agent's OutLayer wallet" : "Your agent");

export function DecisionView({ id }: { id: string }) {
  const { state } = useVault();
  const { proposal, missing } = useProposal(id);

  if (missing) {
    return (
      <Screen pushed>
        <BackLink />
        <h1 className={styles.plainTitle}>No payment with that number</h1>
        <p className={styles.plainText}>This vault has no proposal {id}. It may belong to a different vault.</p>
      </Screen>
    );
  }
  if (!state || !proposal) return <Boot loading caption="Loading the decision" />;

  return (
    <Boot>
      <span className="visually-hidden" role="status" aria-live="polite">
        {STATUS_TEXT[proposal.status]}
      </span>
      <DecisionBody state={state} proposal={proposal} />
    </Boot>
  );
}

function DecisionBody({ state, proposal }: { state: VaultState; proposal: Proposal }) {
  switch (proposal.status) {
    case "Vetoed":
      return <Vetoed state={state} p={proposal} />;
    case "OverridePending":
      return <OverridePending state={state} p={proposal} />;
    case "Paid":
      return <Paid state={state} p={proposal} />;
    case "Screening":
    case "Executing":
      return <InFlight state={state} p={proposal} />;
    default:
      return <Closed state={state} p={proposal} />;
  }
}

function amountParts(state: VaultState, p: Proposal) {
  const meta = metaOf(state, p.request.asset);
  const parts = formatParts(p.request.amount, meta);
  return { meta, figure: `${parts.prefix}${parts.whole}${parts.cents}`, unit: parts.suffix };
}

/** The decision's amount rolling into place once the screen is revealed. */
function Amount({ figure, unit, muted = false, at, play }: { figure: string; unit: string; muted?: boolean; at: number; play: boolean }) {
  return (
    <div className={`${styles.amountRow} rise`} style={delay(at)}>
      <Odometer value={figure} className={styles.amount} delay={at + 60} play={play} />
      <span className={muted ? styles.unitMuted : styles.unit}>{unit}</span>
    </div>
  );
}

/** The limits line under the checks. The per-payment limit, not this week's remaining budget, which moves after the fact. */
function capCaption(state: VaultState, p: Proposal, paid = false): string {
  const meta = metaOf(state, p.request.asset);
  const policy = state.policies.find(([asset]) => asset === p.request.asset)?.[1];
  const amount = formatShort(p.request.amount, meta);
  if (policy && BigInt(p.request.amount) <= BigInt(policy.max_single)) {
    const within = `${amount} is within your ${formatShort(policy.max_single, meta)} per-payment limit and your ${periodName(state.config.period_secs)} limit.`;
    return paid ? within : `${within} A plain spending limit would have paid it.`;
  }
  return paid ? "Within your limits." : "It was within your limits when your agent asked. Only the AI screen vetoed it.";
}

/* ---------------------------------------------------------------- Vetoed */

/** Reasons that say someone is posing as a payee. With any of them, Veto never offers to save the address. */
const SCAM_SIGNS = new Set(["LOOKALIKE_ADDRESS", "CHANGED_PAYOUT_DETAILS", "DUPLICATE_INVOICE", "URGENCY_PRESSURE", "AMOUNT_ANOMALY", "UNLIMITED_APPROVAL"]);

/** "acme-supplies.testnet" → "Acme Supplies"; a 0x address gets no guess. */
const nameFrom = (address: string) =>
  /^0x/i.test(address)
    ? ""
    : address
        .split(".")[0]
        .split(/[-_]+/)
        .filter(Boolean)
        .map((w) => w[0].toUpperCase() + w.slice(1))
        .join(" ")
        .slice(0, 64);

/**
 * A first payment to someone new, held only for being new: pay it and save them, in one
 * transaction, so their next invoice isn't held for the same reason. The more you use Veto, the
 * fewer payments wait for you.
 */
function PayAndSave({ p, delaySecs }: { p: Proposal; delaySecs: number }) {
  const [name, setName] = useState(() => nameFrom(p.request.payee));
  const trimmed = name.trim();
  return (
    <div className={styles.save}>
      <label className={styles.saveLabel} htmlFor={`save-${p.id}`}>
        Know them? Save them as
      </label>
      <input
        id={`save-${p.id}`}
        className={styles.saveInput}
        value={name}
        maxLength={64}
        placeholder="Their name"
        autoComplete="off"
        onChange={(e) => setName(e.target.value)}
      />
      <OwnerButton
        method="override_and_save"
        args={{ id: p.id, name: trimmed }}
        batch={[
          { method: "add_payee", args: { name: trimmed, chain: p.request.chain, address: p.request.payee } },
          { method: "override_veto", args: { id: p.id } },
        ]}
        disabled={!trimmed}
        variant="inkOutline"
        size="md"
        icon="check"
        full
        success="Saved, paying soon"
        confirmTone="ink"
      >
        Pay and save them
      </OwnerButton>
    </div>
  );
}

function Vetoed({ state, p }: { state: VaultState; p: Proposal }) {
  const router = useRouter();
  const back = useBackTo();
  const play = !useMorphHold();
  const { keep } = useKeptBlocked();
  const { figure, unit } = amountParts(state, p);
  const look = imitated(state.payees, p);
  const reasons = p.verdict?.reasons.length ? p.verdict.reasons : ["MANDATE_VIOLATION"];
  const delaySecs = Number(state.config.override_delay_secs);
  const who = look ? ` from ${look.payee.name}` : "";
  const what = p.request.memo ? `invoice ${p.request.memo}${who}` : `a payment${who}`;
  const { vaultId, isSandbox } = useVault();
  // Held for being new and little else (an honest first invoice reads as "new payee" plus one more
  // reason at most), with no sign of anyone posing as someone else.
  const savable =
    reasons.includes("NEW_PAYEE") &&
    reasons.length <= 2 &&
    !look &&
    !listedPayee(state.payees, p) &&
    !reasons.some((r) => SCAM_SIGNS.has(r)) &&
    (!isSandbox || p.request.chain === "near");

  const actions = (
    <div className={styles.actions}>
      {p.external ? (
        // The wallet is still holding it: record the decision so Veto rejects it there for good.
        <OwnerButton
          method="keep_blocked"
          args={{ id: p.id }}
          variant="ink"
          full
          success="Kept blocked"
          confirmTone="ink"
          onDone={() => {
            keep(p.id);
            router.push(back.href);
          }}
        >
          Keep it blocked
        </OwnerButton>
      ) : (
        <Pill
          variant="ink"
          full
          onClick={() => {
            keep(p.id);
            router.push(back.href);
          }}
        >
          Keep it blocked
        </Pill>
      )}
      {savable && <PayAndSave p={p} delaySecs={delaySecs} />}
      <OwnerButton
        method="override_veto"
        args={{ id: p.id }}
        variant="inkOutline"
        size={savable ? "sm" : "md"}
        icon="clock"
        full
        success="Override scheduled"
        confirmTone="ink"
        quiet={savable}
      >
        {savable ? "Pay once, without saving them" : `Override (pays in ${formatDuration(delaySecs)})`}
      </OwnerButton>
      <p className={styles.actionNote}>
        {savable
          ? `Either way it pays in ${formatDuration(delaySecs)}, and you can cancel until then. A saved payee isn't held for being new, so their next invoice can go straight through.`
          : "You can cancel an override any time before it pays."}
      </p>
      {!savable && <ShareCatch p={p} vaultId={vaultId} amount={formatShort(p.request.amount, metaOf(state, p.request.asset))} to={listedPayee(state.payees, p)?.name ?? shortAddress(p.request.payee)} />}
    </div>
  );

  return (
    <Screen pushed tone="coral" wide>
      <div className={styles.topRow}>
        <BackLink onCoral morphId={p.id} />
        <span className={styles.time}>{formatWhen(p.verdict?.recorded_at ?? p.created_at)}</span>
      </div>

      <section className={styles.band} aria-label="Verdict">
        <div className={styles.bandMain}>
          <h1 className={styles.vetoed}>
            <MaskedLetters text="VETOED" delay={170} stagger={35} />
          </h1>
          <Amount figure={figure} unit={unit} at={420} play={play} />
          <span className={`${styles.to} rise`} style={delay(480)}>
            to <span className="mono">{shortAddress(p.request.payee)}</span> on {chainLabel(p.request.chain)}
          </span>
          <p className={`${styles.request} rise`} style={delay(540)}>
            {asker(p)} asked to pay {what}.{p.external ? " OutLayer is holding it; Veto never approved it." : ""}
          </p>
        </div>
        <div className={`${styles.bandActions} rise`} style={delay(600)}>{actions}</div>
      </section>

      <div className={styles.mobileActions}>{actions}</div>

      <Deferred>
      <div className={styles.columns}>
        <div className={styles.colMain}>
          <h2 className={`${styles.h2} rise`} style={delay(440)}>Why it was vetoed</h2>
          <ol className={styles.reasons}>
            {reasons.map((code, i) => {
              const detail = reasonDetail(code, p, state.payees, state.proposals);
              return (
                <li key={code} className={`${styles.reason} rise`} style={delay(500 + i * 80)}>
                  <span className={styles.reasonNumber} aria-hidden="true">{i + 1}</span>
                  <div className={styles.reasonBody}>
                    {code === "LOOKALIKE_ADDRESS" && look ? (
                      <LookalikeReason state={state} p={p} look={look} />
                    ) : (
                      <>
                        <span className={styles.reasonTitle}>{reasonText(code)}</span>
                        {detail && <p className={styles.reasonText}>{detail}</p>}
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </div>

        <div className={styles.colSide}>
          <section className={`${styles.circuitCard} rise`} style={delay(300)} aria-label="Checks">
            <Circuit ai="veto" paid={false} delay={190} play={play} />
            <p className={styles.caption}>{capCaption(state, p)}</p>
          </section>
          <aside className={`${styles.proofCard} rise`} style={delay(560)} aria-label="Proof">
            <ProofSummary p={p} />
          </aside>
        </div>
      </div>
      </Deferred>
    </Screen>
  );
}

function LookalikeReason({ state, p, look }: { state: VaultState; p: Proposal; look: NonNullable<ReturnType<typeof imitated>> }) {
  const history = payeeHistory(state.proposals, look.payee);
  const evm = p.request.payee.startsWith("0x");
  return (
    <>
      <span className={styles.reasonTitle}>A lookalike of {possessive(look.payee.name)} address</span>
      <p className={styles.reasonText}>
        {evm
          ? `${history.count ? "You've paid them before at a different address" : "Their saved address is different"} that shortens to the same ${shortAddress(p.request.payee)}. Only the middle differs, which is how address-poisoning scams work.`
          : `The account looks like theirs but isn't (${look.why}). Compare:`}
      </p>
      <AddressCompare
        saved={look.payee.address}
        requested={p.request.payee}
        savedLabel={history.count ? "Saved payee, paid before" : "Saved payee"}
      />
    </>
  );
}

const shortModel = (model: string) => (model.split("/").pop() ?? model).replace(/-Instruct$/i, "").replace(/-A\d+B$/i, "");

function ProofSummary({ p }: { p: Proposal }) {
  const v = p.verdict;
  if (!v) return null;
  const test = isTestSigner(v.model_id);
  return (
    <div className={styles.proof}>
      <div className={styles.proofHead}>
        <span className={styles.proofTitle}>
          <Icon name="shield" size={18} />
          Proof
        </span>
        <Link href={`/app/decisions/${p.id}/proof`} className={styles.proofLink}>
          See the proof <Icon name="arrowRight" size={14} stroke={2.25} />
        </Link>
      </div>
      <ul className={styles.proofList}>
        <li>
          <Icon name="check" size={15} stroke={2.5} />
          {test ? "Signed by a labelled test key, not by a NEAR AI enclave" : `Screened by ${shortModel(v.model_id)} inside NEAR AI Cloud's secure enclave`}
        </li>
        <li>
          <Icon name="check" size={15} stroke={2.5} />
          Your vault checked the enclave's signature on-chain before it acted
        </li>
      </ul>
    </div>
  );
}

/* ------------------------------------------------------- Override pending */

function OverridePending({ state, p }: { state: VaultState; p: Proposal }) {
  const now = useNow(1000);
  const { meta } = amountParts(state, p);
  const at = p.override_executes_at ?? "0";
  const left = remaining(at, now);
  const look = imitated(state.payees, p);
  const requestedAt = (BigInt(at) - BigInt(state.config.override_delay_secs) * 1_000_000_000n).toString();

  return (
    <Screen pushed wide>
      <div className={styles.topRow}>
        <BackLink morphId={p.id} />
      </div>
      <div className={styles.pendingLayout}>
        <section className={`${styles.pendingHero} ${styles.panel}`}>
          <span className={`${styles.pendingPill} rise`}>
            <Icon name="clock" size={14} stroke={2.25} /> Override pending
          </span>
          {left.done ? (
            <h1 className={`${styles.countdown} rise`} style={delay(80)}>Ready to pay</h1>
          ) : (
            <h1 className={`${styles.countdown} rise`} style={delay(80)}>
              <span className={styles.countLabel}>Pays in</span>
              {left.hours > 0 && (
                <>
                  <Odometer value={String(left.hours)} fixed />
                  <small> h </small>
                </>
              )}
              <Odometer value={left.hours > 0 ? String(left.minutes).padStart(2, "0") : String(left.minutes)} fixed />
              <small> min </small>
              {left.hours === 0 && (
                <>
                  <Odometer value={String(left.seconds).padStart(2, "0")} fixed />
                  <small> s</small>
                </>
              )}
            </h1>
          )}
          <p className={`${styles.pendingWhen} rise`} style={delay(140)}>
            {left.done ? "The delay is over. Anyone can now send it, or you can still cancel." : `Pays ${formatWhenInline(at)} unless you cancel.`}
          </p>

          <dl className={`${styles.details} rise`} style={delay(200)}>
            <dt>Amount</dt>
            <dd>{formatAmount(p.request.amount, meta)}</dd>
            <dt>To</dt>
            <dd>
              <span className="mono">{shortAddress(p.request.payee)}</span> on {chainLabel(p.request.chain)}
            </dd>
            <dt>Limits</dt>
            <dd>Your limits still apply</dd>
          </dl>

          {look && (
            <div className={`${styles.warning} rise`} style={delay(260)} role="note">
              <span className={styles.warningTitle}>Check before it pays</span>
              <p>
                This address is a lookalike of {possessive(look.payee.name)} saved address. Only let it pay if {look.payee.name} confirmed the new address by phone.
              </p>
            </div>
          )}

          <div className={`${styles.pendingActions} rise`} style={delay(320)}>
            {left.done && (
              <OwnerButton method="execute_override" args={{ id: p.id }} anyone variant="primary" full icon="arrowRight" success="Sent">
                Pay now
              </OwnerButton>
            )}
            <OwnerButton method="cancel_override" args={{ id: p.id }} variant={left.done ? "secondary" : "primary"} size={left.done ? "md" : "lg"} full success="Cancelled">
              Cancel override
            </OwnerButton>
          </div>
        </section>

        <section className={`${styles.timelineCard} ${styles.panel} rise`} style={delay(380)} aria-label="Timeline">
          <h2 className={styles.h2Small}>Timeline</h2>
          <ol className={styles.timeline}>
            <li>
              <span className={`${styles.tlDot} ${styles.tlVeto}`} />
              <span>Vetoed</span>
              <span className={styles.tlTime}>{formatWhen(p.verdict?.recorded_at ?? p.created_at)}</span>
            </li>
            <li>
              <span className={`${styles.tlDot} ${styles.tlDone}`} />
              <span>Override requested</span>
              <span className={styles.tlTime}>{formatWhen(requestedAt)}</span>
            </li>
            <li>
              <span className={`${styles.tlDot} ${styles.tlPending}`} />
              <span>Pays</span>
              <span className={styles.tlTime}>{formatWhen(at)}</span>
            </li>
          </ol>
        </section>
      </div>
    </Screen>
  );
}

/* ------------------------------------------------------------------ Paid */

function Paid({ state, p }: { state: VaultState; p: Proposal }) {
  const play = !useMorphHold();
  const { figure, unit } = amountParts(state, p);
  const listed = listedPayee(state.payees, p);
  return (
    <Screen pushed wide>
      <div className={styles.topRow}>
        <BackLink morphId={p.id} />
        <span className={styles.timeMuted}>{formatWhen(p.settled_at ?? p.created_at)}</span>
      </div>
      <div className={styles.paidLayout}>
        <section className={`${styles.paidHero} ${styles.panel}`}>
          <span className={styles.paidGlow} aria-hidden="true" />
          <span className={`${styles.paidCheck} pop`} style={delay(120)}>
            <Icon name="check" size={28} stroke={3} />
          </span>
          <LineReveal as="h1" className={styles.paidTitle} text="Paid" delay={200} />
          <Amount figure={figure} unit={unit} muted at={260} play={play} />
          <span className={`${styles.paidTo} rise`} style={delay(320)}>
            to {payeeLabel(state.payees, p)} on {chainLabel(p.request.chain)}
          </span>
          {p.request.memo && (
            <span className={`${styles.paidMeta} rise`} style={delay(360)}>
              {asker(p)} asked to pay {p.request.memo}.
            </span>
          )}
          <div className={`${styles.paidLine} draw`} style={delay(600)} aria-hidden="true" />
        </section>

        <Deferred>
        <section className={`${styles.checks} ${styles.panel} rise`} style={delay(160)} aria-label="Checks">
          <h2 className={styles.h2Small}>Checks</h2>
          <div className={styles.checkRow}>
            <div>
              <span className={styles.checkName}>Your limits</span>
              <span className={styles.checkDetail}>{capCaption(state, p, true)}</span>
            </div>
            <span className={styles.passBadge}>Pass</span>
          </div>
          <div className={styles.checkRow}>
            <div>
              <span className={styles.checkName}>AI screen</span>
              <span className={styles.checkDetail}>{listed ? `Saved payee, ${listed.name}. Nothing in the request looked wrong.` : "Nothing in the request looked wrong."}</span>
            </div>
            <span className={styles.passBadge}>Pass</span>
          </div>
          {p.evm && (
            <div className={styles.checkRow}>
              <div>
                <span className={styles.checkName}>Chain Signatures</span>
                <span className={styles.checkDetail}>
                  NEAR's MPC network signed this exact transfer for the vault's own address on {chainLabel(p.request.chain)}.{" "}
                  {evmTxUrl(p) && (
                    <a href={evmTxUrl(p)!} target="_blank" rel="noreferrer">
                      View it on the explorer
                    </a>
                  )}
                </span>
              </div>
              <span className={styles.passBadge}>Signed</span>
            </div>
          )}
          {p.external && (
            <div className={styles.checkRow}>
              <div>
                <span className={styles.checkName}>OutLayer wallet</span>
                <span className={styles.checkDetail}>
                  Held the payment until both checks passed, then sent it on Veto&apos;s approval.{" "}
                  {p.external.tx_hash && (
                    <a href={payoutTxUrl(p)!} target="_blank" rel="noreferrer">
                      View it on the explorer
                    </a>
                  )}
                </span>
              </div>
              <span className={styles.passBadge}>Sent</span>
            </div>
          )}
        </section>

        <aside className={`${styles.colSideDark} ${styles.panel} rise`} style={delay(220)}>
          <ProofSummary p={p} />
        </aside>
        </Deferred>
      </div>
    </Screen>
  );
}

/* --------------------------------------------------- Screening / Sending */

function InFlight({ state, p }: { state: VaultState; p: Proposal }) {
  const now = useNow(1000);
  const meta = metaOf(state, p.request.asset);
  const screening = p.status === "Screening";
  const left = remaining(p.screen_deadline, now);
  return (
    <Screen pushed>
      <BackLink morphId={p.id} />
      <section className={styles.inflight}>
        <VLoader size={96} label={screening ? "Screening" : "Sending"} />
        <LineReveal as="h1" className={styles.plainTitle} text={screening ? "Screening in the enclave" : "Sending"} />
        <p className={`${styles.plainText} rise`} style={delay(80)}>
          {formatAmount(p.request.amount, meta)} to <span className="mono">{shortAddress(p.request.payee)}</span>
          {screening
            ? ", inside an enclave on NEAR AI Cloud."
            : p.external
              ? ". Both checks passed; Veto approved it on OutLayer and the wallet is sending it."
              : p.evm
                ? p.evm.r
                  ? ". Both checks passed; NEAR's MPC network signed it for the vault's own address, and it's being sent."
                  : ". Both checks passed; NEAR's MPC network is signing it for the vault's own address."
                : ". Both checks passed; the transfer is on its way."}
        </p>
        {screening && (
          <p className={styles.plainMuted}>
            {left.done ? "No verdict arrived in time. It will expire, so nothing is paid." : `If no verdict arrives in ${left.minutes} min ${left.seconds} s, it fails closed and nothing is paid.`}
          </p>
        )}
        <div className={`${styles.inflightCircuit} ${styles.panel} rise`} style={delay(160)}>
          <Circuit ai={screening ? "pending" : "pass"} paid={false} />
        </div>
      </section>
    </Screen>
  );
}

/* ----------------------------------------- Expired / Cancelled / Failed */

const CLOSED: Record<string, { title: string; text: string }> = {
  Expired: { title: "Expired", text: "No verdict arrived before the deadline, so the payment failed closed. Nothing was paid." },
  Cancelled: { title: "Kept blocked", text: "The owner closed this payment before it paid: the veto was kept, or the override cancelled. Nothing was paid." },
  Failed: { title: "Transfer failed", text: "Both checks passed but the transfer didn't go through. The amount was released back to this period's limit." },
};

function Closed({ state, p }: { state: VaultState; p: Proposal }) {
  const meta = metaOf(state, p.request.asset);
  const copy = CLOSED[p.status] ?? CLOSED.Expired;
  return (
    <Screen pushed>
      <BackLink morphId={p.id} />
      <section className={styles.inflight}>
        <span className={styles.closedIcon}>
          <Icon name={p.status === "Failed" ? "x" : "clock"} size={26} />
        </span>
        <LineReveal as="h1" className={styles.plainTitle} text={copy.title} />
        <p className={`${styles.plainText} rise`} style={delay(80)}>{copy.text}</p>
        <p className={`${styles.plainMuted} rise`} style={delay(140)}>
          {formatAmount(p.request.amount, meta)} to <span className="mono">{shortAddress(p.request.payee)}</span>. {asker(p)} asked {formatWhenInline(p.created_at)}.
        </p>
        {p.verdict && (
          <div className={`${styles.closedProof} ${styles.panel} rise`} style={delay(200)}>
            <ProofSummary p={p} />
          </div>
        )}
      </section>
    </Screen>
  );
}
