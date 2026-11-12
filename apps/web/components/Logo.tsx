import styles from "./Logo.module.css";

type Tone = "dark" | "light" | "mono";

const STROKES: Record<Tone, [string, string]> = {
  // "dark" means drawn on the page ground, so its first stroke is the theme ink.
  dark: ["var(--sand)", "#FF7966"],
  light: ["#000000", "#FF7966"],
  mono: ["#000000", "#000000"],
};

/** Two signers, one V: the payer's stroke and Veto's stroke meet at the point. */
export function Mark({ size = 28, tone = "dark", title, sign = false }: { size?: number; tone?: Tone; title?: string; sign?: boolean }) {
  const [left, right] = STROKES[tone];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      className={`${styles.mark} ${sign ? styles.sign : ""}`}
    >
      <path pathLength={1} d="M17 14 32 50" fill="none" style={{ stroke: left }} strokeWidth="11" strokeLinecap="round" />
      <path pathLength={1} d="M47 14 32 50" fill="none" style={{ stroke: right }} strokeWidth="11" strokeLinecap="round" />
    </svg>
  );
}

export function Lockup({ size = 25, tone = "dark", sign = false }: { size?: number; tone?: Tone; sign?: boolean }) {
  return (
    <span className={styles.lockup} style={{ gap: Math.round(size * 0.36) }}>
      <Mark size={Math.round(size * 1.12)} tone={tone} sign={sign} />
      <span className={styles.word} style={{ fontSize: size }}>
        veto
      </span>
    </span>
  );
}
