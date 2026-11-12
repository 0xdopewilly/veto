"use client";

import { motion } from "motion/react";
import { useCalm, useEntrance } from "@/lib/motion";
import styles from "./SpendRing.module.css";

/**
 * How much of a limit is used, to scale: one green arc on the track, drawn in on entrance, with
 * the headline figure in the centre. No labels ride the ring, so nothing can overlap it.
 */
export function SpendRing({ value, max, center, caption, size = 200 }: { value: number; max: number; center: string; caption: string; size?: number }) {
  const entrance = useEntrance();
  const calm = useCalm();
  const stroke = Math.round(size * 0.11);
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const share = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0;
  const arc = share * c;
  return (
    <div className={styles.ring} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" style={{ stroke: "var(--track)" }} strokeWidth={stroke} />
        {arc > 0 && (
          <motion.circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            style={{ stroke: "var(--green)" }}
            strokeWidth={stroke}
            strokeLinecap="round"
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            initial={!entrance || calm ? false : { strokeDasharray: `0 ${c}` }}
            animate={{ strokeDasharray: `${arc} ${c}` }}
            transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1], delay: 0.25 }}
          />
        )}
      </svg>
      <div className={styles.center}>
        <span className={styles.value} style={{ fontSize: Math.round(size * 0.17) }}>
          {center}
        </span>
        <span className={styles.caption}>{caption}</span>
      </div>
    </div>
  );
}
