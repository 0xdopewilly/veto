"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { animate } from "motion";
import { COVER_MS, morphDone, morphGrown, useMorph } from "@/lib/morph";
import styles from "./MorphOverlay.module.css";

const GROW = 0.6;

/** Radius that covers the whole viewport from (x, y). */
function coverRadius(x: number, y: number, el: HTMLElement) {
  const w = window.innerWidth;
  const h = Math.max(window.innerHeight, el.offsetHeight);
  return Math.hypot(Math.max(x, w - x), Math.max(y, h - y)) + 24;
}

/** The coral circle itself. Driven by the phases in lib/morph. */
export function MorphOverlay() {
  const m = useMorph();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const R = coverRadius(m.x, m.y, el);
    const at = `at ${m.x}px ${m.y}px`;
    if (m.phase === "grow") {
      el.style.opacity = "1";
      // Starts as a press-sized dot so the tap answers on the very next frame.
      const a = animate(el, { clipPath: [`circle(28px ${at})`, `circle(${R}px ${at})`] }, { duration: GROW, ease: [0.55, 0, 0.1, 1] });
      // The screen is covered well before the curve settles; start the reveal then.
      const covered = setTimeout(morphGrown, GROW * 780);
      return () => {
        clearTimeout(covered);
        a.stop();
      };
    }
    if (m.phase === "fade") {
      el.style.clipPath = `circle(${R}px ${at})`;
      const a = animate(el, { opacity: [1, 0] }, { duration: 0.34, ease: [0.4, 0, 0.2, 1] });
      a.then(morphDone);
      return () => a.stop();
    }
    if (m.phase === "full") {
      el.style.clipPath = `circle(${R}px ${at})`;
      const a = animate(el, { opacity: [0, 1] }, { duration: COVER_MS / 1000, ease: [0.2, 0, 0, 1] });
      return () => a.stop();
    }
    if (m.phase === "shrink") {
      el.style.opacity = "1";
      const a = animate(el, { clipPath: [`circle(${R}px ${at})`, `circle(0px ${at})`] }, { duration: 0.56, ease: [0.5, 0, 0.12, 1] });
      a.then(morphDone);
      return () => a.stop();
    }
  }, [m.phase, m.key, m.x, m.y]);

  if (m.phase === "idle" || typeof document === "undefined") return null;
  return createPortal(<div ref={ref} className={styles.overlay} style={{ background: m.color }} aria-hidden="true" />, document.body);
}
