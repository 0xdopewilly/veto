"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { Proposal } from "@veto/core/proposal";
import { useVault, metaOf, needsDecision, type VaultState } from "@/lib/vault";
import { useVaultKind, useWallet } from "@/lib/wallet";
import { useKeptBlocked } from "@/lib/dismissed";
import { useIsDesktop } from "@/lib/media";
import { formatParts, formatShort, formatTime, nsToDate } from "@/lib/format";
import { outcomeOf, tally } from "@/lib/decision";
import { SPRING_UI } from "@/lib/motion";
import { Screen, delay } from "@/components/Screen";
import { Boot } from "@/components/Boot";
import { Icon, type IconName } from "@/components/Icon";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Odometer } from "@/components/Odometer";
import { LineReveal } from "@/components/LineReveal";
import { Segmented } from "@/components/Segmented";
import { SpendRing } from "@/components/SpendRing";
import { AgentInbox } from "@/components/AgentInbox";
import { useStartHint } from "@/lib/hint";
import { CORAL, DecisionCard, PURPLE, useDecisionCopy, useOpenDecision, usePrefetchDecision } from "@/components/DecisionCard";
import { ActivityList, filterOptions, filterProposals, type Filter } from "@/components/ActivityList";
import { useShell } from "@/components/Shell";
import styles from "./HomeView.module.css";

const periodName = (secs: string) => (secs === "604800" ? "this week" : secs === "86400" ? "today" : "this period");
const periodTitle = (secs: string) => (secs === "604800" ? "Weekly limit" : secs === "86400" ? "Daily limit" : "Spending limit");
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;

/** Everything both layouts show, worked out once. */
function useOverview(state: VaultState, kept: Set<string>) {
  const meta = metaOf(state, state.primaryAsset);
  const balance = formatParts(state.balances[state.primaryAsset] ?? 0n, meta);
  const others = Object.entries(state.balances).filter(([asset, raw]) => asset !== state.primaryAsset && raw > 0n);
  const spend = state.spend[state.primaryAsset];
  const policy = state.policies.find(([asset]) => asset === state.primaryAsset)?.[1];
  const periodStartNs = spend ? (BigInt(spend.resets_at) - BigInt(state.config.period_secs)) * 1_000_000_000n : 0n;
  const inPeriod = state.proposals.filter((p) => BigInt(p.created_at) >= periodStartNs);
  const sum = (list: Proposal[]) => list.filter((p) => p.request.asset === state.primaryAsset).reduce((a, p) => a + BigInt(p.request.amount), 0n);
  const paidNow = inPeriod.filter((p) => outcomeOf(p.status) === "paid");
  const vetoedNow = inPeriod.filter((p) => outcomeOf(p.status) === "vetoed");
  const resetsAt = spend ? BigInt(spend.resets_at) * 1_000_000_000n : 0n;
  return {
    meta,
    balance,
    alsoHolds: others.map(([asset, raw]) => formatShort(raw, metaOf(state, asset))).join(" · "),
    spend,
    perPayment: policy ? formatShort(policy.max_single, meta) : null,
    period: periodName(state.config.period_secs),
    periodTitle: periodTitle(state.config.period_secs),
    resets: spend ? `${nsToDate(resetsAt).toLocaleDateString("en-GB", { weekday: "short" })} at ${formatTime(resetsAt)}` : "",
    attention: needsDecision(state.proposals, kept),
    week: { paid: paidNow.length, vetoed: vetoedNow.length, vetoedSum: sum(vetoedNow) },
    // All-time figures cover the whole history (the server counts it); the newest 100 otherwise.
    totals: state.totals ?? tally(state.proposals, state.primaryAsset),
    mandateLine: state.config.mandate.split(/(?<=\.)\s/)[0],
  };
}

type Overview = ReturnType<typeof useOverview>;

export function HomeView() {
  const { state, error } = useVault();
  const isDesktop = useIsDesktop();
  if (!state) return <Boot loading caption={error ? "Reconnecting to the vault" : "Opening your vault"} />;
  return <Boot>{isDesktop ? <DesktopHome state={state} /> : <PhoneHome state={state} />}</Boot>;
}

/* ------------------------------------------------------------------ phone */

