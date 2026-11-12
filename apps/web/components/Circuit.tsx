"use client";

import { useEffect } from "react";
import { animate, motion, useMotionValue, useTransform, type MotionValue } from "motion/react";
import { useCalm } from "@/lib/motion";
import { Icon } from "./Icon";
import styles from "./Circuit.module.css";

type Ai = "pass" | "veto" | "pending";

const DURATION = 2.3;

/**
 * Vault → contract cap → AI screen → payee, as one timeline `t` from 0 to 1: lines draw, a
 * packet travels, the cap passes, and the AI screen either lets it through (payee fills
 * green) or stops it (coral hit, shockwave, shake, packet bounces back, "Not paid").
 * `progress` scrubs the timeline from outside (scroll); otherwise it plays once, after
 * `delay`, as soon as `play` is true.
 */
export function Circuit({
  ai,
  paid,
  large = false,
  delay = 0,
  play = true,
  progress,
}: {
  ai: Ai;
  paid: boolean;
  large?: boolean;
  delay?: number;
  play?: boolean;
  progress?: MotionValue<number>;
}) {
  const calm = useCalm();
  const own = useMotionValue(calm && !progress ? 1 : 0);
  const t = progress ?? own;
  const end = ai === "pending" ? 0.52 : 1;

  useEffect(() => {
    if (progress) return;
    if (calm) {
      own.set(end);
      return;
    }
    if (!play) return;
    const controls = animate(own, end, { duration: DURATION * end, delay: delay / 1000, ease: "linear" });
    return () => controls.stop();
  }, [progress, calm, play, delay, end, own]);

  const size = large ? 22 : 16;

  return (
    <div className={`${styles.circuit} ${large ? styles.large : ""}`} role="img" aria-label={summary(ai, paid)}>
      <Node t={t} at={0} label="Vault" tone="vault">
        <Icon name="lock" size={size} />
      </Node>
      <Seg t={t} draw={[0.04, 0.18]} travel={[0.08, 0.27]} />
      <Gate t={t} at={0.27} label="Limits" result="pass" size={size} />
      <Seg t={t} draw={[0.3, 0.44]} travel={[0.34, 0.62]} hit={ai === "veto"} loop={ai === "pending"} />
      {ai === "pending" ? (
        <Waiting t={t} size={size} />
      ) : (
        <Gate t={t} at={0.62} label="AI screen" result={ai} size={size} />
      )}
      {ai === "veto" ? (
        <Broken t={t} />
      ) : ai === "pass" ? (
        <Seg t={t} draw={[0.66, 0.78]} travel={[0.68, paid ? 0.86 : 0.98]} loop={!paid} />
      ) : (
        <Broken t={t} quiet />
      )}
      <Payee t={t} paid={paid && ai === "pass"} waiting={ai === "pending" || (ai === "pass" && !paid)} size={size} />
    </div>
  );
}

function summary(ai: Ai, paid: boolean) {
  if (ai === "veto") return "Vault, limits passed, AI screen vetoed, payee not paid.";
  if (ai === "pending") return "Vault, limits passed, AI screen still screening.";
  return paid ? "Vault, limits passed, AI screen passed, payee paid." : "Vault, both checks passed, sending to the payee.";
}

/* ----------------------------------------------------------------- pieces */

function useRange(t: MotionValue<number>, [a, b]: [number, number]) {
  return useTransform(t, [a, b], [0, 1], { clamp: true });
}

function Node({ t, at, label, tone, children }: { t: MotionValue<number>; at: number; label: string; tone: "vault"; children: React.ReactNode }) {
  const scale = useTransform(t, [at, at + 0.03, at + 0.06], [0.6, 1.1, 1], { clamp: true });
  const opacity = useTransform(t, [at, at + 0.03], [0, 1], { clamp: true });
  return (
    <motion.div className={styles.node} style={{ opacity }}>
      <motion.span className={`${styles.dot} ${styles[tone]}`} style={{ scale }}>
        {children}
      </motion.span>
      <span className={styles.label}>{label}</span>
    </motion.div>
  );
}

/** A check that passes or vetoes when the packet arrives at `at`. */
function Gate({ t, at, label, result, size }: { t: MotionValue<number>; at: number; label: string; result: "pass" | "veto"; size: number }) {
  const appear = useTransform(t, [Math.max(0, at - 0.22), at - 0.16], [0, 1], { clamp: true });
  const fill = useTransform(t, [at, at + 0.025], [0, 1], { clamp: true });
  const scale = useTransform(t, [at - 0.01, at + 0.02, at + 0.06, at + 0.1], [1, 1.16, 0.96, 1], { clamp: true });
  const draw = useTransform(t, [at + 0.01, at + 0.07], [0, 1], { clamp: true });
  const word = useTransform(t, [at + 0.03, at + 0.08], [0, 1], { clamp: true });
  const veto = result === "veto";
  const shake = useTransform(t, [at, at + 0.015, at + 0.03, at + 0.045, at + 0.06, at + 0.08], veto ? [0, -7, 6, -4, 3, 0] : [0, 0, 0, 0, 0, 0], { clamp: true });
  const ring = useTransform(t, [at, at + 0.18], [1, 2.3], { clamp: true });
  const ringOpacity = useTransform(t, [at, at + 0.01, at + 0.18], [0, 0.75, 0], { clamp: true });
  const glow = useTransform(t, [at, at + 0.04, at + 0.3], [0, 1, veto ? 0.55 : 0.25], { clamp: true });

  return (
    <motion.div className={styles.node} style={{ opacity: appear, x: shake }}>
      <motion.span className={`${styles.dot} ${styles.neutral}`} style={{ scale }}>
        <motion.span className={`${styles.fill} ${veto ? styles.fillVeto : styles.fillPass}`} style={{ opacity: fill }} />
        <motion.span className={`${styles.glow} ${veto ? styles.glowVeto : styles.glowPass}`} style={{ opacity: glow }} aria-hidden="true" />
        {veto && <motion.span className={styles.shock} style={{ scale: ring, opacity: ringOpacity }} aria-hidden="true" />}
        <svg width={size} height={size} viewBox="0 0 24 24" className={`${styles.mark} ${veto ? styles.markVeto : styles.markPass}`} aria-hidden="true">
          {veto ? (
            <>
              <motion.path d="M18 6 6 18" style={{ pathLength: draw }} />
              <motion.path d="m6 6 12 12" style={{ pathLength: draw }} />
            </>
          ) : (
            <motion.path d="M20 6 9 17l-5-5" style={{ pathLength: draw }} />
          )}
        </svg>
      </motion.span>
      <span className={styles.label}>{label}</span>
      <motion.span className={veto ? styles.vetoText : styles.passText} style={{ opacity: word }}>
        {veto ? "Veto" : "Pass"}
      </motion.span>
    </motion.div>
  );
}

