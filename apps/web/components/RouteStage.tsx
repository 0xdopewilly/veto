"use client";

import { useContext, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { LayoutRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { AnimatePresence, motion, useReducedMotion, type Variants } from "motion/react";
import { useIsDesktop } from "@/lib/media";
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

const PUSH = { duration: 0.56, ease: [0.32, 0.72, 0, 1] as const };
const TAB = { duration: 0.36, ease: [0.2, 0.8, 0.2, 1] as const };

const mobile: Variants = {
  enter: (dir: number) =>
    dir > 0
      ? { x: "100%", opacity: 1, y: 0, zIndex: 2, filter: "brightness(1)" }
      : dir < 0
        ? { x: "-28%", opacity: 1, y: 0, zIndex: 1, filter: "brightness(0.45)" }
        : { x: 0, opacity: 0, y: 12, zIndex: 2, filter: "brightness(1)" },
  center: (dir: number) => ({
    x: 0,
    y: 0,
    opacity: 1,
    filter: "brightness(1)",
    transition: dir === 0 ? TAB : PUSH,
  }),
  exit: (dir: number) =>
    dir > 0
      ? { x: "-28%", filter: "brightness(0.45)", zIndex: 1, transition: PUSH }
      : dir < 0
        ? { x: "100%", zIndex: 2, transition: PUSH }
        : { opacity: 0, zIndex: 1, transition: { duration: 0.2 } },
};

const desktop: Variants = {
  enter: { opacity: 0, y: 10, x: 0 },
  center: { opacity: 1, y: 0, x: 0, transition: { duration: 0.42, ease: [0.2, 0.8, 0.2, 1] } },
  exit: { opacity: 0, y: -8, transition: { duration: 0.2 } },
};

const reduced: Variants = {
  enter: { opacity: 0 },
  center: { opacity: 1, transition: { duration: 0.2 } },
  exit: { opacity: 0, transition: { duration: 0.15 } },
};

export function RouteStage({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isDesktop = useIsDesktop();
  const reduce = useReducedMotion();
  const [nav, setNav] = useState({ path: pathname, dir: 0 });
  if (nav.path !== pathname) {
    setNav({ path: pathname, dir: Math.sign(levelOf(pathname) - levelOf(nav.path)) });
  }
  const variants = reduce ? reduced : isDesktop ? desktop : mobile;

  return (
    <div className={styles.stage}>
      <AnimatePresence initial={false} custom={nav.dir}>
        <motion.div
          key={pathname}
          className={styles.screen}
          custom={nav.dir}
          variants={variants}
          initial="enter"
          animate="center"
          exit="exit"
        >
          <Frozen>{children}</Frozen>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
