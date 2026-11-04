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
import { SPRING_UI } from "@/lib/motion";
import { Screen, delay } from "@/components/Screen";
import { Boot } from "@/components/Boot";
import { Icon, type IconName } from "@/components/Icon";
import { Odometer } from "@/components/Odometer";
import { LineReveal } from "@/components/LineReveal";
import { Segmented } from "@/components/Segmented";
import { SpendRing } from "@/components/SpendRing";
import { DecisionBars } from "@/components/DecisionBars";
import { AgentInbox } from "@/components/AgentInbox";
import { useStartHint } from "@/lib/hint";
import { CORAL, DecisionCard, PURPLE, useDecisionCopy, useOpenDecision, usePrefetchDecision } from "@/components/DecisionCard";
import { ActivityList, filterOptions, filterProposals, type Filter } from "@/components/ActivityList";
import { useShell } from "@/components/Shell";
import styles from "./HomeView.module.css";

const periodName = (secs: string) => (secs === "604800" ? "this week" : secs === "86400" ? "today" : "this period");
const periodTitle = (secs: string) => (secs === "604800" ? "Weekly limit" : secs === "86400" ? "Daily limit" : "Spending limit");

/** Everything both layouts show, worked out once. */
function useOverview(state: VaultState, kept: Set<string>) {
  const meta = metaOf(state, state.primaryAsset);
  const balance = formatParts(state.balances[state.primaryAsset] ?? 0n, meta);
  const others = Object.entries(state.balances).filter(([asset, raw]) => asset !== state.primaryAsset && raw > 0n);
  const spend = state.spend[state.primaryAsset];
  const periodStartNs = spend ? (BigInt(spend.resets_at) - BigInt(state.config.period_secs)) * 1_000_000_000n : 0n;
  const inPeriod = state.proposals.filter((p) => BigInt(p.created_at) >= periodStartNs);
  const sum = (list: Proposal[]) =>
    list.filter((p) => p.request.asset === state.primaryAsset).reduce((a, p) => a + BigInt(p.request.amount), 0n);
  const paid = state.proposals.filter((p) => p.status === "Paid");
  const vetoed = state.proposals.filter((p) => p.status === "Vetoed");
  const pending = filterProposals(state.proposals, "pending");
  const stoppedInPeriod = inPeriod.filter((p) => p.status === "Vetoed");
  const resetsAt = spend ? BigInt(spend.resets_at) * 1_000_000_000n : 0n;
  return {
    meta,
    balance,
    others,
    spend,
    period: periodName(state.config.period_secs),
    periodTitle: periodTitle(state.config.period_secs),
    resets: spend ? `${nsToDate(resetsAt).toLocaleDateString("en-GB", { weekday: "short" })} at ${formatTime(resetsAt)}` : "",
    attention: needsDecision(state.proposals, kept),
    counts: { paid: paid.length, vetoed: vetoed.length, pending: pending.length },
    sums: { paid: sum(paid), vetoed: sum(vetoed), pending: sum(pending), stopped: sum(stoppedInPeriod) },
    stoppedCount: stoppedInPeriod.length,
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
  const tabs = <Segmented label="Filter activity" options={filterOptions(state.proposals)} value={filter} onChange={setFilter} tone={lead ? "dark" : "onGreen"} />;

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
            {o.others.length > 0 && (
              <span className={styles.others}>
                {o.others.map(([asset, raw]) => `+ ${formatShort(raw, metaOf(state, asset))}`).join(" · ")}
              </span>
            )}
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
            {lead ? <BandDecision key={`d${lead.id}`} state={state} proposal={lead} more={o.attention.length - 1} /> : <motion.div key="tabs" className={styles.bandTabs} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={SPRING_UI}>{tabs}</motion.div>}
          </AnimatePresence>
        </div>

        <section className={styles.sheet} aria-label="Activity">
          {lead && <div className={styles.sheetTabs}>{tabs}</div>}
          <div className={styles.sheetHead}>
            <h2 className={styles.h2}>Activity</h2>
            <Link href="/app/decisions" className={styles.seeAll}>
              See all
            </Link>
          </div>
          <ActivityList
            state={state}
            proposals={shown}
            startDelay={300}
            empty={filter === "all" ? undefined : `Nothing ${filter === "pending" ? "pending" : filter} right now.`}
          />

          {o.spend && (
            <section className={`${styles.spendCard} rise`} style={delay(420)} aria-label={`Spent ${o.period}`}>
              <div className={styles.spendHead}>
                <h2 className={styles.h3}>Spent {o.period}</h2>
                <span className={styles.chip}>Resets {o.resets}</span>
              </div>
              <div className={styles.spendBody}>
                <SpendRing
                  size={200}
                  center={formatShort(o.spend.spent, o.meta)}
                  caption={`of ${formatShort(o.spend.period_limit, o.meta)} limit`}
                  parts={[
                    { label: "Paid", value: Number(BigInt(o.spend.spent)), tone: "green", bubble: formatShort(o.spend.spent, o.meta) },
                    { label: "Stopped", value: Number(o.sums.stopped), tone: "coral", bubble: o.sums.stopped > 0n ? formatShort(o.sums.stopped, o.meta) : undefined },
                    { label: "Left", value: Number(BigInt(o.spend.remaining)), tone: "idle" },
                  ]}
                />
                <Legend o={o} />
              </div>
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
            <span className={styles.beat} aria-hidden="true" />
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

function Legend({ o }: { o: Overview }) {
  const rows = [
    { label: "Paid", n: o.counts.paid, tone: styles.lgGreen },
    { label: "Vetoed", n: o.counts.vetoed, tone: styles.lgCoral },
    { label: "Pending", n: o.counts.pending, tone: styles.lgPurple },
  ];
  return (
    <ul className={styles.legend}>
      {rows.map((r) => (
        <li key={r.label}>
          <span className={`${styles.lgDot} ${r.tone}`} aria-hidden="true" />
          <span className={styles.lgN}>{r.n}</span>
          <span className={styles.lgLabel}>{r.label}</span>
        </li>
      ))}
    </ul>
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

  return (
    <Screen wide>
      <div className={styles.titleRow}>
        <LineReveal key={vaultName} as="h1" className={styles.pageTitle} text={vaultName} />
        <div className={`${styles.titleTools} rise`} style={delay(60)}>
          <span className={styles.periodPill}>
            <Icon name="calendar" size={16} />
            {o.period === "this week" ? "This week" : o.period === "today" ? "Today" : "This period"}
            {o.resets && <span className={styles.periodSub}>· resets {o.resets}</span>}
          </span>
        </div>
      </div>

      {o.attention.length > 0 && (
        <div className={styles.banner}>
          {o.attention.slice(0, 2).map((p, i) => (
            <DecisionCard key={p.id} state={state} proposal={p} style={delay(60 + i * 70)} />
          ))}
        </div>
      )}

      <div className={styles.dash}>
        <section className={`${styles.panel} ${styles.hero} rise spot`} style={step(0)} aria-labelledby="hero-title">
          <span className={styles.heroGlow} aria-hidden="true" />
          <div className={styles.panelHead}>
            <div>
              <h2 id="hero-title" className={styles.heroTitle}>Vault {o.period}</h2>
              <p className={styles.heroLead}>Every payment passes the mandate cap on NEAR, then a private AI screen that can only say no.</p>
            </div>
          </div>
          <div className={styles.metrics}>
            <Metric icon="wallet" label="Balance" delay={200}>
              {o.balance.prefix && <span className={styles.mUnit}>{o.balance.prefix}</span>}
              <Odometer value={o.balance.whole} delay={260} />
              <span className={styles.mUnit}>{o.balance.cents}</span>
              {o.balance.suffix && <span className={styles.mUnit}>&nbsp;{o.balance.suffix}</span>}
            </Metric>
            <Metric icon="chart" label={`Spent ${o.period}`} delay={260}>
              {o.spend ? (
                <>
                  <Odometer value={formatShort(o.spend.spent, o.meta)} delay={320} />
                  <span className={styles.mUnit}>&nbsp;of {formatShort(o.spend.period_limit, o.meta)}</span>
                </>
              ) : (
                "—"
              )}
            </Metric>
            <Metric icon="shield" label="Payments stopped" delay={320} alarm={o.counts.vetoed > 0}>
              <Odometer value={String(o.counts.vetoed)} delay={380} />
              <span className={styles.mUnit}>&nbsp;{o.counts.vetoed === 1 ? "payment" : "payments"}</span>
            </Metric>
          </div>
        </section>

        <section className={`${styles.panel} ${styles.limit} rise spot`} style={step(2)} aria-labelledby="limit-title">
          <div className={styles.panelHead}>
            <h2 id="limit-title" className={styles.panelTitle}>
              <span className={styles.panelIcon} aria-hidden="true">
                <Icon name="chart" size={16} />
              </span>
              {o.periodTitle}
            </h2>
            <span className={styles.chip}>{o.spend ? `Resets ${o.resets}` : "No limit set"}</span>
          </div>
          {o.spend && (
            <div className={styles.limitBody}>
              <SpendRing
                size={196}
                center={formatShort(o.spend.spent, o.meta)}
                caption={`of ${formatShort(o.spend.period_limit, o.meta)} used`}
                parts={[
                  { label: "Paid", value: Number(BigInt(o.spend.spent)), tone: "green", bubble: formatShort(o.spend.spent, o.meta) },
                  { label: "Stopped", value: Number(o.sums.stopped), tone: "coral", bubble: o.sums.stopped > 0n ? formatShort(o.sums.stopped, o.meta) : undefined },
                  { label: "Left", value: Number(BigInt(o.spend.remaining)), tone: "idle" },
                ]}
              />
              <Legend o={o} />
            </div>
          )}
          <p className={styles.footnote}>
            <Icon name="shield" size={13} /> Stopped payments never count against the limit.
          </p>
        </section>

        <section className={`${styles.panel} ${styles.decisions} rise spot`} style={step(3)} aria-labelledby="decisions-title">
          <div className={styles.panelHead}>
            <h2 id="decisions-title" className={styles.panelTitle}>
              <span className={`${styles.panelIcon} ${styles.panelIconInk}`} aria-hidden="true">
                <Icon name="activity" size={16} />
              </span>
              Decisions
            </h2>
            <span className={`${styles.chip} ${styles.chipInk}`}>All time</span>
          </div>
          <DecisionBars
            bars={[
              { label: `Paid · ${o.counts.paid}`, value: Number(o.sums.paid), display: formatShort(o.sums.paid, o.meta), style: "hatched" },
              { label: `Vetoed · ${o.counts.vetoed}`, value: Number(o.sums.vetoed), display: formatShort(o.sums.vetoed, o.meta), style: "dark" },
              { label: `Pending · ${o.counts.pending}`, value: Number(o.sums.pending), display: formatShort(o.sums.pending, o.meta), style: "light" },
            ]}
          />
        </section>

        <section className={`${styles.panel} ${styles.activity} rise`} style={step(4)} aria-labelledby="activity-title">
          <div className={styles.panelHead}>
            <h2 id="activity-title" className={styles.panelTitle}>
              <span className={styles.panelIcon} aria-hidden="true">
                <Icon name="activity" size={16} />
              </span>
              Activity
            </h2>
            <div className={styles.activityTools}>
              <Segmented label="Filter activity" options={filterOptions(state.proposals)} value={filter} onChange={setFilter} />
              <Link href="/app/decisions" className={styles.seeAll}>
                See all
              </Link>
            </div>
          </div>
          <ActivityList
            state={state}
            proposals={filterProposals(state.proposals, filter).slice(0, 7)}
            startDelay={420}
            empty={filter === "all" ? undefined : `Nothing ${filter === "pending" ? "pending" : filter} right now.`}
          />
        </section>

        <section className={`${styles.panel} ${styles.inbox} rise`} style={step(5)} aria-label="Agent inbox" data-hint={hint.show || undefined}>
          {hint.show && <span className={styles.hintChip}>Start here</span>}
          <AgentInbox titleId="home-inbox-title" compact />
        </section>
      </div>
    </Screen>
  );
}

function Metric({ icon, label, children, delay: d, alarm = false }: { icon: IconName; label: string; children: React.ReactNode; delay: number; alarm?: boolean }) {
  return (
    <div className={`${styles.metric} ${alarm ? styles.metricAlarm : ""} rise`} style={delay(d)}>
      <span className={styles.metricHead}>
        <span className={styles.metricIcon} aria-hidden="true">
          <Icon name={icon} size={16} />
        </span>
        {label}
      </span>
      <span className={styles.metricValue}>{children}</span>
    </div>
  );
}
