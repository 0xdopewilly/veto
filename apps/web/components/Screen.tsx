import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { Icon } from "./Icon";
import styles from "./Screen.module.css";

/**
 * Page padding for both layouts: phone gutters with room for the tab bar, or the desktop
 * content column. `tone` colours the whole screen on phones (the coral vetoed screen).
 */
export function Screen({
  children,
  pushed = false,
  tone,
  wide = false,
}: {
  children: ReactNode;
  pushed?: boolean;
  tone?: "coral" | "purple" | "green";
  wide?: boolean;
}) {
  return (
    <div className={`${styles.screen} ${pushed ? styles.pushed : ""} ${tone ? styles[tone] : ""}`}>
      <div className={`${styles.inner} ${wide ? styles.wide : ""}`}>{children}</div>
    </div>
  );
}

/** The round back button on pushed phone screens; a text link on desktop. */
export function BackLink({ href, label, onCoral = false }: { href: string; label: string; onCoral?: boolean }) {
  return (
    <Link href={href} className={`${styles.back} ${onCoral ? styles.backCoral : ""} press`} aria-label={label}>
      <span className={styles.backCircle}>
        <Icon name="arrowLeft" size={20} stroke={2.25} />
      </span>
      <span className={styles.backText}>{label}</span>
    </Link>
  );
}

export const delay = (ms: number): CSSProperties => ({ animationDelay: `${ms}ms` });
