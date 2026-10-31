"use client";

import { useState } from "react";
import { useVault } from "@/lib/vault";
import { Screen, delay } from "@/components/Screen";
import { ActivityList, filterOptions, filterProposals, type Filter } from "@/components/ActivityList";
import { Boot } from "@/components/Boot";
import { LineReveal } from "@/components/LineReveal";
import { Segmented } from "@/components/Segmented";
import styles from "./PageHead.module.css";

export function DecisionsView() {
  const { state } = useVault();
  const [filter, setFilter] = useState<Filter>("all");
  if (!state) return <Boot loading caption="Loading decisions" />;
  return (
    <Boot>
      <Screen wide>
        <LineReveal as="h1" className={styles.title} text="Decisions" />
        <p className={`${styles.lead} rise`} style={delay(60)}>
          Every payment your agents proposed, newest first, with what Veto decided.
        </p>
        <div className={`${styles.tools} rise`} style={delay(100)}>
          <Segmented label="Filter decisions" options={filterOptions(state.proposals)} value={filter} onChange={setFilter} />
        </div>
        <div className={styles.panel}>
          <ActivityList
            state={state}
            proposals={filterProposals(state.proposals, filter)}
            startDelay={140}
            empty={filter === "all" ? undefined : `Nothing ${filter === "pending" ? "pending" : filter} right now.`}
          />
        </div>
      </Screen>
    </Boot>
  );
}
