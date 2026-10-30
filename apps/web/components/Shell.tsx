"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { VaultProvider, useVault } from "@/lib/vault";
import { WalletProvider, useWallet } from "@/lib/wallet";
import { VAULT_ID, VAULT_NAME } from "@/lib/config";
import { Lockup } from "./Logo";
import { Icon, type IconName } from "./Icon";
import { RouteStage, levelOf } from "./RouteStage";
import { FreezeSheet } from "./FreezeSheet";
import styles from "./Shell.module.css";

const ShellContext = createContext<{ openFreeze: () => void }>({ openFreeze: () => {} });
export const useShell = () => useContext(ShellContext);

const NAV: { href: string; label: string; icon: IconName; tab?: string }[] = [
  { href: "/app", label: "Overview", icon: "dashboard", tab: "Activity" },
  { href: "/app/decisions", label: "Decisions", icon: "activity" },
  { href: "/app/mandate", label: "Mandate", icon: "file", tab: "Mandate" },
  { href: "/app/payees", label: "Payees", icon: "users", tab: "Payees" },
  { href: "/app/agents", label: "Agents", icon: "bot", tab: "Agents" },
  { href: "/bench", label: "Bench", icon: "chart" },
];

function activeHref(pathname: string) {
  return NAV.find((n) => n.href !== "/app" && pathname.startsWith(n.href))?.href ?? "/app";
}

export function Shell({ children }: { children: ReactNode }) {
  return (
    <VaultProvider>
      <WalletProvider>
        <ShellFrame>{children}</ShellFrame>
      </WalletProvider>
    </VaultProvider>
  );
}

function ShellFrame({ children }: { children: ReactNode }) {
  const [freezeOpen, setFreezeOpen] = useState(false);
  const pathname = usePathname();
  const showTabs = levelOf(pathname) === 0;

  return (
    <ShellContext.Provider value={{ openFreeze: () => setFreezeOpen(true) }}>
      <div className={styles.shell}>
        <Sidebar onFreeze={() => setFreezeOpen(true)} />
        <RouteStage>{children}</RouteStage>
        <TabBar visible={showTabs} />
      </div>
      <FreezeSheet open={freezeOpen} onClose={() => setFreezeOpen(false)} />
    </ShellContext.Provider>
  );
}

function Sidebar({ onFreeze }: { onFreeze: () => void }) {
  const pathname = usePathname();
  const active = activeHref(pathname);
  const { state } = useVault();
  const { accountId, connect, disconnect } = useWallet();
  const frozen = state?.config.frozen;

  return (
    <aside className={styles.sidebar} aria-label="Vault">
      <Link href="/" className={styles.brand} aria-label="Veto home">
        <Lockup size={25} />
      </Link>
      <div className={styles.account}>
        <span className={styles.accountName}>{VAULT_NAME}</span>
        <span className={`mono ${styles.accountId}`}>{VAULT_ID}</span>
        <span className={styles.status}>
          <span className={styles.statusDot} data-frozen={frozen || undefined} aria-hidden="true" />
          {frozen ? "Payments frozen" : "Screening every payment"}
        </span>
      </div>
      <nav aria-label="Primary" className={styles.nav}>
        {NAV.map((item) => {
          const isActive = item.href === active;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`${styles.navItem} ${isActive ? styles.navActive : ""}`}
              aria-current={isActive ? "page" : undefined}
            >
              {isActive && <motion.span layoutId="sidebar-pill" className={styles.navPill} transition={{ type: "spring", stiffness: 420, damping: 36 }} />}
              <Icon name={item.icon} size={20} stroke={1.75} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
      <div className={styles.sideFoot}>
        <button className={`${styles.walletButton} press`} onClick={accountId ? disconnect : connect}>
          <Icon name="wallet" size={16} />
          <span className="mono">{accountId ?? "Connect wallet"}</span>
        </button>
        <button className={`${styles.freeze} press`} onClick={onFreeze}>
          <Icon name={frozen ? "unlock" : "lock"} size={16} />
          {frozen ? "Unfreeze payments" : "Freeze all payments"}
        </button>
      </div>
    </aside>
  );
}

const TABS = NAV.filter((n) => n.tab);

function TabBar({ visible }: { visible: boolean }) {
  const pathname = usePathname();
  const active = activeHref(pathname);
  const reduce = useReducedMotion();
  return (
    <AnimatePresence initial={false}>
      {visible && (
        <motion.nav
          aria-label="Primary"
          className={styles.tabbar}
          initial={reduce ? { opacity: 0 } : { y: "100%" }}
          animate={reduce ? { opacity: 1 } : { y: 0 }}
          exit={reduce ? { opacity: 0 } : { y: "100%" }}
          transition={{ duration: 0.4, ease: [0.32, 0.72, 0, 1] }}
        >
          {TABS.map((tab) => {
            const isActive = tab.href === active;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={`${styles.tab} ${isActive ? styles.tabActive : ""} press`}
                aria-current={isActive ? "page" : undefined}
              >
                {isActive && <motion.span layoutId="tab-indicator" className={styles.tabIndicator} transition={{ type: "spring", stiffness: 480, damping: 38 }} />}
                <Icon name={tab.icon === "dashboard" ? "activity" : tab.icon} size={22} stroke={1.75} />
                {tab.tab}
              </Link>
            );
          })}
        </motion.nav>
      )}
    </AnimatePresence>
  );
}
