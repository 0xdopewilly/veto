"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import { lookalike } from "@veto/core/signals";
import type { Proposal } from "@veto/core/proposal";
import { useVault, metaOf, needsDecision, type VaultState } from "@/lib/vault";
import { useWallet } from "@/lib/wallet";
import { useKeptBlocked } from "@/lib/dismissed";
import { useIsDesktop } from "@/lib/media";
import { VAULT_NAME } from "@/lib/config";
import { formatParts, formatShort, formatTime, nsToDate, possessive } from "@/lib/format";
import { SPRING_UI, useCalm } from "@/lib/motion";
import { Screen, delay } from "@/components/Screen";
import { Boot } from "@/components/Boot";
import { Icon, type IconName } from "@/components/Icon";
import { Odometer } from "@/components/Odometer";
import { LineReveal } from "@/components/LineReveal";
import { Segmented } from "@/components/Segmented";
import { SpendRing } from "@/components/SpendRing";
import { Orb } from "@/components/Orb";
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
  const { accountId, connect } = useWallet();
  const { kept } = useKeptBlocked();
  const { openFreeze, openInbox } = useShell();
  const o = useOverview(state, kept);
  const [filter, setFilter] = useState<Filter>("all");
  const lead = o.attention[0];
  const band = lead ? (lead.status === "OverridePending" ? "purple" : "coral") : "green";
  const frozen = state.config.frozen;
  const shown = filterProposals(state.proposals, filter).slice(0, 6);
  const tabs = <Segmented label="Filter activity" options={filterOptions(state.proposals)} value={filter} onChange={setFilter} tone={lead ? "dark" : "onGreen"} />;

  const actions: { label: string; icon: IconName; onClick: () => void }[] = [
    { label: "Try it", icon: "sparkle", onClick: openInbox },
    { label: frozen ? "Unfreeze" : "Freeze", icon: frozen ? "unlock" : "lock", onClick: openFreeze },
    { label: "Mandate", icon: "file", onClick: () => router.push("/app/mandate") },
    { label: "Payees", icon: "users", onClick: () => router.push("/app/payees") },
  ];

  return (
    <Screen flush>
      <div className={styles.phone} data-band={band}>
        <header className={styles.head}>
          <div className={`${styles.topRow} rise`}>
            <div className={styles.titleBlock}>
              <span className={styles.eyebrow}>Veto vault</span>
              <h1 className={styles.vaultName}>{VAULT_NAME}</h1>
            </div>
            <div className={styles.circles}>
              <button
                className={`${styles.circle} press`}
                aria-label={o.attention.length ? `${o.attention.length} payment${o.attention.length === 1 ? "" : "s"} need your decision` : "No new notifications"}
                onClick={() => lead && router.push(`/app/decisions/${lead.id}`)}
              >
                <Icon name="bell" size={19} stroke={1.8} />
                {o.attention.length > 0 && <span className={styles.alertDot} aria-hidden="true" />}
              </button>
              <button className={`${styles.circle} press`} onClick={connect} aria-label={accountId ? `Signed in as ${accountId}` : "Connect wallet"}>
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
                <Link href="/app/mandate" className={styles.link}>
                  Edit mandate
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
  const { kept } = useKeptBlocked();
  const o = useOverview(state, kept);
  const [filter, setFilter] = useState<Filter>("all");
  const latest = state.proposals.find((p) => p.verdict);
  const step = (i: number) => delay(80 + i * 70);

  return (
    <Screen wide>
      <div className={styles.titleRow}>
        <LineReveal as="h1" className={styles.pageTitle} text={VAULT_NAME} />
        <div className={`${styles.titleTools} rise`} style={delay(60)}>
          <span className={styles.periodPill}>
            <Icon name="calendar" size={16} />
            {o.period === "this week" ? "This week" : o.period === "today" ? "Today" : "This period"}
            {o.resets && <span className={styles.periodSub}>· resets {o.resets}</span>}
          </span>
          <Link href="/app/decisions" className={`${styles.circleBtn} press`} aria-label="Filter decisions">
            <Icon name="sliders" size={18} />
          </Link>
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

        <AiPanel state={state} alarm={o.attention.length > 0} pulse={latest ? `${latest.id}${latest.status}` : "none"} latestId={latest?.id} style={step(1)} />

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
              <Link href="/app/decisions" className={`${styles.circleBtn} press`} aria-label="All decisions">
                <Icon name="sliders" size={17} />
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

type Check = { tone: "pass" | "veto" | "pending"; text: string } | null;

/** The enclave panel: orb, the two ways in (proof, bench), and a quick address check. */
function AiPanel({ state, alarm, pulse, latestId, style }: { state: VaultState; alarm: boolean; pulse: string; latestId?: string; style: React.CSSProperties }) {
  const calm = useCalm();
  const [text, setText] = useState("");
  const [check, setCheck] = useState<Check>(null);
  const [checks, setChecks] = useState(0);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const value = text.trim().toLowerCase();
    if (!value) return;
    setChecks((n) => n + 1);
    const saved = state.payees.find((p) => p.address.trim().toLowerCase() === value);
    if (saved) {
      setCheck({ tone: "pass", text: `${saved.name} is on your payee list. The cap would check the amount; the AI would screen the rest.` });
      return;
    }
    for (const payee of state.payees) {
      const why = lookalike(value, payee.address.trim().toLowerCase());
      if (why) {
        setCheck({ tone: "veto", text: `This looks like ${possessive(payee.name)} saved address (${why}). Veto would stop a payment to it.` });
        return;
      }
    }
    setCheck({ tone: "pending", text: "Not on your payee list and never paid. The AI screen would see a new payee and look closely." });
  };

  return (
    <section className={`${styles.panel} ${styles.ai} rise`} style={style} aria-labelledby="ai-title">
      <div className={styles.aiTop}>
        <span className={styles.aiChip}>
          <span className={styles.aiDot} data-alarm={alarm || undefined} aria-hidden="true" />
          {alarm ? "Waiting on you" : "All clear"}
        </span>
        <h2 id="ai-title" className={styles.aiTitle}>Private screen</h2>
        <Link href="/bench" className={`${styles.aiCorner} press`} aria-label="Open Veto Bench">
          <Icon name="arrowRight" size={16} />
        </Link>
      </div>
      <div className={styles.orbWrap}>
        <Orb alarm={alarm} pulse={`${pulse}-${checks}`} size={156} />
      </div>
      <p className={styles.aiLine}>How Veto screens a payment: the cap checks the rules, then a private model reads the context and can only say no.</p>
      <div className={styles.aiTiles}>
        <Link href={latestId ? `/app/decisions/${latestId}/proof` : "/app/decisions"} className={`${styles.aiTile} press`}>
          <Icon name="key" size={18} />
          <span>Latest proof</span>
        </Link>
        <Link href="/bench" className={`${styles.aiTile} press`}>
          <Icon name="chart" size={18} />
          <span>Veto Bench</span>
        </Link>
      </div>
      <form className={styles.ask} onSubmit={submit}>
        <label htmlFor="ai-check" className="visually-hidden">
          Paste an address to check against your payees
        </label>
        <input
          id="ai-check"
          className={styles.askInput}
          placeholder="Paste an address to check…"
          value={text}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => {
            setText(e.target.value);
            setCheck(null);
          }}
        />
        <button type="submit" className={`${styles.askSend} press`} aria-label="Check address" disabled={!text.trim()}>
          <Icon name="send" size={17} />
        </button>
      </form>
      <AnimatePresence initial={false}>
        {check && (
          <motion.p
            key={check.text}
            role="status"
            className={`${styles.checkOut} ${styles[`check_${check.tone}`]}`}
            initial={calm ? { opacity: 0 } : { opacity: 0, y: -6, height: 0 }}
            animate={{ opacity: 1, y: 0, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={SPRING_UI}
          >
            {check.text}
          </motion.p>
        )}
      </AnimatePresence>
    </section>
  );
}
