"use client";

import { useEffect, useState } from "react";
import type { Proposal } from "@veto/core/proposal";
import { Pill } from "@/components/Pill";
import { loadAllProposals, needsDecision, useVault } from "@/lib/vault";
import { useKeptBlocked } from "@/lib/dismissed";
import { Screen, delay } from "@/components/Screen";
import { ActivityList, filterOptions, filterProposals, type Filter } from "@/components/ActivityList";
import { Boot } from "@/components/Boot";
import { LineReveal } from "@/components/LineReveal";
import { Segmented } from "@/components/Segmented";
import { downloadCsv, paymentsCsv } from "@/lib/csv";
import styles from "./PageHead.module.css";

const PAGE = 15;
const NEEDS = 5;

/** Activity: what needs your decision first, then every payment, newest first. */
export function DecisionsView() {
  const { state, vaultId } = useVault();
  const { kept } = useKeptBlocked();
  const [filter, setFilter] = useState<Filter>("all");
  // A link can open the list filtered: /app/decisions?filter=paid (the challenge page's "every paid payment").
  useEffect(() => {
    const asked = new URLSearchParams(window.location.search).get("filter");
    if (asked === "paid" || asked === "vetoed" || asked === "pending") setFilter(asked);
  }, []);
  // Newest first, a page at a time: the list stays quick to open however many payments the vault has.
  const [shown, setShown] = useState(PAGE);
  const [allNeeds, setAllNeeds] = useState(false);
  // The live state holds the newest 100 payments. A vault with more loads the rest here, so the list,
  // its filter counts and the CSV cover the whole history.
  const [older, setOlder] = useState<Proposal[]>([]);
  const loaded = state?.proposals ?? [];
  const oldest = loaded.length ? Math.min(...loaded.map((p) => Number(p.id))) : 0;
  useEffect(() => {
    if (!vaultId || oldest === 0) return setOlder([]);
    let live = true;
    loadAllProposals(vaultId)
      .then((all) => live && setOlder(all.filter((p) => Number(p.id) < oldest)))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [vaultId, oldest]);
  if (!state) return <Boot loading caption="Loading activity" />;
  const history = older.length ? [...state.proposals, ...older.filter((p) => Number(p.id) < oldest)] : state.proposals;
  const attention = needsDecision(history, kept);
  const matching = filterProposals(history, filter);
  return (
    <Boot>
      <Screen wide>
        <LineReveal as="h1" className={styles.title} text="Activity" />
        <p className={`${styles.lead} rise`} style={delay(60)}>
          Every payment your agents asked for, newest first, and what Veto decided.
        </p>

        {attention.length > 0 && (
          <section className={`${styles.section} rise`} style={delay(100)} aria-labelledby="needs-title">
            <h2 id="needs-title" className={styles.sectionTitle}>
              Needs your decision <span className={styles.count}>{attention.length}</span>
            </h2>
            <p className={styles.sectionLead}>Vetoed payments you can keep blocked or override, and overrides waiting to pay.</p>
            <div className={styles.panel}>
              <ActivityList state={state} proposals={allNeeds ? attention : attention.slice(0, NEEDS)} startDelay={140} />
            </div>
            {attention.length > NEEDS && !allNeeds && (
              <div className={styles.more}>
                <Pill variant="secondary" size="md" onClick={() => setAllNeeds(true)}>
                  {`Show all ${attention.length}`}
                </Pill>
              </div>
            )}
          </section>
        )}

        <section className={styles.section} aria-labelledby="all-title">
          <div className={styles.titleRow}>
            <h2 id="all-title" className={styles.sectionTitle}>All payments</h2>
            {matching.length > 0 && (
              <Pill
                variant="secondary"
                size="sm"
                icon="file"
                onClick={() =>
                  downloadCsv(
                    `veto-payments-${vaultId ?? "vault"}-${new Date().toISOString().slice(0, 10)}.csv`,
                    paymentsCsv(state, matching, window.location.origin, vaultId ?? ""),
                  )
                }
              >
                Download CSV
              </Pill>
            )}
          </div>
          <div className={`${styles.tools} rise`} style={delay(140)}>
            <Segmented
              label="Filter payments"
              options={filterOptions(history)}
              value={filter}
              onChange={(f) => {
                setFilter(f);
                setShown(PAGE);
              }}
            />
          </div>
          <div className={styles.panel}>
            <ActivityList
              state={state}
              proposals={matching.slice(0, shown)}
              startDelay={180}
              empty={filter === "all" ? undefined : `Nothing ${filter === "pending" ? "pending" : filter} right now.`}
            />
          </div>
          {matching.length > shown && (
            <div className={styles.more}>
              <Pill variant="secondary" size="md" onClick={() => setShown((n) => n + PAGE)}>
                {`Show ${Math.min(PAGE, matching.length - shown)} more (${matching.length - shown} left)`}
              </Pill>
            </div>
          )}
        </section>
      </Screen>
    </Boot>
  );
}
