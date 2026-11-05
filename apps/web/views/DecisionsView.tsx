"use client";

import { useState } from "react";
import { Pill } from "@/components/Pill";
import { needsDecision, useVault } from "@/lib/vault";
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
  // Newest first, a page at a time: the list stays quick to open however many payments the vault has.
  const [shown, setShown] = useState(PAGE);
  if (!state) return <Boot loading caption="Loading activity" />;
  const attention = needsDecision(state.proposals, kept);
  const matching = filterProposals(state.proposals, filter);
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
              <ActivityList state={state} proposals={attention.slice(0, NEEDS)} startDelay={140} />
            </div>
            {attention.length > NEEDS && (
              <p className={styles.sectionLead}>
                {attention.length - NEEDS} more below: filter by <strong>Vetoed</strong>.
              </p>
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
              options={filterOptions(state.proposals)}
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
                {`Show ${Math.min(PAGE, matching.length - shown)} more of ${matching.length - shown}`}
              </Pill>
            </div>
          )}
        </section>
      </Screen>
    </Boot>
  );
}
