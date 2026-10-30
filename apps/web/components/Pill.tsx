"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon";
import { VLoader } from "./VLoader";
import styles from "./Pill.module.css";

export type PillVariant = "primary" | "secondary" | "danger" | "ink" | "inkOutline" | "ghost";

const LOADER_TONE: Record<PillVariant, "dark" | "light" | "mono"> = {
  primary: "light",
  secondary: "dark",
  danger: "mono",
  ink: "dark",
  inkOutline: "mono",
  ghost: "dark",
};

interface PillProps {
  children: ReactNode;
  variant?: PillVariant;
  size?: "lg" | "md" | "sm";
  icon?: IconName;
  href?: string;
  external?: boolean;
  onClick?: () => void;
  loading?: boolean;
  disabled?: boolean;
  full?: boolean;
  type?: "button" | "submit";
  ariaLabel?: string;
}

export function Pill({
  children,
  variant = "primary",
  size = "lg",
  icon,
  href,
  external,
  onClick,
  loading,
  disabled,
  full,
  type = "button",
  ariaLabel,
}: PillProps) {
  const className = [styles.pill, styles[variant], styles[size], full ? styles.full : "", "press"].join(" ");
  const content = (
    <>
      {loading ? <VLoader size={size === "sm" ? 18 : 22} tone={LOADER_TONE[variant]} /> : icon ? <Icon name={icon} size={size === "sm" ? 15 : 17} stroke={2.1} /> : null}
      <span>{children}</span>
    </>
  );

  if (href && !disabled) {
    return external ? (
      <a className={className} href={href} target="_blank" rel="noreferrer" aria-label={ariaLabel}>
        {content}
      </a>
    ) : (
      <Link className={className} href={href} aria-label={ariaLabel}>
        {content}
      </Link>
    );
  }
  return (
    <button
      className={className}
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      aria-label={ariaLabel}
    >
      {content}
    </button>
  );
}
