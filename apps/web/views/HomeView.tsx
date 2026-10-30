"use client";

import Link from "next/link";
import { useVault, metaOf, needsDecision } from "@/lib/vault";
import { useWallet } from "@/lib/wallet";
import { useKeptBlocked } from "@/lib/dismissed";
import { VAULT_ID, VAULT_NAME } from "@/lib/config";
import { formatAmount, formatParts, formatShort, formatTime, nsToDate } from "@/lib/format";
import { Screen, delay } from "@/components/Screen";
import { Lockup } from "@/components/Logo";
import { Icon } from "@/components/Icon";
import { LoadingScreen } from "@/components/VLoader";
import { DecisionCard } from "@/components/DecisionCard";
import { ActivityList } from "@/components/ActivityList";
import { useShell } from "@/components/Shell";
import styles from "./HomeView.module.css";

const periodName = (secs: string) => (secs === "604800" ? "this week" : secs === "86400" ? "today" : "this period");

export function HomeView() {
  const { state, error } = useVault();
  const { accountId, connect } = useWallet();
  const { kept } = useKeptBlocked();
  const { openFreeze } = useShell();

  if (!state) return <LoadingScreen caption={error ? "Reconnecting to the vault" : "Opening your vault"} />;

  const meta = metaOf(state, state.primaryAsset);
  const balance = formatParts(state.balances[state.primaryAsset] ?? 0n, meta);
  const others = Object.entries(state.balances).filter(([asset]) => asset !== state.primaryAsset);
  const spend = state.spend[state.primaryAsset];
  const spentRatio = spend ? Number((BigInt(spend.spent) * 1000n) / (BigInt(spend.period_limit) || 1n)) / 10 : 0;
  const attention = needsDecision(state.proposals, kept).slice(0, 2);
  const mandateLine = state.config.mandate.split(/(?<=\.)\s/)[0];

  return (
    <Screen>
      <header className={`${styles.mobileHeader} rise`}>
        <Lockup size={25} />
        <button className={`${styles.round} press`} onClick={connect} aria-label={accountId ? `Signed in as ${accountId}` : "Connect wallet"}>
          <Icon name="wallet" size={19} stroke={1.75} />
          {accountId && <span className={styles.dot} aria-hidden="true" />}
        </button>
      </header>

      <section className={`${styles.account} rise`} style={delay(70)} aria-label="Account">
        <h1 className={styles.name}>{VAULT_NAME}</h1>
        <span className={`mono ${styles.id}`}>{VAULT_ID}</span>
      </section>

      <div className={`${styles.statusRow} rise`} style={delay(140)}>
        <span className={styles.status} role="status">
          <span className={styles.statusDot} data-frozen={state.config.frozen || undefined} aria-hidden="true" />
          {state.config.frozen ? "Payments frozen" : "Screening every payment"}
        </span>
        <button className={`${styles.freeze} press`} onClick={openFreeze}>
          <Icon name={state.config.frozen ? "unlock" : "lock"} size={15} />
          {state.config.frozen ? "Unfreeze" : "Freeze"}
        </button>
      </div>

      <div className={styles.grid}>
        <div className={styles.cards}>
          {attention.map((p, i) => (
            <DecisionCard key={p.id} state={state} proposal={p} style={delay(230 + i * 80)} />
          ))}
          {attention.length === 0 && (
            <div className={`${styles.clear} rise`} style={delay(230)}>
              <Icon name="shield" size={22} />
              <span>Nothing needs you. Every payment so far passed both checks or was kept blocked.</span>
            </div>
          )}
        </div>

        <section className={`${styles.balance} rise`} style={delay(320)} aria-label="Vault balance">
          <span className={styles.label}>Vault balance</span>
          <span className={`${styles.big} tabular`}>
            {balance.prefix}
            {balance.whole}
            <span className={styles.cents}>{balance.cents}</span>
            {balance.suffix && <span className={styles.unit}> {balance.suffix}</span>}
          </span>
          {others.length > 0 && (
            <dl className={styles.breakdown}>
              {others.map(([asset, raw]) => (
                <div key={asset} className={styles.breakdownRow}>
                  <dt>{metaOf(state, asset).symbol}</dt>
                  <dd className="tabular">{formatAmount(raw, metaOf(state, asset), { symbol: false })}</dd>
                </div>
              ))}
            </dl>
          )}
        </section>

        {spend && (
          <section className={`${styles.spend} rise`} style={delay(400)} aria-label="Spending this period">
            <div className={styles.spendTop}>
              <span className={styles.label}>Spent {periodName(state.config.period_secs)}</span>
              <span className="tabular">
                {formatShort(spend.spent, meta)} <span className={styles.muted}>of {formatShort(spend.period_limit, meta)}</span>
              </span>
            </div>
            <div className={styles.track} aria-hidden="true">
              <div className={`${styles.fill} draw`} style={{ width: `${Math.min(100, spentRatio)}%`, animationDelay: "800ms" }} />
            </div>
            <span className={styles.resets}>Resets {nsToDate(BigInt(spend.resets_at) * 1_000_000_000n).toLocaleDateString("en-GB", { weekday: "short" })} at {formatTime(BigInt(spend.resets_at) * 1_000_000_000n)}</span>
            <div className={styles.mandate}>
              <span>{mandateLine}</span>
              <Link href="/app/mandate" className={styles.link}>Edit mandate</Link>
            </div>
          </section>
        )}
      </div>

      <div className={`${styles.sectionHead} rise`} style={delay(470)}>
        <h2 className={styles.h2}>Activity</h2>
        <Link href="/app/decisions" className={styles.seeAll}>See all</Link>
      </div>
      <ActivityList state={state} proposals={state.proposals.slice(0, 6)} startDelay={520} />
    </Screen>
  );
}
