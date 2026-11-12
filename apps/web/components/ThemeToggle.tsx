"use client";

import { useTheme } from "@/lib/theme";
import { Icon } from "./Icon";
import styles from "./ThemeToggle.module.css";

/** Light/dark switch. `className` gives it the host's button shape (the circles in the app's bars). */
export function ThemeToggle({ className = "", size = 18 }: { className?: string; size?: number }) {
  const { theme, toggle } = useTheme();
  const next = theme === "light" ? "dark" : "light";
  return (
    <button
      type="button"
      className={`${className} press`}
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
      onClick={(e) => {
        const r = e.currentTarget.getBoundingClientRect();
        toggle({ x: r.left + r.width / 2, y: r.top + r.height / 2 });
      }}
    >
      <span className={styles.icons} data-showing={theme} aria-hidden="true">
        <Icon name="moon" size={size} stroke={1.8} className={styles.moon} />
        <Icon name="sun" size={size} stroke={1.8} className={styles.sun} />
      </span>
    </button>
  );
}
