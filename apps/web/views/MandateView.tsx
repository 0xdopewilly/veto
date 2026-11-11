"use client";

import { useEffect, useState } from "react";
import { metaOf, type VaultState } from "@/lib/vault";
import { useNow } from "@/lib/useNow";
import { formatAmount, formatDuration, formatTime, formatWhen, remaining } from "@/lib/format";
import { delay } from "@/components/Screen";
import { Icon } from "@/components/Icon";
import { Pill } from "@/components/Pill";
import { OwnerButton } from "@/components/OwnerButton";
import styles from "./MandateView.module.css";

const AI_CHECKS = [
  "Payee is on your list",
  "Address matches the one you paid before",
  "Not a lookalike of a saved address",
  "No unlimited token approvals",
  "Instruction didn't come from an email or web page",
];

const periodWord = (secs: string) => (secs === "604800" ? "Weekly" : secs === "86400" ? "Daily" : "Period");

/** Parses "500" or "1,250.5" into the asset's smallest unit. */
function toUnits(input: string, decimals: number): string | null {
  const clean = input.replace(/[,\s$]/g, "");
  if (!/^\d+(\.\d+)?$/.test(clean)) return null;
  const [whole, frac = ""] = clean.split(".");
  return (BigInt(whole) * 10n ** BigInt(decimals) + BigInt((frac + "0".repeat(decimals)).slice(0, decimals) || "0")).toString();
}

/** The mandate in your words and the limits the contract enforces: the first part of Rules. */
export function MandateSection({ state }: { state: VaultState }) {
  const [draft, setDraft] = useState<string | null>(null);

  const text = draft ?? state.config.mandate;
  const changed = draft !== null && draft !== state.config.mandate;
  const raiseDelay = formatDuration(Number(state.config.raise_delay_secs));

  return (
    <>
      {state.pending.map(([asset, change], i) => (
        <PendingBanner key={asset} state={state} asset={asset} change={change} style={delay(120 + i * 60)} />
      ))}

      <div className={styles.columns}>
        <section className={`${styles.words} rise`} style={delay(160)} aria-labelledby="words-title">
          <h3 id="words-title" className={styles.h2}>In your words</h3>
          <label htmlFor="mandate" className="visually-hidden">Mandate</label>
          <textarea
            id="mandate"
            className={styles.textarea}
            value={text}
            maxLength={2000}
            rows={6}
            onChange={(e) => setDraft(e.target.value)}
          />
          <p className={styles.helper}>Write it the way you'd brief a new bookkeeper. The AI screen reads it on every payment.</p>
          <div className={styles.buttons}>
            <OwnerButton method="set_mandate" args={{ mandate: text }} success="Saved" full onDone={() => setDraft(null)}>
              Save mandate
            </OwnerButton>
            {changed && (
              <Pill variant="secondary" size="md" full onClick={() => setDraft(null)}>
                Discard changes
              </Pill>
            )}
          </div>
        </section>

        <section className={`${styles.enforce} rise`} style={delay(240)} aria-labelledby="enforce-title">
          <h3 id="enforce-title" className={styles.h2}>What Veto enforces</h3>

          <div className={styles.group}>
            <h4 className={styles.h3}>Enforced by the contract</h4>
            <p className={styles.groupText}>Hard limits. Nothing pays past them, not even an override.</p>
            <dl className={styles.limits}>
              {state.policies.map(([asset, policy]) => {
                const meta = metaOf(state, asset);
                return (
                  <div key={asset} className={styles.limitGroup}>
                    <dt>{periodWord(state.config.period_secs)} limit · {meta.symbol}</dt>
                    <dd>{formatAmount(policy.period_limit, meta)}</dd>
                    <dt>Largest single payment</dt>
                    <dd>{formatAmount(policy.max_single, meta)}</dd>
                  </div>
                );
              })}
              <div className={styles.limitGroup}>
                <dt>Assets</dt>
                <dd>{state.policies.map(([asset]) => metaOf(state, asset).symbol).join(", ")}</dd>
                <dt>Overrides wait</dt>
                <dd>{formatDuration(Number(state.config.override_delay_secs))}</dd>
              </div>
            </dl>
            <LimitForm state={state} />
          </div>

          <div className={styles.group}>
            <h4 className={styles.h3}>Checked by the AI screen</h4>
            <p className={styles.groupText}>Checked in the enclave on every payment. A failed check blocks the payment. Passing never lifts a limit.</p>
            <ul className={styles.checks}>
              {AI_CHECKS.map((check, i) => (
                <li key={check} className="rise" style={delay(320 + i * 50)}>
                  <span className={styles.checkIcon} aria-hidden="true">
                    <Icon name="shield" size={14} />
                  </span>
                  {check}
                </li>
              ))}
            </ul>
          </div>

          <p className={styles.timelockNote}>
            <Icon name="clock" size={15} />
            Raising a limit takes effect after {raiseDelay}. Lowering it is immediate.
          </p>
        </section>
      </div>
    </>
  );
}

