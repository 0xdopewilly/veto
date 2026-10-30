"use client";

import { useVault } from "@/lib/vault";
import { Screen, delay } from "@/components/Screen";
import { ActivityList } from "@/components/ActivityList";
import { LoadingScreen } from "@/components/VLoader";
import styles from "./PageHead.module.css";

export function DecisionsView() {
  const { state } = useVault();
  if (!state) return <LoadingScreen caption="Loading decisions" />;
  return (
    <Screen>
      <h1 className={`${styles.title} rise`}>Decisions</h1>
      <p className={`${styles.lead} rise`} style={delay(60)}>
        Every payment your agents proposed, newest first, with what Veto decided.
      </p>
      <div className={styles.body}>
        <ActivityList state={state} proposals={state.proposals} startDelay={120} />
      </div>
    </Screen>
  );
}
