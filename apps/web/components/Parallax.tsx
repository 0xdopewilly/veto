"use client";

import type { ReactNode } from "react";
import { motion, useScroll, useTransform } from "motion/react";
import { useCalm } from "@/lib/motion";

/** Drifts its child against the page scroll; positive `speed` lags, negative leads. */
export function Parallax({ children, speed = 0.1, className }: { children: ReactNode; speed?: number; className?: string }) {
  const calm = useCalm();
  const { scrollY } = useScroll();
  const y = useTransform(scrollY, (v) => Math.max(-160, Math.min(160, v * speed)));
  return (
    <motion.div className={className} style={calm ? { y: 0 } : { y }}>
      {children}
    </motion.div>
  );
}
