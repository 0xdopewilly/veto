"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Proposal } from "@veto/core/proposal";
import { metaOf, useVault, type VaultState } from "@/lib/vault";
import { useProposal } from "@/lib/useProposal";
import { useKeptBlocked } from "@/lib/dismissed";
import { useNow } from "@/lib/useNow";
import { STATUS_TEXT, evmTxUrl, imitated, isTestSigner, listedPayee, payeeHistory, payeeLabel, reasonText, requesterLabel } from "@/lib/decision";
import {
  formatAmount,
  formatDuration,
  formatParts,
  formatShort,
  formatTime,
  formatWhen,
  remaining,
  shortAddress,
  shortHash,
  possessive,
  chainLabel,
} from "@/lib/format";
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
import styles from "./DecisionView.module.css";

const periodName = (secs: string) => (secs === "604800" ? "weekly" : secs === "86400" ? "daily" : "period");

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
  return { meta, figure: `${parts.prefix}${parts.whole}${parts.cents}`, unit: parts.suffix || meta.symbol };
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

function capCaption(state: VaultState, p: Proposal): string {
  const spend = state.spend[p.request.asset];
  const meta = metaOf(state, p.request.asset);
  if (spend && BigInt(p.request.amount) <= BigInt(spend.remaining)) {
    return `${formatShort(p.request.amount, meta)} fits in the ${formatShort(spend.remaining, meta)} left of your ${formatShort(spend.period_limit, meta)} ${periodName(state.config.period_secs)} cap. A plain spending limit would have paid it.`;
  }
  return "It was inside your contract caps when your agent proposed it. Only the AI screen stopped it.";
}