function PhoneHome({ state }: { state: VaultState }) {
  const router = useRouter();
  const { accountId } = useWallet();
  const { kept } = useKeptBlocked();
  const { openFreeze, openInbox, openVaults, openNotes, openWallet } = useShell();
  const { vaultName } = useVault();
  const kind = useVaultKind();
  const o = useOverview(state, kept);
  const [filter, setFilter] = useState<Filter>("all");
  const lead = o.attention[0];
  const band = lead ? (lead.status === "OverridePending" ? "purple" : "coral") : "green";
  const frozen = state.config.frozen;
  const shown = filterProposals(state.proposals, filter).slice(0, 6);

  const latest = state.proposals.find((p) => p.verdict);
  const actions: { label: string; icon: IconName; onClick: () => void }[] = [
    { label: "Try it", icon: "sparkle", onClick: openInbox },
    { label: frozen ? "Unfreeze" : "Freeze", icon: frozen ? "unlock" : "lock", onClick: openFreeze },
    { label: "Proof", icon: "key", onClick: () => router.push(latest ? `/app/decisions/${latest.id}/proof` : "/app/decisions") },
    { label: "How it works", icon: "file", onClick: () => router.push("/docs") },
  ];

  return (
    <Screen flush>
      <div className={styles.phone} data-band={band}>
        <header className={styles.head}>
          <div className={`${styles.topRow} rise`}>
            <div className={styles.titleBlock}>
              <button type="button" className={`${styles.vaultSwitch} press`} onClick={openVaults} aria-label={`${vaultName}. Switch vault`}>
                <span className={styles.eyebrow}>{kind.label}</span>
                <span className={styles.vaultNameRow}>
                  <h1 className={styles.vaultName}>{vaultName}</h1>
                  <Icon name="chevronDown" size={17} stroke={2} className={styles.vaultChevron} />
                </span>
              </button>
            </div>
            <div className={styles.circles}>
              <ThemeToggle className={styles.circle} size={19} />
              <button
                className={`${styles.circle} press`}
                aria-label={o.attention.length ? `Notifications: ${o.attention.length} payment${o.attention.length === 1 ? "" : "s"} need your decision` : "Notifications"}
                onClick={openNotes}
              >
                <Icon name="bell" size={19} stroke={1.8} />
                {o.attention.length > 0 && <span className={styles.alertDot} aria-hidden="true" />}
              </button>
              <button className={`${styles.circle} press`} onClick={openWallet} aria-label={accountId ? `Wallet: ${accountId}` : "Connect wallet"}>
                <Icon name="wallet" size={19} stroke={1.75} />
                {accountId && <span className={styles.liveDot} aria-hidden="true" />}
              </button>
            </div>
          </div>

          <section className={`${styles.balance} rise`} style={delay(80)} aria-label="Vault balance">
            <span className={styles.label}>Vault balance</span>
            <span className={styles.big}>
              {o.balance.prefix && <span className={styles.currency}>{o.balance.prefix}</span>}
              <Odometer value={o.balance.whole} delay={180} />
              <span className={styles.cents}>{o.balance.cents}</span>
              {o.balance.suffix && <span className={styles.unit}>{o.balance.suffix}</span>}
            </span>
            {o.alsoHolds && <span className={styles.others}>Also holds {o.alsoHolds}</span>}
          </section>

          <div className={styles.actions}>
            {actions.map((a, i) => (
              <button key={a.label} className={`${styles.action} rise`} style={delay(150 + i * 50)} onClick={a.onClick}>
                <span className={`${styles.actionCircle} ${a.label === "Try it" ? styles.actionHot : ""}`}>
                  <Icon name={a.icon} size={21} stroke={1.8} />
                </span>
                <span className={styles.actionLabel}>{a.label}</span>
              </button>
            ))}
          </div>

          <button className={`${styles.statusPill} press`} onClick={openFreeze} aria-label={frozen ? "Payments frozen. Open freeze controls" : "Screening every payment. Open freeze controls"}>
            <span className={styles.statusDot} data-frozen={frozen || undefined} aria-hidden="true" />
            {frozen ? "Payments frozen" : "Screening every payment"}
          </button>
        </header>

        <div className={styles.band}>
          <AnimatePresence mode="popLayout" initial={false}>
            {lead ? (
              <BandDecision key={`d${lead.id}`} state={state} proposal={lead} more={o.attention.length - 1} />
            ) : (
              <motion.p key="calm" className={styles.bandCalm} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={SPRING_UI}>
                Nothing needs your decision.
              </motion.p>
            )}
          </AnimatePresence>
        </div>

        <section className={styles.sheet} aria-label="Activity">
          <div className={styles.sheetHead}>
            <h2 className={styles.h2}>Activity</h2>
            <Link href="/app/decisions" className={styles.seeAll}>
              See all
            </Link>
          </div>
          <div className={styles.sheetTabs}>
            <Segmented label="Filter activity" options={filterOptions(state.proposals, o.totals)} value={filter} onChange={setFilter} tone="dark" />
          </div>
          <ActivityList state={state} proposals={shown} startDelay={300} empty={filter === "all" ? undefined : `No ${filter} payments right now.`} />

          {o.spend && (
            <section className={`${styles.spendCard} rise`} style={delay(420)} aria-label={o.periodTitle}>
              <div className={styles.spendHead}>
                <h2 className={styles.h3}>{o.periodTitle}</h2>
                <span className={styles.chip}>Resets {o.resets}</span>
              </div>
              <LimitBody o={o} size={176} week />
              <div className={styles.mandate}>
                <span>{o.mandateLine}</span>
                <Link href="/app/rules#mandate" className={styles.link}>
                  Edit rules
                </Link>
              </div>
            </section>
          )}
        </section>
      </div>
    </Screen>
  );
}

