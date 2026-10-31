"use client";

import { motion } from "motion/react";
import { useEntrance } from "@/lib/motion";
import styles from "./SpendRing.module.css";

export interface RingPart {
  label: string;
  value: number;
  tone: "green" | "coral" | "idle";
  bubble?: string;
}

const COLORS = { green: "#00ec97", coral: "#ff7966", idle: "#2a2a2a" };

/**
 * A donut of separated, rounded segments that draw in one after another, with small value
 * bubbles riding the arcs. The centre holds the headline figure.
 */
export function SpendRing({ parts, center, caption, size = 220 }: { parts: RingPart[]; center: string; caption: string; size?: number }) {
  const entrance = useEntrance();
  const stroke = size * 0.13;
  const r = (size - stroke) / 2 - 6;
  const c = 2 * Math.PI * r;
  const live = parts.filter((p) => p.value > 0);
  const gap = live.length > 1 ? stroke * 0.95 : 0;
  // Every non-zero part gets at least a readable sliver of the ring.
  const raw = parts.map((p) => (p.value > 0 ? p.value : 0));
  const sum = raw.reduce((a, v) => a + v, 0) || 1;
  const MIN = live.length > 1 ? 0.07 : 0;
  const fr = raw.map((v) => (v > 0 ? Math.max(MIN, v / sum) : 0));
  const norm = fr.reduce((a, v) => a + v, 0) || 1;

  let offset = 0;
  let lastBubble = -Infinity;
  const segs = parts.map((p, i) => {
    const len = (fr[i] / norm) * c;
    const visible = Math.max(0, len - gap);
    const start = offset;
    offset += len;
    let mid = ((start + len / 2) / c) * 2 * Math.PI - Math.PI / 2;
    // Bubbles that would overlap the previous one slide further round the ring.
    if (p.bubble && visible > 0) {
      if (mid - lastBubble < 0.62) mid = lastBubble + 0.62;
      lastBubble = mid;
    }
    return { ...p, i, len, visible, start, mid };
  });
  const br = r + stroke * 0.15;

  return (
    <div className={styles.ring} style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
        {segs.map((s) =>
          s.visible > 0 ? (
            <motion.circle
              key={s.label}
              cx={size / 2}
              cy={size / 2}
              r={r}
              fill="none"
              stroke={COLORS[s.tone]}
              strokeWidth={stroke}
              strokeLinecap="round"
              strokeDasharray={`${s.visible} ${c}`}
              transform={`rotate(${(s.start / c) * 360 - 90 + (gap / 2 / c) * 360} ${size / 2} ${size / 2})`}
              initial={!entrance ? false : { strokeDasharray: `0 ${c}` }}
              animate={{ strokeDasharray: `${s.visible} ${c}` }}
              transition={{ type: "spring", stiffness: 60, damping: 18, delay: 0.25 + s.i * 0.18 }}
            />
          ) : null,
        )}
      </svg>
      <div className={styles.center}>
        <span className={styles.big}>{center}</span>
        <span className={styles.caption}>{caption}</span>
      </div>
      {segs.map((s) =>
        s.bubble && s.visible > 0 ? (
          <motion.span
            key={`b${s.label}`}
            className={`${styles.bubble} ${styles[s.tone]}`}
            style={{ left: size / 2 + Math.cos(s.mid) * br, top: size / 2 + Math.sin(s.mid) * br }}
            initial={!entrance ? false : { opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: "spring", stiffness: 400, damping: 22, delay: 0.8 + s.i * 0.18 }}
          >
            {s.bubble}
          </motion.span>
        ) : null,
      )}
    </div>
  );
}
