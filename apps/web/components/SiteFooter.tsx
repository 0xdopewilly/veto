"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { GITHUB_URL } from "@/lib/config";
import { SITE_PAGES } from "@/lib/nav";
import { Lockup } from "./Logo";
import { Icon } from "./Icon";
import { useAppTarget } from "./SiteHeader";
import styles from "./SiteFooter.module.css";

// What to read after each page, so none of them ends in a dead end.
const NEXT: Record<string, { href: string; title: string; text: string }> = {
  "/": { href: "/docs", title: "How it works", text: "Every step from the agent's request to the payout, and how to check a verdict yourself." },
  "/docs": { href: "/bench", title: "Veto Bench", text: "100 payments, half of them attacks. What the screen catches, and what a plain policy lets through." },
  "/bench": { href: "/challenge", title: "Can you fool Veto?", text: "Email the agent a scam yourself. Six tricks real fraud uses, and how often each one has been caught." },
  "/challenge": { href: "/bench", title: "Veto Bench", text: "100 payments, half of them attacks, every verdict signed. What the screen catches, and what a plain policy lets through." },
};

/** The end of every public page: where to go next, then the same links as the header. */
export function SiteFooter() {
  const pathname = usePathname();
  const app = useAppTarget();
  const next = NEXT[pathname] ?? NEXT["/"];

  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <nav aria-label="Where next" className={styles.next}>
          <Link href={next.href} className={`${styles.card} press`}>
            <span className={styles.title}>{next.title}</span>
            <span className={styles.text}>{next.text}</span>
            <span className={styles.go} aria-hidden="true">
              <Icon name="arrowRight" size={18} stroke={2.2} />
            </span>
          </Link>
          <Link href={app.href} className={`${styles.card} ${styles.cardApp} press`} data-back={app.back || undefined}>
            <span className={styles.title}>{app.back ? app.label : "Open the demo vault"}</span>
            <span className={styles.text}>
              {app.back ? "Pick up where you left off." : "A real vault on NEAR testnet. Hand the agent an invoice and watch Veto screen it. No wallet needed."}
            </span>
            <span className={styles.go} aria-hidden="true">
              <Icon name={app.back ? "arrowLeft" : "arrowRight"} size={18} stroke={2.2} />
            </span>
          </Link>
        </nav>

        <div className={styles.row}>
          <Link href="/" className={styles.brand} aria-label="Veto overview">
            <Lockup size={20} />
          </Link>
          <nav aria-label="Site" className={styles.links}>
            {SITE_PAGES.map((p) => (
              <Link key={p.href} href={p.href} aria-current={pathname === p.href ? "page" : undefined}>
                {p.label}
              </Link>
            ))}
            <a href={GITHUB_URL} target="_blank" rel="noreferrer">
              GitHub
            </a>
          </nav>
          <span className={styles.fine}>Built for NEAR HACKATHON 2026 · MIT licence</span>
        </div>
      </div>
    </footer>
  );
}
