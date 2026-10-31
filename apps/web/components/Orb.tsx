"use client";

import { motion } from "motion/react";
import { useCalm } from "@/lib/motion";
import styles from "./Orb.module.css";

/**
 * The enclave, drawn as a glowing orb that breathes and slowly turns. Green when everything is
 * clear, coral while something waits on a decision; `pulse` (a changing key) sends a ripple
 * when a verdict lands.
 */
export function Orb({ alarm, pulse, size = 180 }: { alarm: boolean; pulse: string | number; size?: number }) {
  const calm = useCalm();
  return (
    <div className={`${styles.orb} ${alarm ? styles.alarm : ""} ${calm ? styles.calm : ""}`} style={{ width: size, height: size }} aria-hidden="true">
      <span className={styles.halo} />
      <span className={styles.body}>
        <span className={styles.swirl} />
        <span className={styles.core} />
        <span className={styles.shine} />
      </span>
      {!calm && (
        <motion.span
          key={pulse}
          className={styles.wave}
          initial={{ scale: 0.7, opacity: 0.7 }}
          animate={{ scale: 1.7, opacity: 0 }}
          transition={{ duration: 1.6, ease: [0.16, 1, 0.3, 1] }}
        />
      )}
      <span className={styles.dust} />
    </div>
  );
}
