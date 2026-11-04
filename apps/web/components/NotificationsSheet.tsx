"use client";

import { needsDecision, useVault } from "@/lib/vault";
import { useKeptBlocked } from "@/lib/dismissed";
import { ActivityList } from "./ActivityList";
import { Sheet, SheetHeader } from "./Sheet";
import styles from "./NotificationsSheet.module.css";

/** The bell: what needs your decision first, then what happened lately. */
export function NotificationsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { state } = useVault();
  const { kept } = useKeptBlocked();
  const attention = state ? needsDecision(state.proposals, kept) : [];
  const waiting = new Set(attention.map((p) => p.id));
  const recent = state ? state.proposals.filter((p) => !waiting.has(p.id)).slice(0, 8) : [];
  const n = attention.length;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      labelledBy="notes-title"
      wide
      header={
        <SheetHeader
          id="notes-title"
          title="Notifications"
          sub={n ? `${n} payment${n === 1 ? "" : "s"} need${n === 1 ? "s" : ""} your decision.` : "You're all caught up. Nothing needs your decision."}
          onClose={onClose}
        />
      }
    >
      {state && n > 0 && (
        <section className={styles.section} aria-labelledby="notes-needs">
          <h3 id="notes-needs" className={styles.label}>
            Needs your decision
          </h3>
          <ActivityList state={state} proposals={attention.slice(0, 20)} />
        </section>
      )}
      {state && (
        <section className={styles.section} aria-labelledby="notes-recent">
          <h3 id="notes-recent" className={styles.label}>
            Recent
          </h3>
          <ActivityList state={state} proposals={recent} empty="No payments yet. When your agent proposes one, it shows up here with Veto's decision." />
        </section>
      )}
    </Sheet>
  );
}
