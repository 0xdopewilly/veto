"use client";

import type { CSSProperties } from "react";
import { useEntrance } from "@/lib/motion";
import styles from "./SignalBar.module.css";

/**
 * Ten rounded segments filled by how many risk signals fired. Plain elements with a CSS
 * entrance (a staggered pop), so a list of fifty rows costs no animation work in JavaScript.
 */
export function SignalBar({ filled, tone, label, delay = 0 }: { filled: number; tone: "green" | "coral" | "purple"; label: string; delay?: number }) {
  const entrance = useEntrance();
  return (
    <span className={`${styles.bar} ${entrance ? styles.enter : ""}`} role="img" aria-label={label} style={{ "--d": `${delay}s` } as CSSProperties}>
      {Array.from({ length: 10 }, (_, i) => (
        <span key={i} className={`${styles.seg} ${i < filled ? styles[tone] : ""}`} style={{ "--i": i } as CSSProperties} />
      ))}
    </span>
  );
}
