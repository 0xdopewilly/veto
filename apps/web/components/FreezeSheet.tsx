"use client";

import { useVault } from "@/lib/vault";
import { Icon, type IconName } from "./Icon";
import { OwnerButton } from "./OwnerButton";
import { Pill } from "./Pill";
import { Sheet } from "./Sheet";
import styles from "./FreezeSheet.module.css";

const EFFECTS: { icon: IconName; text: string }[] = [
  { icon: "bot", text: "Agents can't propose payments" },
  { icon: "clock", text: "Pending overrides are cancelled" },
  { icon: "lock", text: "Your funds stay in the vault" },
  { icon: "key", text: "Unfreezing needs your wallet signature" },
];

/** Freeze or unfreeze every payment. Drag down to dismiss on phones. */
export function FreezeSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { state } = useVault();
  const frozen = !!state?.config.frozen;

  return (
    <Sheet open={open} onClose={onClose} labelledBy="freeze-title">
      <span className={`${styles.badge} ${frozen ? styles.badgeOn : ""}`} aria-hidden="true">
        <Icon name={frozen ? "unlock" : "lock"} size={22} stroke={2.1} />
      </span>
      {frozen ? (
        <>
          <h2 id="freeze-title" className={styles.title}>Payments are frozen</h2>
          <p className={styles.lead}>Agents can't propose payments and nothing leaves the vault until you unfreeze it.</p>
          <div className={styles.actions}>
            <OwnerButton method="unfreeze" icon="unlock" full success="Unfrozen" onDone={onClose}>
              Unfreeze payments
            </OwnerButton>
            <Pill variant="secondary" size="md" full onClick={onClose}>Done</Pill>
          </div>
        </>
      ) : (
        <>
          <h2 id="freeze-title" className={styles.title}>Freeze all payments?</h2>
          <ul className={styles.list}>
            {EFFECTS.map((effect, i) => (
              <li key={effect.text} className={`${styles.row} rise`} style={{ animationDelay: `${120 + i * 60}ms` }}>
                <span className={styles.rowIcon}>
                  <Icon name={effect.icon} size={16} />
                </span>
                {effect.text}
              </li>
            ))}
          </ul>
          <div className={styles.actions}>
            <OwnerButton method="freeze" variant="danger" icon="lock" full success="Frozen" onDone={onClose}>
              Freeze now
            </OwnerButton>
            <Pill variant="secondary" size="md" full onClick={onClose}>Cancel</Pill>
          </div>
        </>
      )}
    </Sheet>
  );
}
