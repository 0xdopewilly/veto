"use client";

import { useEffect, type PointerEvent, type ReactNode } from "react";
import { AnimatePresence, motion, useAnimate, useDragControls, useMotionValue, useTransform, type PanInfo } from "motion/react";
import { useIsDesktop } from "@/lib/media";
import { SPRING_SURFACE, SPRING_UI, useCalm } from "@/lib/motion";
import { Icon } from "./Icon";
import styles from "./Sheet.module.css";

/**
 * Bottom sheet on phones and a centred panel on desktop. On phones the top strip (the handle and
 * any `header`) drags the sheet down to dismiss, velocity-aware, with the backdrop fading along;
 * the body below is an ordinary scroll area, so scrolling a long sheet never fights the drag.
 */
export function Sheet({
  open,
  onClose,
  labelledBy,
  children,
  header,
  wide = false,
}: {
  open: boolean;
  onClose: () => void;
  labelledBy: string;
  children: ReactNode;
  /** Stays put above the scrolling body, e.g. a SheetHeader. */
  header?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <SheetBody onClose={onClose} labelledBy={labelledBy} wide={wide} header={header}>
          {children}
        </SheetBody>
      )}
    </AnimatePresence>
  );
}

/** A sheet's title row: title, optional line under it, and a close button. */
export function SheetHeader({ id, title, sub, onClose, children }: { id: string; title: string; sub?: ReactNode; onClose: () => void; children?: ReactNode }) {
  return (
    <div className={styles.header}>
      <div className={styles.headerTop}>
        <h2 id={id} className={styles.headerTitle}>
          {title}
        </h2>
        <button type="button" className={`${styles.close} press`} onClick={onClose} aria-label="Close">
          <Icon name="x" size={17} stroke={2.2} />
        </button>
      </div>
      {sub && <p className={styles.headerSub}>{sub}</p>}
      {children}
    </div>
  );
}

function SheetBody({ onClose, labelledBy, children, wide, header }: { onClose: () => void; labelledBy: string; children: ReactNode; wide: boolean; header?: ReactNode }) {
  const desktop = useIsDesktop();
  const calm = useCalm();
  const y = useMotionValue(0);
  const backdrop = useTransform(y, [0, 420], [1, 0]);
  const [scope, animate] = useAnimate();
  const controls = useDragControls();
  const draggable = !desktop && !calm;

  // Only the top strip starts a drag; buttons and links in it still just get tapped.
  const grab = (e: PointerEvent) => {
    if (!draggable || (e.target as HTMLElement).closest("button, a, input, textarea, select")) return;
    controls.start(e);
  };

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
        drag={draggable ? "y" : false}
        dragControls={controls}
        dragListener={false}
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0.04, bottom: 0.75 }}
        dragMomentum={false}
        onDragEnd={onDragEnd}
        initial={calm ? { opacity: 0 } : desktop ? { opacity: 0, scale: 0.94, y: 24 } : { y: "100%" }}
        animate={calm ? { opacity: 1 } : desktop ? { opacity: 1, scale: 1, y: 0 } : { y: 0 }}
        exit={calm ? { opacity: 0 } : desktop ? { opacity: 0, scale: 0.96, y: 12, transition: { duration: 0.2 } } : { y: "100%", transition: { type: "spring", stiffness: 300, damping: 34 } }}
        transition={calm ? { duration: 0.2 } : SPRING_SURFACE}
      >
        <div className={styles.grab} onPointerDown={grab} data-draggable={draggable || undefined}>
          <span aria-hidden="true" className={styles.handle} />
          {header}
        </div>
        <div className={styles.body}>{children}</div>
      </motion.section>
    </div>
  );
}
