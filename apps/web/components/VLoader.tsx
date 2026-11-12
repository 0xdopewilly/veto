import styles from "./VLoader.module.css";

type Tone = "dark" | "light" | "mono";

const STROKES: Record<Tone, [string, string]> = {
  // "dark" means drawn on the page ground, so its first stroke is the theme ink.
  dark: ["var(--sand)", "#FF7966"],
  light: ["#000000", "#FF7966"],
  mono: ["#000000", "#000000"],
};

/**
 * The V signs itself: the payer's stroke draws, Veto's joins it, they seal where they meet,
 * then clear. Used for every wait in the app. With reduced motion it breathes instead.
 */
export function VLoader({ size = 40, tone = "dark", label }: { size?: number; tone?: Tone; label?: string }) {
  const [left, right] = STROKES[tone];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      className={styles.loader}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <g className={styles.seal}>
        <path className={styles.s1} pathLength={1} d="M17 14 32 50" fill="none" style={{ stroke: left }} strokeWidth="11" strokeLinecap="round" />
        <path className={styles.s2} pathLength={1} d="M47 14 32 50" fill="none" style={{ stroke: right }} strokeWidth="11" strokeLinecap="round" />
      </g>
    </svg>
  );
}

/** Full-area loading state with a short caption. */
export function LoadingScreen({ caption = "Opening your vault" }: { caption?: string }) {
  return (
    <div className={styles.screen} role="status" aria-live="polite">
      <span className={styles.mark}>
        <span className={styles.halo} aria-hidden="true" />
        <VLoader size={88} />
      </span>
      <span className={styles.caption}>{caption}</span>
    </div>
  );
}
