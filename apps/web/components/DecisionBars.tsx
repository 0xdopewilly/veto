"use client";

import { motion } from "motion/react";
import { useEntrance } from "@/lib/motion";
import styles from "./DecisionBars.module.css";

export interface Bar {
  label: string;
  value: number;
  display: string;
  style: "hatched" | "dark" | "light";
}

/** Three tall bars on the green panel: paid (hatched), stopped (dark), in flight (light). */
export function DecisionBars({ bars }: { bars: Bar[] }) {
  const entrance = useEntrance();
  const max = Math.max(1, ...bars.map((b) => b.value));
  return (
    <div className={styles.bars}>
      {bars.map((b, i) => {
        const h = 22 + (b.value / max) * 78;
        return (
          <div key={b.label} className={styles.col}>
            <motion.span
              className={styles.chip}
              initial={!entrance ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ type: "spring", stiffness: 380, damping: 26, delay: 0.5 + i * 0.12 }}
            >
              <span className={styles.chipLabel}>{b.label}</span>
              <span className={styles.chipValue}>{b.display}</span>
            </motion.span>
            <motion.span
              className={`${styles.bar} ${styles[b.style]} ${b.style === "hatched" ? "hatched" : ""}`}
              style={{ height: `${h}%`, transformOrigin: "50% 100%" }}
              initial={!entrance ? false : { scaleY: 0 }}
              animate={{ scaleY: 1 }}
              transition={{ type: "spring", stiffness: 110, damping: 17, delay: 0.25 + i * 0.12 }}
            />
          </div>
        );
      })}
    </div>
  );
}
