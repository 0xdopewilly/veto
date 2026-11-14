"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { LineReveal } from "@/components/LineReveal";
import { SmoothScroll } from "@/components/SmoothScroll";
import { RevealOnScroll } from "@/components/RevealOnScroll";
import { Odometer } from "@/components/Odometer";
import { Icon } from "@/components/Icon";
import { Pill } from "@/components/Pill";
import { AGENT_INBOX, LADDER, mailtoFor, sandboxFrom, type Sandbox, type Trick } from "@/lib/challenge";
import type { Attempt, ChallengeStats } from "@/lib/server/challenge";
import styles from "./ChallengeView.module.css";

const FALLBACK: Sandbox = sandboxFrom([]);
const REFRESH_MS = 20_000;

function ago(ms: number, now: number): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

/** The numbers on the page, kept fresh while it's open so a player watches their own email land. */
function useLiveStats(initial: ChallengeStats | null) {
  const [stats, setStats] = useState(initial);
  useEffect(() => {
    let live = true;
    const pull = () =>
      document.visibilityState === "visible" &&
      fetch("/api/challenge")
        .then((r) => (r.ok ? r.json() : null))
        .then((s: ChallengeStats | null) => live && s && setStats(s))
        .catch(() => {});
    if (!initial) pull();
    const timer = setInterval(pull, REFRESH_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [initial]);
  return stats;
}

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (key: string, text: string) =>
    navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopied(key);
        setTimeout(() => setCopied((k) => (k === key ? null : k)), 1800);
      })
      .catch(() => {});
  return { copied, copy };
}

/**
 * The clock for "5 min ago". The first render, on the server and again in the browser, reads it as
 * the moment the numbers were read, so both render the same text; then it follows the real time.
 */