/* ---------------------------------------------------------------- Vetoed */

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
      <OwnerButton method="override_veto" args={{ id: p.id }} variant="inkOutline" size="md" icon="clock" full success="Override scheduled" confirmTone="ink">
        {`Override, pays in ${formatDuration(delaySecs)}`}
      </OwnerButton>
      <p className={styles.actionNote}>You can cancel an override any time before it pays.</p>
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
          <LineReveal className={styles.eyebrow} text="Stopped by the AI screen" delay={40} />
          <h1 className={styles.vetoed}>
            <MaskedLetters text="VETOED" delay={170} stagger={35} />
          </h1>
          <Amount figure={figure} unit={unit} at={420} play={play} />
          <span className={`mono ${styles.to} rise`} style={delay(480)}>
            to {shortAddress(p.request.payee)} on {chainLabel(p.request.chain)}
          </span>
          <p className={`${styles.request} rise`} style={delay(540)}>
            <span className="mono">{requesterLabel(p)}</span> tried to pay {what}.{p.external ? " OutLayer is holding it; Veto never approved it." : ""}
          </p>
        </div>
        <div className={`${styles.bandActions} rise`} style={delay(600)}>{actions}</div>
      </section>

      <Deferred>
      <div className={styles.columns}>
        <div className={styles.colMain}>
          <section className={`${styles.circuitCard} rise`} style={delay(300)} aria-label="Checks">
            <Circuit ai="veto" paid={false} delay={190} play={play} />
            <p className={styles.caption}>{capCaption(state, p)}</p>
          </section>

          <h2 className={`${styles.h2} rise`} style={delay(440)}>Why it was stopped</h2>
          <ol className={styles.reasons}>
            {reasons.map((code, i) => (
              <li key={code} className={`${styles.reason} rise`} style={delay(500 + i * 80)}>
                <span className={styles.reasonNumber} aria-hidden="true">{i + 1}</span>
                <div className={styles.reasonBody}>
                  {code === "LOOKALIKE_ADDRESS" && look ? (
                    <LookalikeReason state={state} p={p} look={look} />
                  ) : (
                    <span className={styles.reasonTitle}>{reasonText(code)}</span>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </div>

        <aside className={`${styles.colSide} rise`} style={delay(560)} aria-label="Proof">
          <ProofSummary p={p} />
        </aside>
      </div>
      </Deferred>

      <div className={styles.mobileActions}>{actions}</div>
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
          ? `${history.count ? `Your last ${history.count} payment${history.count === 1 ? "" : "s"} to them went to a different address` : "Their saved address is different"} that shortens to the same ${shortAddress(p.request.payee)}. Only the middle differs, which is how address-poisoning scams work.`
          : `Their saved account is ${look.payee.address}. This request goes to ${p.request.payee}: ${look.why}.`}
      </p>
      <AddressCompare
        saved={look.payee.address}
        requested={p.request.payee}
        savedLabel={history.count ? `Paid before, ${history.count} time${history.count === 1 ? "" : "s"}` : "Saved payee"}
      />
    </>
  );
}

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
          See every step <Icon name="arrowRight" size={14} stroke={2.25} />
        </Link>
      </div>
      <p className={styles.proofText}>
        {test
          ? "Signed by a local test key while the vault was being checked end to end, not by a NEAR AI enclave."
          : "Screened privately inside a hardware enclave on NEAR AI Cloud. Your vault contract checked the model's signature before it acted."}
      </p>
      <dl className={styles.proofList}>
        <dt>Model</dt>
        <dd className="mono">{v.model_id}</dd>
        <dt>Signer</dt>
        <dd className="mono">{shortAddress(v.signer)}</dd>
        <dt>Signature</dt>
        <dd>Checked on-chain</dd>
        <dt>Request</dt>
        <dd className="mono">{shortHash(v.request_hash)}</dd>
      </dl>
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
            {left.done ? "The delay is over. Anyone can now send it, or you can still cancel." : `${formatWhen(at)} at ${formatTime(at)} unless you cancel.`}
          </p>

          <dl className={`${styles.details} rise`} style={delay(200)}>
            <dt>Amount</dt>
            <dd>{formatAmount(p.request.amount, meta)}</dd>
            <dt>To</dt>
            <dd className="mono">{shortAddress(p.request.payee)} on {chainLabel(p.request.chain)}</dd>
            <dt>Limits</dt>
            <dd>Still limited by your contract caps</dd>
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
              <span className={styles.tlTime}>{`${formatWhen(at)}${formatWhen(at).startsWith("Today") ? "" : `, ${formatTime(at)}`}`}</span>
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
  const { meta, figure, unit } = amountParts(state, p);
  const listed = listedPayee(state.payees, p);
  const spend = state.spend[p.request.asset];
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
          <span className={`${styles.paidMeta} rise`} style={delay(360)}>
            {formatWhen(p.settled_at ?? p.created_at)}
            {p.request.memo ? ` · ${p.request.memo}` : ""}
          </span>
          <div className={`${styles.paidLine} draw`} style={delay(600)} aria-hidden="true" />
        </section>

        <Deferred>
        <section className={`${styles.checks} ${styles.panel} rise`} style={delay(160)} aria-label="Checks">
          <h2 className={styles.h2Small}>Checks</h2>
          <div className={styles.checkRow}>
            <div>
              <span className={styles.checkName}>Contract cap</span>
              <span className={styles.checkDetail}>
                {spend ? `${formatShort(p.request.amount, meta)} within the ${formatShort(spend.period_limit, meta)} limit` : "Within the limit"}
              </span>
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
                <span className={styles.checkDetail}>Held the payment until both checks passed, then sent it on Veto's approval.</span>
              </div>
              <span className={styles.passBadge}>Sent</span>
            </div>
          )}
          <Circuit ai="pass" paid delay={240} play={play} />
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
        <LineReveal as="h1" className={styles.plainTitle} text={screening ? "Screening privately" : "Sending"} />
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
          {formatAmount(p.request.amount, meta)} to <span className="mono">{shortAddress(p.request.payee)}</span>, proposed by{" "}
          <span className="mono">{requesterLabel(p)}</span>, {formatWhen(p.created_at)}.
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
