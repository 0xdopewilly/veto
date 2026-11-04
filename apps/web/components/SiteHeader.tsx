"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { GITHUB_URL } from "@/lib/config";
import { SITE_PAGES } from "@/lib/nav";
import { useAppReturn } from "@/lib/backTo";
import { useIsDesktop } from "@/lib/media";
import { SPRING_SURFACE, SPRING_UI, useCalm } from "@/lib/motion";
import { Lockup, Mark } from "./Logo";
import { Icon } from "./Icon";
import { Magnetic } from "./Magnetic";
import styles from "./SiteHeader.module.css";

/** Into the app: the welcome screen on a phone (sandbox or your own vault), the app itself on a desktop. */
export function useAppTarget() {
  const back = useAppReturn();
  const desktop = useIsDesktop();
  return back ? { href: back.href, label: `Back to ${back.label}`, back: true } : { href: desktop ? "/app" : "/start", label: "Open the app", back: false };
}

/** Into the app, or back to the app screen you left to read the site. */
export function AppButton({ full = false }: { full?: boolean }) {
  const app = useAppTarget();
  const arrow = (
    <span className={styles.appArrow} aria-hidden="true">
      <Icon name={app.back ? "arrowLeft" : "arrowRight"} size={full ? 17 : 15} stroke={2.4} />
    </span>
  );
  const link = (
    <Link href={app.href} className={`${styles.app} ${full ? styles.appFull : ""} press`} data-back={app.back || undefined}>
      {app.back && arrow}
      <span className={styles.appText}>{app.label}</span>
      {!app.back && arrow}
    </Link>
  );
  return full ? link : (
    <Magnetic strength={0.22} className={styles.magnet}>
      {link}
    </Magnetic>
  );
}

/** One header for the landing, Docs and Bench: the same links everywhere, the page you're on marked. */
export function SiteHeader() {
  const pathname = usePathname();
  const calm = useCalm();
  const back = useAppReturn();
  // The menu belongs to the page it was opened on, so moving to another page closes it.
  const [openOn, setOpenOn] = useState<string | null>(null);
  const open = openOn === pathname;
  const setOpen = (next: boolean) => setOpenOn(next ? pathname : null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpenOn(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <header className={styles.top} data-wide={pathname === "/" || undefined} data-back={back ? true : undefined}>
      <AnimatePresence>
        {open && (
          <motion.button
            key="scrim"
            type="button"
            className={styles.scrim}
            aria-label="Close menu"
            tabIndex={-1}
            onClick={() => setOpen(false)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          />
        )}
      </AnimatePresence>

      <div className={styles.bar}>
        <Link href="/" className={styles.brand} aria-label="Veto overview">
          <span className={styles.lockup}>
            <Lockup size={24} />
          </span>
          <span className={styles.markOnly}>
            <Mark size={28} />
          </span>
        </Link>

        <nav aria-label="Site" className={styles.nav}>
          {SITE_PAGES.map((p) => {
            const here = pathname === p.href;
            return (
              <Link key={p.href} href={p.href} className={styles.navLink} data-here={here || undefined} aria-current={here ? "page" : undefined}>
                {here && <motion.span layoutId="site-here" className={styles.navPill} transition={calm ? { duration: 0 } : SPRING_UI} />}
                <span>{p.label}</span>
              </Link>
            );
          })}
          <a href={GITHUB_URL} target="_blank" rel="noreferrer" className={styles.navLink}>
            <span>GitHub</span>
            <Icon name="external" size={13} />
          </a>
        </nav>

        <div className={styles.end}>
          <AppButton />
          <button
            type="button"
            className={`${styles.menuButton} press`}
            aria-expanded={open}
            aria-controls="site-menu"
            aria-label={open ? "Close menu" : "Menu"}
            onClick={() => setOpen(!open)}
          >
            <span className={styles.burger} data-open={open || undefined} aria-hidden="true">
              <i />
              <i />
            </span>
          </button>
        </div>
      </div>

      <AnimatePresence>
        {open && (
          <motion.nav
            key="menu"
            id="site-menu"
            aria-label="Site menu"
            className={styles.menu}
            initial={calm ? { opacity: 0 } : { opacity: 0, y: -10, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={calm ? { opacity: 0 } : { opacity: 0, y: -8, scale: 0.98, transition: { duration: 0.16 } }}
            transition={calm ? { duration: 0.15 } : SPRING_SURFACE}
          >
            {SITE_PAGES.map((p, i) => {
              const here = pathname === p.href;
              return (
                <motion.div key={p.href} initial={calm ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ ...SPRING_UI, delay: 0.04 + i * 0.04 }}>
                  <Link href={p.href} className={styles.menuItem} data-here={here || undefined} aria-current={here ? "page" : undefined} onClick={() => setOpen(false)}>
                    <span className={styles.menuText}>
                      <span className={styles.menuLabel}>{p.label}</span>
                      <span className={styles.menuSub}>{p.sub}</span>
                    </span>
                    {here ? <span className={styles.hereTag}>You&apos;re here</span> : <Icon name="arrowRight" size={17} />}
                  </Link>
                </motion.div>
              );
            })}
            <motion.div initial={calm ? false : { opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ ...SPRING_UI, delay: 0.04 + SITE_PAGES.length * 0.04 }}>
              <a href={GITHUB_URL} target="_blank" rel="noreferrer" className={styles.menuItem}>
                <span className={styles.menuText}>
                  <span className={styles.menuLabel}>GitHub</span>
                  <span className={styles.menuSub}>The code, MIT licence</span>
                </span>
                <Icon name="external" size={16} />
              </a>
            </motion.div>
            <motion.div
              className={styles.menuApp}
              initial={calm ? false : { opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...SPRING_UI, delay: 0.08 + SITE_PAGES.length * 0.04 }}
            >
              <AppButton full />
            </motion.div>
          </motion.nav>
        )}
      </AnimatePresence>
    </header>
  );
}
