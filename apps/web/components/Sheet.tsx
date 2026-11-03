"use client";

import { useEffect, type ReactNode } from "react";
import { AnimatePresence, motion, useAnimate, useMotionValue, useTransform, type PanInfo } from "motion/react";
import { useIsDesktop } from "@/lib/media";
import { SPRING_SURFACE, SPRING_UI, useCalm } from "@/lib/motion";
import styles from "./Sheet.module.css";

/**
 * Bottom sheet on phones (drag down to dismiss, velocity-aware; the backdrop fades with the
 * drag) and a centred panel on desktop.
 */
export function Sheet({
  open,
  onClose,
  labelledBy,
  children,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  labelledBy: string;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return <AnimatePresence>{open && <SheetBody onClose={onClose} labelledBy={labelledBy} wide={wide}>{children}</SheetBody>}</AnimatePresence>;
}

function SheetBody({ onClose, labelledBy, children, wide }: { onClose: () => void; labelledBy: string; children: ReactNode; wide: boolean }) {
  const desktop = useIsDesktop();
  const calm = useCalm();
  const y = useMotionValue(0);
  const backdrop = useTransform(y, [0, 420], [1, 0]);
  const [scope, animate] = useAnimate();

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > 110 || info.velocity.y > 520) onClose();
    else animate(scope.current, { y: 0 }, SPRING_UI);
  };

  return (
    <div className={styles.layer}>
      <motion.button
        aria-label="Close"
        className={styles.backdrop}
        onClick={onClose}
        style={desktop ? undefined : { opacity: backdrop }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.3 }}
      />
      <motion.section
        ref={scope}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        className={`${styles.sheet} ${wide ? styles.wide : ""}`}
        style={desktop ? undefined : { y }}
        drag={desktop || calm ? false : "y"}
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0.04, bottom: 0.75 }}
        dragMomentum={false}
        onDragEnd={onDragEnd}
        initial={calm ? { opacity: 0 } : desktop ? { opacity: 0, scale: 0.94, y: 24 } : { y: "100%" }}
        animate={calm ? { opacity: 1 } : desktop ? { opacity: 1, scale: 1, y: 0 } : { y: 0 }}
        exit={calm ? { opacity: 0 } : desktop ? { opacity: 0, scale: 0.96, y: 12, transition: { duration: 0.2 } } : { y: "100%", transition: { type: "spring", stiffness: 300, damping: 34 } }}
        transition={calm ? { duration: 0.2 } : SPRING_SURFACE}
      >
        <span aria-hidden="true" className={styles.handle} />
        {children}
      </motion.section>
    </div>
  );
}