/** On phones the band itself becomes the "Needs your decision" card. */
function BandDecision({ state, proposal, more }: { state: VaultState; proposal: Proposal; more: number }) {
  const copy = useDecisionCopy(state, proposal);
  const open = useOpenDecision();
  usePrefetchDecision(proposal.id);
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={SPRING_UI}>
      <Link href={`/app/decisions/${proposal.id}`} onClick={(e) => open(e, proposal.id, copy.pending ? PURPLE : CORAL)} className={`${styles.bandCard} press`}>
        <span className={styles.bandText}>
          <span className={styles.bandEyebrow}>
            {copy.eyebrow}
            {more > 0 && <span className={styles.more}>+{more} more</span>}
          </span>
          <span className={styles.bandHeadline}>{copy.headline}</span>
          <span className={styles.bandDetail}>{copy.detail}</span>
        </span>
        <span className={styles.bandGo} aria-hidden="true">
          <Icon name="arrowRight" size={20} stroke={2.25} />
        </span>
      </Link>
    </motion.div>
  );
}

/** The limit as a ring to scale, with what's spent, what's left and the per-payment cap beside it. */
function LimitBody({ o, size, week = false }: { o: Overview; size: number; week?: boolean }) {
  if (!o.spend) return null;
  const facts = [
    { label: "Spent", value: formatShort(o.spend.spent, o.meta) },
    { label: "Left", value: formatShort(o.spend.remaining, o.meta) },
    ...(o.perPayment ? [{ label: "Per payment", value: `up to ${o.perPayment}` }] : []),
  ];
  return (
    <div className={styles.limitBody}>
      <SpendRing size={size} value={Number(BigInt(o.spend.spent))} max={Number(BigInt(o.spend.period_limit))} center={formatShort(o.spend.spent, o.meta)} caption={`of ${formatShort(o.spend.period_limit, o.meta)}`} />
      <dl className={styles.facts}>
        {facts.map((f) => (
          <div key={f.label}>
            <dt>{f.label}</dt>
            <dd>{f.value}</dd>
          </div>
        ))}
        {week && (
        <div>
          <dt>{capital(o.period)}</dt>
          <dd>
            {plural(o.week.paid, "paid", "paid")} · {plural(o.week.vetoed, "vetoed", "vetoed")}
          </dd>
        </div>
        )}
      </dl>
    </div>
  );
}

/* ---------------------------------------------------------------- desktop */

