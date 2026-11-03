"use client";

import { useState } from "react";
import { Pill } from "@/components/Pill";
import { useVault } from "@/lib/vault";
import { Screen, delay } from "@/components/Screen";
import { ActivityList, filterOptions, filterProposals, type Filter } from "@/components/ActivityList";
import { Boot } from "@/components/Boot";
import { LineReveal } from "@/components/LineReveal";
import { Segmented } from "@/components/Segmented";
import styles from "./PageHead.module.css";

const PAGE = 15;

export function DecisionsView() {
  const { state } = useVault();
  const [filter, setFilter] = useState<Filter>("all");
  // Newest first, a page at a time: the list stays quick to open however many payments the vault has.
  const [shown, setShown] = useState(PAGE);
  if (!state) return <Boot loading caption="Loading decisions" />;
  const matching = filterProposals(state.proposals, filter);
  return (
    <Boot>
      <Screen wide>
        <LineReveal as="h1" className={styles.title} text="Decisions" />
        <p className={`${styles.lead} rise`} style={delay(60)}>
          Every payment your agents proposed, newest first, with what Veto decided.
        </p>
        <div className={`${styles.tools} rise`} style={delay(100)}>
          <Segmented
            label="Filter decisions"
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
            startDelay={140}
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
      </Screen>
    </Boot>
  );
}
