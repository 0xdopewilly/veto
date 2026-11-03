"use client";

import { useRef, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { LoadingScreen } from "./VLoader";
import { SPRING_SURFACE, useCalm } from "@/lib/motion";
import styles from "./Boot.module.css";

/**
 * Loading to content without a cut: the V loader fades out while the content unblurs and
 * settles from 98.5% scale. Views return <Boot loading /> while loading and <Boot>…</Boot>
 * once ready, so React keeps this component and can animate between the two.
 */
export function Boot({ loading = false, caption, children }: { loading?: boolean; caption?: string; children?: ReactNode }) {
  const calm = useCalm();
  const wasLoading = useRef(loading);
  const animateIn = !loading && wasLoading.current;
  if (loading) wasLoading.current = true;

  return (
    <div className={styles.boot}>
      <AnimatePresence initial={false}>
        {loading && (
          <motion.div
            key="loader"
            className={styles.veil}
            exit={calm ? { opacity: 0 } : { opacity: 0, scale: 1.06 }}
            transition={{ duration: 0.35, ease: [0.4, 0, 0.2, 1] }}
          >
            <LoadingScreen caption={caption} />
          </motion.div>
        )}
      </AnimatePresence>
      {!loading && (
        <motion.div
          className={styles.content}
          initial={animateIn ? (calm ? { opacity: 0 } : { opacity: 0, scale: 0.985, y: 6 }) : false}
          animate={{ opacity: 1, scale: 1, y: 0, transitionEnd: { transform: "none" } }}
          transition={calm ? { duration: 0.25 } : SPRING_SURFACE}
        >
          {children}
        </motion.div>
      )}
    </div>
  );
}
