"use client";

import { useEffect } from "react";
import { useVault } from "@/lib/vault";
import { Screen, delay } from "@/components/Screen";
import { Boot } from "@/components/Boot";
import { Icon } from "@/components/Icon";
import { LineReveal } from "@/components/LineReveal";
import { Pill } from "@/components/Pill";
import { useShell } from "@/components/Shell";
import { MandateSection } from "./MandateView";
import { PayeesSection } from "./PayeesView";
import head from "./PageHead.module.css";
import styles from "./RulesView.module.css";

const PARTS = [
  { id: "mandate", label: "Mandate and limits" },
  { id: "payees", label: "Payees" },
  { id: "freeze", label: "Freeze" },
];

/** Everything that decides what the agent may pay, in one place: mandate, limits, payees, freeze. */
export function RulesView() {
  const { state, vaultId } = useVault();
  const { openFreeze } = useShell();

  // Links like /app/rules#payees: the app scrolls inside its own container, so scroll there here.
  useEffect(() => {
    if (!state) return;
    const id = window.location.hash.slice(1);
    if (id) requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: "start" }));
  }, [state]);

  if (!state) return <Boot loading caption="Loading your rules" />;
  const frozen = state.config.frozen;

  return (
    <Boot>
      <Screen>
        <LineReveal as="h1" className={head.title} text="Rules" />
        <p className={`${head.lead} rise`} style={delay(60)}>
          What your agent may pay from <span className="mono">{vaultId}</span>, and who it may pay. Veto checks every payment against all of it.
        </p>
        <nav className={`${styles.jump} rise`} style={delay(100)} aria-label="On this page">
          {PARTS.map((p) => (
            <a key={p.id} href={`#${p.id}`} className={`${styles.jumpLink} press`}>
              {p.label}
            </a>
          ))}
        </nav>

        <section id="mandate" className={styles.part} aria-labelledby="mandate-title">
          <h2 id="mandate-title" className={styles.partTitle}>Mandate and limits</h2>
          <MandateSection state={state} />
        </section>

        <section id="payees" className={styles.part} aria-labelledby="payees-title">
          <PayeesSection state={state} titleClass={styles.partTitle} />
        </section>

        <section id="freeze" className={styles.part} aria-labelledby="freeze-title">
          <h2 id="freeze-title" className={styles.partTitle}>Freeze</h2>
          <div className={styles.freeze} data-frozen={frozen || undefined}>
            <span className={styles.freezeIcon} aria-hidden="true">
              <Icon name={frozen ? "lock" : "unlock"} size={20} />
            </span>
            <div className={styles.freezeText}>
              <strong>{frozen ? "Every payment is stopped" : "Payments are flowing"}</strong>
              <span>
                {frozen
                  ? "Veto approves nothing, not even an override, until you unfreeze."
                  : "Freezing stops every payment Veto would approve at once, from the vault and from its agents' wallets, including overrides. Use it if an agent or a key looks compromised."}
              </span>
            </div>
            <Pill variant={frozen ? "primary" : "danger"} size="md" icon={frozen ? "unlock" : "lock"} onClick={openFreeze}>
              {frozen ? "Unfreeze" : "Freeze all payments"}
            </Pill>
          </div>
        </section>
      </Screen>
    </Boot>
  );
}
