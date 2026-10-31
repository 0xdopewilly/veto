"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CSSProperties, MouseEvent, ReactNode } from "react";
import { morphBack } from "@/lib/morph";
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
  flush = false,
}: {
  children: ReactNode;
  pushed?: boolean;
  tone?: "coral" | "purple" | "green";
  wide?: boolean;
  flush?: boolean;
}) {
  return (
    <div className={`${styles.screen} ${pushed ? styles.pushed : ""} ${flush ? styles.flush : ""} ${tone ? styles[tone] : ""}`}>
      <div className={`${styles.inner} ${wide ? styles.wide : ""}`}>{children}</div>
    </div>
  );
}

/**
 * The round back button on pushed phone screens; a text link on desktop. With `morphId`, a
 * decision opened from a card collapses back into that card instead of sliding away.
 */
export function BackLink({ href, label, onCoral = false, morphId }: { href: string; label: string; onCoral?: boolean; morphId?: string }) {
  const router = useRouter();
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (!morphId || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    if (morphBack({ id: morphId, href, push: router.push })) e.preventDefault();
  };
  return (
    <Link href={href} className={`${styles.back} ${onCoral ? styles.backCoral : ""} press`} aria-label={label} onClick={onClick}>
      <span className={styles.backCircle}>
        <Icon name="arrowLeft" size={20} stroke={2.25} />
      </span>
      <span className={styles.backText}>{label}</span>
    </Link>
  );
}

export const delay = (ms: number): CSSProperties => ({ animationDelay: `${ms}ms` });
