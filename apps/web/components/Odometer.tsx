"use client";

import { motion } from "motion/react";
import { useCalm, useEntrance } from "@/lib/motion";
import styles from "./Odometer.module.css";

const DIGITS = "0123456789";

/**
 * Rolling digits: each digit is a column that springs to its value, on first show (rolling
 * up from zero, staggered) and whenever the value changes. Separators stay put. Digits keep
 * their natural widths; `fixed` gives every cell the same width for values that tick (a
 * countdown) so the line doesn't shuffle.
 */
export function Odometer({
  value,
  className,
  delay = 0,
  play = true,
  fixed = false,
}: {
  value: string;
  className?: string;
  delay?: number;
  play?: boolean;
  fixed?: boolean;
}) {
  const calm = useCalm();
  const entrance = useEntrance();
  const chars = [...value];
  const digitCount = chars.filter((c) => DIGITS.includes(c)).length;
  let seen = 0;
  return (
    <span className={`${styles.odo} ${className ?? ""}`} aria-label={value} role="text">
      {chars.map((ch, i) => {
        if (!DIGITS.includes(ch)) {
          return (
            <span key={`s${i}`} className={styles.sep} aria-hidden="true">
              {ch}
            </span>
          );
        }
        const order = seen++;
        // Keys count from the right so a value growing a digit doesn't remount the others.
        const key = `d${digitCount - order}`;
        const n = Number(ch);
        return (
          <span key={key} className={styles.cell} aria-hidden="true">
            <span className={styles.ghost}>{fixed ? "0" : ch}</span>
            <motion.span
              className={styles.column}
              style={{ x: "-50%" }}
              initial={entrance ? { y: "0%" } : false}
              animate={{ y: play || calm ? `${-n * 10}%` : "0%" }}
              transition={calm ? { duration: 0 } : { type: "spring", stiffness: 120, damping: 19, mass: 1, delay: delay / 1000 + order * 0.045 }}
            >
              {/* Drawn by CSS from data-d, so the page's text holds the value once, not 0–9 per digit. */}
              {DIGITS.split("").map((d) => (
                <span key={d} className={styles.digit} data-d={d} />
              ))}
            </motion.span>
          </span>
        );
      })}
    </span>
  );
}
