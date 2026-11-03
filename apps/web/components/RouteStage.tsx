"use client";

import { useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { LayoutRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { AnimatePresence, motion, type Transition, type Variants } from "motion/react";
import { useIsDesktop } from "@/lib/media";
import { ReturnContext, useCalm } from "@/lib/motion";
import { morphArrived, useMorph } from "@/lib/morph";
import styles from "./RouteStage.module.css";

/** Keeps a leaving route rendering its own content while it animates out. */
function Frozen({ children }: { children: ReactNode }) {
  const context = useContext(LayoutRouterContext);
  const frozen = useRef(context).current;
  return <LayoutRouterContext.Provider value={frozen}>{children}</LayoutRouterContext.Provider>;
}

/** Tabs sit at level 0; a decision (or onboarding's second step) is pushed on top, its proof on top of that. */
export function levelOf(path: string): number {
  if (/^\/app\/decisions\/[^/]+\/proof/.test(path)) return 2;
  if (/^\/app\/decisions\//.test(path) || path === "/start/vault") return 1;
  return 0;
}

const PUSH: Transition = { type: "spring", stiffness: 260, damping: 32, mass: 1 };
const TAB: Transition = { type: "spring", stiffness: 300, damping: 30, mass: 0.9 };
// Screens only move (transform); the screen underneath darkens through one shared layer whose
// opacity animates. Both run on the compositor, so a push never repaints a full screen.
const BEHIND = { x: "-24%", scale: 0.96 };
const FRONT = { x: 0, scale: 1 };
const DIM = 0.5;

type Custom = { dir: number; instant: boolean };

const mobile: Variants = {
  enter: ({ dir, instant }: Custom) =>
    instant
      ? { ...FRONT, opacity: 1, y: 0, zIndex: 2 }
      : dir > 0
        ? { ...FRONT, x: "100%", opacity: 1, y: 0, zIndex: 3 }
        : dir < 0
          ? { ...BEHIND, opacity: 1, y: 0, zIndex: 1 }
          : { ...FRONT, opacity: 0, y: 14, zIndex: 3 },
  center: ({ dir, instant }: Custom) => ({
    ...FRONT,
    y: 0,
    opacity: 1,
    transition: instant ? { duration: 0 } : dir === 0 ? TAB : PUSH,
  }),
  exit: ({ dir, instant }: Custom) =>
    instant
      ? { opacity: 0, transition: { duration: 0 } }
      : dir > 0
        ? { ...BEHIND, zIndex: 1, transition: PUSH }
        : dir < 0
          ? { x: "100%", zIndex: 3, transition: PUSH }
          : { opacity: 0, scale: 0.99, zIndex: 1, transition: { duration: 0.18 } },
};

const desktop: Variants = {
  enter: ({ instant }: Custom) => (instant ? { opacity: 1 } : { opacity: 0, y: 12 }),
  center: ({ instant }: Custom) => ({
    opacity: 1,
    y: 0,
    transition: instant ? { duration: 0 } : { type: "spring", stiffness: 220, damping: 28 },
  }),
  exit: ({ instant }: Custom) => (instant ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, y: -6, transition: { duration: 0.18 } }),
};

const reduced: Variants = {
  enter: { opacity: 0 },
  center: { opacity: 1, transition: { duration: 0.2 } },
  exit: { opacity: 0, transition: { duration: 0.15 } },
};

export function RouteStage({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isDesktop = useIsDesktop();
  const calm = useCalm();
  const morph = useMorph();
  const [nav, setNav] = useState({ path: pathname, dir: 0, instant: false });
  if (nav.path !== pathname) {
    // A route change while the circle covers the screen swaps without a slide.
    setNav({ path: pathname, dir: Math.sign(levelOf(pathname) - levelOf(nav.path)), instant: morph.phase !== "idle" });
  }

  useEffect(() => {
    if (morph.phase === "idle") return;
    const raf = requestAnimationFrame(() => requestAnimationFrame(morphArrived));
    return () => cancelAnimationFrame(raf);
    // Only on route changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  const variants = calm ? reduced : isDesktop ? desktop : mobile;
  const custom: Custom = { dir: nav.dir, instant: nav.instant };
  const hold = morph.phase === "grow" || morph.phase === "covered";

  const pushes = !calm && !isDesktop && !nav.instant && nav.dir !== 0;
  return (
    <div className={styles.stage} data-hold={hold || undefined}>
      {/* Darkens whatever screen is underneath during a push or a pop. */}
      <motion.div
        key={`dim:${pathname}`}
        className={styles.dim}
        aria-hidden="true"
        initial={{ opacity: pushes && nav.dir < 0 ? DIM : 0 }}
        animate={{ opacity: pushes && nav.dir > 0 ? DIM : 0 }}
        transition={PUSH}
      />
      <AnimatePresence initial={false} custom={custom}>
        <motion.div
          key={pathname}
          className={styles.screen}
          custom={custom}
          variants={variants}
          initial="enter"
          animate="center"
          exit="exit"
          data-return={nav.dir < 0 || undefined}
        >
          <ReturnContext.Provider value={nav.dir < 0}>
            <Frozen>{children}</Frozen>
          </ReturnContext.Provider>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