function PendingBanner({
  state,
  asset,
  change,
  style,
}: {
  state: VaultState;
  asset: string;
  change: VaultState["pending"][number][1];
  style?: React.CSSProperties;
}) {
  const now = useNow(1000);
  const meta = metaOf(state, asset);
  const left = remaining(change.effective_at, now);
  return (
    <div className={`${styles.banner} rise`} style={style} role="status">
      <div className={styles.bannerText}>
        <span className={styles.bannerTitle}>
          {meta.symbol} limits rising to {formatAmount(change.policy.period_limit, meta)} a period, {formatAmount(change.policy.max_single, meta)} a payment
        </span>
        <span className={styles.bannerSub}>
          {left.done
            ? "The delay is over. Anyone can apply it now."
            : `Takes effect ${formatWhen(change.effective_at)} at ${formatTime(change.effective_at)}. Raising a limit waits; lowering it is immediate.`}
        </span>
      </div>
      <div className={styles.bannerActions}>
        {left.done && (
          <OwnerButton method="apply_policy" args={{ asset }} anyone size="sm" success="Applied">
            Apply now
          </OwnerButton>
        )}
        <OwnerButton method="cancel_policy_change" args={{ asset }} variant="secondary" size="sm" success="Cancelled">
          Cancel change
        </OwnerButton>
      </div>
    </div>
  );
}

function LimitForm({ state }: { state: VaultState }) {
  const [asset, setAsset] = useState(state.policies[0]?.[0] ?? "near");
  const meta = metaOf(state, asset);
  const current = state.policies.find(([a]) => a === asset)?.[1];
  const [period, setPeriod] = useState("");
  const [single, setSingle] = useState("");

  useEffect(() => {
    setPeriod("");
    setSingle("");
  }, [asset]);

  const periodUnits = period ? toUnits(period, meta.decimals) : current?.period_limit ?? null;
  const singleUnits = single ? toUnits(single, meta.decimals) : current?.max_single ?? null;
  const valid = !!periodUnits && !!singleUnits && BigInt(singleUnits) <= BigInt(periodUnits) && (!!period || !!single);

  return (
    <details className={styles.limitForm}>
      <summary className="press">Change a limit</summary>
      <div className={styles.formGrid}>
        {state.policies.length > 1 && (
          <label className={styles.field}>
            <span>Asset</span>
            <select value={asset} onChange={(e) => setAsset(e.target.value)}>
              {state.policies.map(([a]) => (
                <option key={a} value={a}>{metaOf(state, a).symbol}</option>
              ))}
            </select>
          </label>
        )}
        <label className={styles.field}>
          <span>{periodWord(state.config.period_secs)} limit</span>
          <span className={styles.well}>
            <span className={styles.token}>{meta.symbol}</span>
            <input inputMode="decimal" placeholder={current ? formatAmount(current.period_limit, meta, { symbol: false }) : ""} value={period} onChange={(e) => setPeriod(e.target.value)} />
          </span>
        </label>
        <label className={styles.field}>
          <span>Largest single payment</span>
          <span className={styles.well}>
            <span className={styles.token}>{meta.symbol}</span>
            <input inputMode="decimal" placeholder={current ? formatAmount(current.max_single, meta, { symbol: false }) : ""} value={single} onChange={(e) => setSingle(e.target.value)} />
          </span>
        </label>
      </div>
      {valid ? (
        <OwnerButton method="set_policy" args={{ asset, policy: { period_limit: periodUnits, max_single: singleUnits } }} full success="Submitted">
          Save limits
        </OwnerButton>
      ) : (
        <p className={styles.formHint}>Enter a new amount. A single payment can't be larger than the period limit.</p>
      )}
    </details>
  );
}