function DesktopHome({ state }: { state: VaultState }) {
  const hint = useStartHint();
  const { vaultName } = useVault();
  const { kept } = useKeptBlocked();
  const o = useOverview(state, kept);
  const [filter, setFilter] = useState<Filter>("all");
  const step = (i: number) => delay(80 + i * 70);
  const t = o.totals;
  const rows = [
    { label: "Paid", tally: t.paid, tone: styles.barGreen },
    { label: "Vetoed", tally: t.vetoed, tone: styles.barCoral },
    { label: "Pending", tally: t.pending, tone: styles.barPurple },
  ];

  return (
    <Screen wide>
      <div className={styles.titleRow}>
        <LineReveal key={vaultName} as="h1" className={styles.pageTitle} text={vaultName} />
      </div>

      {o.attention.length > 0 && (
        <div className={styles.banner}>
          {o.attention.slice(0, 2).map((p, i) => (
            <DecisionCard key={p.id} state={state} proposal={p} style={delay(60 + i * 70)} />
          ))}
        </div>
      )}

      <div className={styles.dash}>
        <div className={styles.main}>
          <section className={`${styles.panel} ${styles.hero} rise`} style={step(0)} aria-labelledby="hero-title">
            <div className={styles.panelHead}>
              <h2 id="hero-title" className={styles.panelTitle}>
                {capital(o.period)}
              </h2>
              {o.resets && <span className={styles.chip}>Resets {o.resets}</span>}
            </div>
            <div className={styles.figures}>
              <div className={styles.figure}>
                <span className={styles.figLabel}>Balance</span>
                <span className={styles.figValue}>
                  {o.balance.prefix && <span className={styles.figUnit}>{o.balance.prefix}</span>}
                  <Odometer value={o.balance.whole} delay={260} />
                  <span className={styles.figUnit}>{o.balance.cents}</span>
                  {o.balance.suffix && <span className={styles.figUnit}>&nbsp;{o.balance.suffix}</span>}
                </span>
                <span className={styles.figNote}>{o.alsoHolds ? `Also holds ${o.alsoHolds}` : "In the vault"}</span>
              </div>
              <div className={styles.figure}>
                <span className={styles.figLabel}>Paid {o.period}</span>
                <span className={styles.figValue}>{o.spend ? <Odometer value={formatShort(o.spend.spent, o.meta)} delay={320} /> : o.week.paid}</span>
                <span className={styles.figNote}>{plural(o.week.paid, "payment")}</span>
              </div>
              <div className={styles.figure}>
                <span className={styles.figLabel}>Vetoed {o.period}</span>
                <span className={`${styles.figValue} ${o.week.vetoed ? styles.figAlarm : ""}`}>
                  <Odometer value={String(o.week.vetoed)} delay={380} />
                </span>
                <span className={styles.figNote}>{o.week.vetoed ? `${formatShort(o.week.vetoedSum, o.meta)} never left the vault` : "Nothing vetoed"}</span>
              </div>
            </div>
          </section>

          <section className={`${styles.panel} ${styles.activity} rise`} style={step(1)} aria-labelledby="activity-title">
            <div className={styles.panelHead}>
              <h2 id="activity-title" className={styles.panelTitle}>
                Activity
              </h2>
              <div className={styles.activityTools}>
                <Segmented label="Filter activity" options={filterOptions(state.proposals, t)} value={filter} onChange={setFilter} />
                <Link href="/app/decisions" className={styles.seeAll}>
                  See all
                </Link>
              </div>
            </div>
            <ActivityList state={state} proposals={filterProposals(state.proposals, filter).slice(0, 7)} startDelay={420} empty={filter === "all" ? undefined : `No ${filter} payments right now.`} />
          </section>

          <div className={styles.bottom}>
            <section className={`${styles.panel} rise`} style={step(2)} aria-labelledby="limit-title">
              <div className={styles.panelHead}>
                <h2 id="limit-title" className={styles.panelTitle}>
                  {o.periodTitle}
                </h2>
                <Link href="/app/rules" className={styles.seeAll}>
                  Rules
                </Link>
              </div>
              {o.spend ? <LimitBody o={o} size={124} /> : <p className={styles.footnote}>No limit set.</p>}
              <p className={styles.footnote}>Vetoed payments never count against the limit.</p>
            </section>

            <section className={`${styles.panel} rise`} style={step(3)} aria-labelledby="totals-title">
              <div className={styles.panelHead}>
                <h2 id="totals-title" className={styles.panelTitle}>
                  All time
                </h2>
                <span className={styles.chip}>{plural(t.count, "payment")}</span>
              </div>
              <ul className={styles.totals}>
                {rows.map((r) => (
                  <li key={r.label}>
                    <span className={styles.totalLabel}>{r.label}</span>
                    <span className={styles.totalN}>{r.tally.n.toLocaleString("en-US")}</span>
                    <span className={styles.totalSum}>{BigInt(r.tally.sum) > 0n ? formatShort(r.tally.sum, o.meta) : ""}</span>
                    <span className={styles.track} aria-hidden="true">
                      <span className={`${styles.bar} ${r.tone}`} style={{ width: `${t.count ? (r.tally.n / t.count) * 100 : 0}%` }} />
                    </span>
                  </li>
                ))}
              </ul>
              <p className={styles.footnote}>Dollar totals add up {o.meta.symbol} payments.</p>
            </section>
          </div>
        </div>

        <section className={`${styles.panel} ${styles.inbox} rise`} style={step(1)} aria-label="Agent inbox" data-hint={hint.show || undefined}>
          {hint.show && <span className={styles.hintChip}>Start here</span>}
          <AgentInbox titleId="home-inbox-title" compact />
        </section>
      </div>
    </Screen>
  );
}