function Waiting({ t, size }: { t: MotionValue<number>; size: number }) {
  const appear = useTransform(t, [0.3, 0.36], [0, 1], { clamp: true });
  return (
    <motion.div className={styles.node} style={{ opacity: appear }}>
      <span className={`${styles.dot} ${styles.waiting}`}>
        <span className={styles.waitPulse} aria-hidden="true" />
        <Icon name="clock" size={size} />
      </span>
      <span className={styles.label}>AI screen</span>
      <span className={styles.waitText}>Screening</span>
    </motion.div>
  );
}

/** A connector that draws, then carries a glowing packet. A `hit` packet bounces back coral. */
function Seg({ t, draw, travel, hit = false, loop = false }: { t: MotionValue<number>; draw: [number, number]; travel: [number, number]; hit?: boolean; loop?: boolean }) {
  const length = useRange(t, draw);
  const [a, b] = travel;
  const left = useTransform(
    t,
    hit ? [a, b, b + 0.04, b + 0.08] : [a, b],
    hit ? ["0%", "100%", "78%", "86%"] : ["0%", "100%"],
    { clamp: true },
  );
  const opacity = useTransform(t, hit ? [a, a + 0.02, b + 0.06, b + 0.12] : [a, a + 0.02, b - 0.02, b], hit ? [0, 1, 1, 0] : [0, 1, 1, 0], { clamp: true });
  const color = useTransform(t, [b - 0.01, b + 0.01], ["#00ec97", hit ? "#ff7966" : "#00ec97"], { clamp: true });
  const scale = useTransform(t, hit ? [b - 0.01, b + 0.015, b + 0.05] : [0, 1], hit ? [1, 1.8, 1] : [1, 1], { clamp: true });

  return (
    <span className={styles.seg} aria-hidden="true">
      <svg className={styles.segSvg} viewBox="0 0 100 4" preserveAspectRatio="none">
        <path d="M0 2H100" className={styles.track} />
        <motion.path d="M0 2H100" className={styles.line} style={{ pathLength: length }} />
      </svg>
      {loop ? (
        <span className={styles.loopPacket} />
      ) : (
        <motion.span className={styles.packet} style={{ left, opacity, backgroundColor: color, scale, color }} />
      )}
    </span>
  );
}

function Broken({ t, quiet = false }: { t: MotionValue<number>; quiet?: boolean }) {
  const opacity = useTransform(t, quiet ? [0.36, 0.44] : [0.72, 0.84], [0, 1], { clamp: true });
  return (
    <motion.span className={`${styles.seg} ${styles.broken}`} style={{ opacity }} aria-hidden="true">
      <svg className={styles.segSvg} viewBox="0 0 100 4" preserveAspectRatio="none">
        <path d="M0 2H100" className={styles.dashed} />
      </svg>
    </motion.span>
  );
}

function Payee({ t, paid, waiting, size }: { t: MotionValue<number>; paid: boolean; waiting: boolean; size: number }) {
  const appear = useTransform(t, waiting ? [0.4, 0.48] : paid ? [0.6, 0.66] : [0.8, 0.9], [0, 1], { clamp: true });
  const fill = useTransform(t, [0.86, 0.9], [0, 1], { clamp: true });
  const scale = useTransform(t, [0.85, 0.88, 0.93, 0.97], [1, 1.16, 0.97, 1], { clamp: true });
  const ripple = useTransform(t, [0.86, 1], [1, 2.2], { clamp: true });
  const rippleOpacity = useTransform(t, [0.86, 0.87, 1], [0, 0.6, 0], { clamp: true });
  const word = useTransform(t, [0.88, 0.94], [0, 1], { clamp: true });

  return (
    <motion.div className={`${styles.node} ${styles.payee}`} style={{ opacity: appear }}>
      <motion.span className={`${styles.dot} ${styles.unpaid}`} style={paid ? { scale } : undefined}>
        {paid && <motion.span className={`${styles.fill} ${styles.fillPaid}`} style={{ opacity: fill }} />}
        {paid && <motion.span className={styles.ripple} style={{ scale: ripple, opacity: rippleOpacity }} aria-hidden="true" />}
        <span className={styles.payeeIcon} data-paid={paid || undefined}>
          <Icon name="user" size={size} />
        </span>
      </motion.span>
      <span className={styles.label}>Payee</span>
      {paid ? (
        <motion.span className={styles.passText} style={{ opacity: word }}>Paid</motion.span>
      ) : (
        <span className={styles.idleText}>{waiting ? "Waiting" : "Not paid"}</span>
      )}
    </motion.div>
  );
}
