"use client";

import { useId } from "react";
import { motion } from "motion/react";
import { SPRING_UI } from "@/lib/motion";
import styles from "./Segmented.module.css";

/** A capsule track with a filled pill that springs to the selected option. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  tone = "dark",
  label,
}: {
  options: { value: T; label: string; count?: number }[];
  value: T;
  onChange: (v: T) => void;
  tone?: "dark" | "onGreen" | "onCoral";
  label: string;
}) {
  const id = useId();
  return (
    <div className={`${styles.track} ${styles[tone]}`} role="tablist" aria-label={label}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button key={o.value} role="tab" aria-selected={active} className={`${styles.option} ${active ? styles.active : ""}`} onClick={() => onChange(o.value)}>
            {active && <motion.span layoutId={`seg-${id}`} className={styles.pill} transition={SPRING_UI} />}
            <span className={styles.text}>
              {o.label}
              {o.count !== undefined && o.count > 0 && <span className={styles.count}>{o.count}</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}