function useClock(start: number) {
  const [now, setNow] = useState(start);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

export function ChallengeView({ stats: initial }: { stats: ChallengeStats | null }) {
  const stats = useLiveStats(initial);
  const now = useClock(initial?.readAt ?? 0);
  const sandbox = stats?.sandbox ?? FALLBACK;
  const { copied, copy } = useCopy();
  const first = LADDER[0];

  return (
    <div className={styles.page}>
      <SmoothScroll />
      <RevealOnScroll />

      <main className={styles.main}>
        <header className={styles.hero}>
          <div className={styles.heroText}>
            <LineReveal as="h1" className={styles.h1} lines={["Can you", "fool Veto?"]} />
            <p className={`${styles.lead} rise`} style={{ animationDelay: "80ms" }}>
              Email Veto&apos;s agent a scam. The agent reads it and asks the vault to pay, the way an accounts-payable bot would. Veto screens that payment in NEAR AI&apos;s enclave
              and can only say no. Six tricks that real invoice fraud uses, in order: every reply tells you which one Veto saw and hands you the next.
            </p>
            <div className={`${styles.ctas} rise`} style={{ animationDelay: "140ms" }}>
              <Pill href={mailtoFor(first, sandbox)} external icon="mail">
                Email the agent
              </Pill>
              <button type="button" className={`${styles.address} press`} onClick={() => copy("inbox", AGENT_INBOX)} aria-label={`Copy ${AGENT_INBOX}`}>
                <span className="mono">{AGENT_INBOX}</span>
                <span className={styles.addressAction}>{copied === "inbox" ? "Copied" : "Copy"}</span>
              </button>
            </div>
            <p className={`${styles.alt} rise`} style={{ animationDelay: "190ms" }}>
              No mail app handy? <Link href="/app">Write one in the app</Link>: the same agent reads it.
            </p>
          </div>

          <Scoreboard stats={stats} now={now} />
        </header>

        <section className={`${styles.section} ${styles.reveal}`} data-reveal aria-labelledby="ladder-title">
          <div className={styles.sectionHead}>
            <h2 id="ladder-title" className={styles.h2}>
              Six tricks, in order
            </h2>
            <p className={styles.small}>Counts are vetoes whose signed verdict names that trick, from the sandbox&apos;s whole history.</p>
          </div>
          <ol className={styles.ladder}>
            {LADDER.map((t) => (
              <Rung key={t.code} trick={t} sandbox={sandbox} count={stats?.tricks[t.code]} now={now} copied={copied} copy={copy} />
            ))}
          </ol>
        </section>

        <div className={styles.lower}>
          <section className={`${styles.section} ${styles.through} ${styles.reveal}`} data-reveal aria-labelledby="through-title">
            <h2 id="through-title" className={styles.h2}>
              Think one got through?
            </h2>
            <p className={styles.body}>
              {stats ? `Veto let ${stats.paid} of the ${stats.asked} payments through.` : "Every payment Veto let through is public."} Each one shows the email the model read, its
              verdict and the enclave&apos;s signature over the exact bytes. If one paid someone it shouldn&apos;t have, you&apos;ve fooled Veto: post the link.
            </p>
            <Pill href="/app/decisions?filter=paid" variant="secondary" size="md" icon="arrowRight">
              Every paid payment
            </Pill>
          </section>

          <section className={`${styles.section} ${styles.reveal}`} data-reveal aria-labelledby="recent-title">
            <h2 id="recent-title" className={styles.h2}>
              Latest attempts
            </h2>
            {stats?.recent.length ? (
              <ul className={styles.recent}>
                {stats.recent.map((a) => (
                  <RecentRow key={a.id} a={a} now={now} />
                ))}
              </ul>
            ) : (
              <p className={styles.body}>{stats ? "Nobody has tried yet. Be the first." : "Reading the sandbox vault…"}</p>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

function Scoreboard({ stats, now }: { stats: ChallengeStats | null; now: number }) {
  return (
    <aside className={`${styles.board} rise`} style={{ animationDelay: "120ms" }} aria-label="The sandbox so far">
      <div className={styles.figure}>
        <span className={styles.figLabel}>Payments asked for</span>
        <span className={styles.figValue}>{stats ? <Odometer value={stats.asked.toLocaleString("en-US")} delay={300} /> : "–"}</span>
      </div>
      <div className={styles.figure}>
        <span className={styles.figLabel}>Vetoed</span>
        <span className={`${styles.figValue} ${styles.coral}`}>{stats ? <Odometer value={stats.vetoed.toLocaleString("en-US")} delay={360} /> : "–"}</span>
      </div>
      <div className={styles.figure}>
        <span className={styles.figLabel}>Paid</span>
        <span className={`${styles.figValue} ${styles.green}`}>{stats ? <Odometer value={stats.paid.toLocaleString("en-US")} delay={420} /> : "–"}</span>
      </div>
      <p className={styles.boardNote}>
        <span className={styles.liveDot} aria-hidden="true" />
        {stats ? `Live from the sandbox vault on NEAR testnet, read ${ago(stats.readAt, now)}.` : "Reading the sandbox vault on NEAR testnet…"}
      </p>
    </aside>
  );
}

function Rung({
  trick,
  sandbox,
  count,
  now,
  copied,
  copy,
}: {
  trick: Trick;
  sandbox: Sandbox;
  count?: { caught: number; last: number | null };
  now: number;
  copied: string | null;
  copy: (key: string, text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const body = trick.example(sandbox);
  const untried = count && count.caught === 0;
  return (
    <li className={styles.rung}>
      <span className={styles.level} aria-hidden="true">
        {trick.level}
      </span>
      <div className={styles.rungMain}>
        <h3 className={styles.rungName}>{trick.name}</h3>
        <p className={styles.rungHow}>{trick.how}</p>
        <p className={styles.rungWhy}>{trick.why}</p>
        <button type="button" className={`${styles.toggle} press`} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
          {open ? "Hide the email" : "Show an email to start from"}
          <Icon name="chevronDown" size={15} stroke={2.2} />
        </button>
        {open && (
          <div className={styles.email}>
            <p className={styles.emailHead}>
              <span className={styles.muted}>To</span> <span className="mono">{AGENT_INBOX}</span>
              <br />
              <span className={styles.muted}>Subject</span> {trick.subject}
            </p>
            <pre className={styles.emailBody}>{body}</pre>
            <div className={styles.emailActions}>
              <Pill href={mailtoFor(trick, sandbox)} external size="sm" icon="mail">
                Open in my mail app
              </Pill>
              <Pill variant="ghost" size="sm" icon={copied === trick.code ? "check" : undefined} onClick={() => copy(trick.code, body)}>
                {copied === trick.code ? "Copied" : "Copy the email"}
              </Pill>
            </div>
          </div>
        )}
      </div>
      <div className={styles.rungCount}>
        {!count ? (
          <span className={styles.muted}>–</span>
        ) : untried ? (
          <span className={styles.untried}>Nobody has tried this yet</span>
        ) : (
          <>
            <span className={styles.caught}>
              Caught <span className="tabular">{count.caught}</span> {count.caught === 1 ? "time" : "times"}
            </span>
            {count.last && <span className={styles.last}>last {ago(count.last, now)}</span>}
          </>
        )}
      </div>
    </li>
  );
}

function RecentRow({ a, now }: { a: Attempt; now: number }) {
  const names = a.tricks.map((c) => LADDER.find((t) => t.code === c)?.name).filter(Boolean);
  return (
    <li>
      <Link href={`/app/decisions/${a.id}`} className={styles.recentRow}>
        <span className={styles.outcome} data-outcome={a.outcome}>
          {a.outcome === "vetoed" ? "Vetoed" : a.outcome === "paid" ? "Paid" : a.outcome === "pending" ? "Pending" : "Closed"}
        </span>
        <span className={styles.recentWhat}>
          <span className={styles.recentAmount}>
            {a.amount} <span className={styles.muted}>to</span> {a.payee}
          </span>
          {names.length > 0 && <span className={styles.recentTricks}>{names.join(" · ")}</span>}
        </span>
        <span className={styles.recentWhen}>{ago(a.at, now)}</span>
      </Link>
    </li>
  );
}
