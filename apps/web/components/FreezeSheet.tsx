"use client";

import { useEffect } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useVault } from "@/lib/vault";
import { Icon, type IconName } from "./Icon";
import { OwnerButton } from "./OwnerButton";
import { Pill } from "./Pill";
import styles from "./FreezeSheet.module.css";

const EFFECTS: { icon: IconName; text: string }[] = [
  { icon: "bot", text: "Agents can't propose payments" },
  { icon: "clock", text: "Pending overrides are cancelled" },
  { icon: "lock", text: "Your funds stay in the vault" },
  { icon: "key", text: "Unfreezing needs your wallet signature" },
];

/** Bottom sheet on phones, centred panel on desktop. */
export function FreezeSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { state } = useVault();
  const reduce = useReducedMotion();
  const frozen = !!state?.config.frozen;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <div className={styles.layer}>
          <motion.button
            aria-label="Close"
            className={styles.backdrop}
            onClick={onClose}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
          />
          <motion.section
            role="dialog"
            aria-modal="true"
            aria-labelledby="freeze-title"
            className={styles.sheet}
            initial={reduce ? { opacity: 0 } : { y: "100%" }}
            animate={reduce ? { opacity: 1 } : { y: 0 }}
            exit={reduce ? { opacity: 0 } : { y: "100%" }}
            transition={{ duration: 0.42, ease: [0.32, 0.72, 0, 1] }}
          >
            <span aria-hidden="true" className={styles.handle} />
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
                  <OwnerButton method="freeze" variant="danger" icon="lock" full success="Frozen">
                    Freeze now
                  </OwnerButton>
                  <Pill variant="secondary" size="md" full onClick={onClose}>Cancel</Pill>
                </div>
              </>
            )}
          </motion.section>
        </div>
      )}
    </AnimatePresence>
  );
}
