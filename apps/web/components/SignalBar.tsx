"use client";

import { motion } from "motion/react";
import { useEntrance } from "@/lib/motion";
import styles from "./SignalBar.module.css";

/** Ten rounded segments filled by how many risk signals fired. */
export function SignalBar({ filled, tone, label, delay = 0 }: { filled: number; tone: "green" | "coral" | "purple"; label: string; delay?: number }) {
  const entrance = useEntrance();
  return (
    <span className={styles.bar} role="img" aria-label={label}>
      {Array.from({ length: 10 }, (_, i) => (
        <motion.span
          key={i}
          className={`${styles.seg} ${i < filled ? styles[tone] : ""}`}
          initial={!entrance ? false : { scaleY: 0.3, opacity: 0 }}
          animate={{ scaleY: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 500, damping: 24, delay: delay + i * 0.025 }}
        />
      ))}
    </span>
  );
}
