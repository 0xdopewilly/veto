import type { CSSProperties } from "react";
import styles from "./MaskedLetters.module.css";

/**
 * A word whose letters rise one by one from behind a mask, with a slight skew that settles.
 * Used for VETOED.
 */
export function MaskedLetters({ text, delay = 0, stagger = 35, className }: { text: string; delay?: number; stagger?: number; className?: string }) {
  return (
    <span className={`${styles.word} ${className ?? ""}`} aria-label={text} role="text">
      {[...text].map((ch, i) => (
        <span key={i} className={styles.mask} aria-hidden="true">
          <span className={styles.glyph} style={{ animationDelay: `${delay + i * stagger}ms` } as CSSProperties}>
            {ch}
          </span>
        </span>
      ))}
    </span>
  );
}
