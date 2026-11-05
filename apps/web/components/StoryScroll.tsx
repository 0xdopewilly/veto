"use client";

import { useRef, useState } from "react";
import { motion, useMotionValueEvent, useScroll, useTransform } from "motion/react";
import { useCalm } from "@/lib/motion";
import { Circuit } from "./Circuit";
import styles from "./StoryScroll.module.css";

export interface StoryGate {
  title: string;
  text: string;
  tag: string;
  tone: "green" | "coral" | "purple";
}

/**
 * "Two gates": a tall section whose inside stays pinned while you scroll. Scrolling drives
 * the circuit: the packet leaves the vault, passes the cap, and is stopped by the AI screen,
 * while the copy for each gate lights up in turn. Reduced motion gets a static layout.
 */
export function StoryScroll({ title, lead, gates }: { title: string; lead: string; gates: readonly StoryGate[] }) {
  const calm = useCalm();
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end end"] });
  const t = useTransform(scrollYProgress, [0.06, 0.8], [0, 1], { clamp: true });
  const overrideIn = useTransform(t, [0.86, 0.96], [0, 1], { clamp: true });
  const overrideY = useTransform(t, [0.86, 0.96], [16, 0], { clamp: true });
  const [active, setActive] = useState(0);
  useMotionValueEvent(t, "change", (v) => setActive(v < 0.42 ? 0 : v < 0.84 ? 1 : 2));

  return (
    <section id="how" ref={ref} className={`${styles.story} ${calm ? styles.calm : ""}`} aria-labelledby="story-title">
      <div className={styles.sticky}>
        <div className={styles.panel}>
          <div className={styles.text}>
            <h2 id="story-title" className={styles.title}>
              {title}
            </h2>
            <p className={styles.lead}>{lead}</p>
            <ol className={styles.gates}>
              {gates.map((g, i) => {
                const on = calm || i === active;
                return (
                  <li key={g.title} className={`${styles.gate} ${on ? styles.on : ""} ${styles[g.tone]}`}>
                    <span className={styles.rail} aria-hidden="true">
                      <span className={styles.railFill} />
                    </span>
                    <div className={styles.gateBody}>
                      <div className={styles.gateHead}>
                        <h3 className={styles.gateTitle}>{g.title}</h3>
                        <span className={styles.tag}>{g.tag}</span>
                      </div>
                      <div className={styles.collapse}>
                        <p className={styles.gateText}>{g.text}</p>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>
          <div className={styles.visual}>
            <div className={styles.circuitCard}>
              <span className={styles.glow} data-stage={active} aria-hidden="true" />
              <Circuit ai="veto" paid={false} large progress={calm ? undefined : t} />
              <motion.p className={styles.override} style={calm ? { opacity: 1, y: 0 } : { opacity: overrideIn, y: overrideY }}>
                <span className={styles.overrideDot} aria-hidden="true" />
                You can still override it. It pays only after a delay, and you can cancel until then.
              </motion.p>
            </div>
            {!calm && (
              <div className={styles.progress} aria-hidden="true">
                <motion.span className={styles.progressFill} style={{ scaleX: scrollYProgress }} />
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
