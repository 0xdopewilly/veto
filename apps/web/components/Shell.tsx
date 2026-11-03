"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { VaultProvider, useVault, needsDecision } from "@/lib/vault";
import { WalletProvider, useWallet } from "@/lib/wallet";
import { DemoProvider } from "@/lib/demoClient";
import { useKeptBlocked } from "@/lib/dismissed";
import { GITHUB_URL, NETWORK, VAULT_ID, VAULT_NAME } from "@/lib/config";
import { payeeLabel, STATUS_TEXT } from "@/lib/decision";
import { metaOf } from "@/lib/vault";
import { formatShort } from "@/lib/format";
import { SPRING_BOUNCE, SPRING_SURFACE, SPRING_UI, useCalm } from "@/lib/motion";
import { Lockup, Mark } from "./Logo";
import { useDecisionPulse } from "@/lib/pulse";
import { Icon, type IconName } from "./Icon";
import { RouteStage, levelOf } from "./RouteStage";
import { FreezeSheet } from "./FreezeSheet";
import { InboxSheet } from "./AgentInbox";
import { MorphOverlay } from "./MorphOverlay";
import { Spotlight } from "./Spotlight";
import { ToastProvider } from "./Toaster";
import styles from "./Shell.module.css";

interface ShellApi {
  openFreeze: () => void;
  openInbox: () => void;
}
const ShellContext = createContext<ShellApi>({ openFreeze: () => {}, openInbox: () => {} });
export const useShell = () => useContext(ShellContext);

interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  tab?: boolean;
  external?: boolean;
}

const VAULT_NAV: NavItem[] = [
  { href: "/app", label: "Overview", icon: "dashboard", tab: true },
  { href: "/app/decisions", label: "Decisions", icon: "activity" },
  { href: "/app/mandate", label: "Mandate", icon: "file", tab: true },
  { href: "/app/payees", label: "Payees", icon: "users", tab: true },
  { href: "/app/agents", label: "Agents", icon: "bot", tab: true },
];
const OTHER_NAV: NavItem[] = [
  { href: "/bench", label: "Veto Bench", icon: "chart" },
  { href: "/docs", label: "Docs", icon: "file" },
  { href: "/", label: "About Veto", icon: "home" },
  { href: GITHUB_URL, label: "GitHub", icon: "github", external: true },
];

function activeHref(pathname: string) {
  return VAULT_NAV.find((n) => n.href !== "/app" && pathname.startsWith(n.href))?.href ?? "/app";
}

export function Shell({ children }: { children: ReactNode }) {
  return (
    <VaultProvider>
      <WalletProvider>
        <DemoProvider>
          <ToastProvider>
            <ShellFrame>{children}</ShellFrame>
          </ToastProvider>
        </DemoProvider>
      </WalletProvider>
    </VaultProvider>
  );
}

function ShellFrame({ children }: { children: ReactNode }) {
  const [freezeOpen, setFreezeOpen] = useState(false);
  const pathname = usePathname();
  // The inbox belongs to the page it was opened on, so following a link out of it closes it.
  const [inboxAt, setInboxAt] = useState<string | null>(null);
  const inboxOpen = inboxAt === pathname;
  const showTabs = levelOf(pathname) === 0;
  const api = useMemo(() => ({ openFreeze: () => setFreezeOpen(true), openInbox: () => setInboxAt(pathname) }), [pathname]);

  return (
    <ShellContext.Provider value={api}>
      <div className={styles.shell}>
        <Sidebar onFreeze={api.openFreeze} />
        <div className={styles.main}>
          <TopBar />
          <RouteStage>{children}</RouteStage>
        </div>
        <TabBar visible={showTabs} onInbox={api.openInbox} />
      </div>
      <FreezeSheet open={freezeOpen} onClose={() => setFreezeOpen(false)} />
      <InboxSheet open={inboxOpen} onClose={() => setInboxAt(null)} />
      <MorphOverlay />
      <Spotlight />
    </ShellContext.Provider>
  );
}

/* --------------------------------------------------------------- sidebar */

function Sidebar({ onFreeze }: { onFreeze: () => void }) {
  const pathname = usePathname();
  const active = activeHref(pathname);
  const { state } = useVault();
  const { accountId, connect, disconnect } = useWallet();
  const frozen = state?.config.frozen;

  const item = (n: NavItem) => {
    const isActive = !n.external && n.href === active && pathname.startsWith("/app");
    const content = (
      <>
        {isActive && <motion.span layoutId="sidebar-pill" className={styles.navPill} transition={SPRING_UI} />}
        <Icon name={n.icon} size={19} stroke={1.75} />
        <span>{n.label}</span>
        {n.external && <Icon name="external" size={13} className={styles.navExt} />}
      </>
    );
    return n.external ? (
      <a key={n.href} href={n.href} target="_blank" rel="noreferrer" className={styles.navItem}>
        {content}
      </a>
    ) : (
      <Link key={n.href} href={n.href} className={`${styles.navItem} ${isActive ? styles.navActive : ""}`} aria-current={isActive ? "page" : undefined}>
        {content}
      </Link>
    );
  };

  const pulse = useDecisionPulse();
  return (
    <aside className={styles.sidebar} aria-label="Vault">
      <Link href="/" className={styles.brand} aria-label="Veto home">
        <span key={pulse?.key ?? "signed"} className={styles.brandMark} data-pulse={pulse?.tone}>
          <Lockup size={24} sign={!pulse} />
        </span>
      </Link>
      <div className={styles.vaultCard}>
        <span className={styles.vaultName}>{VAULT_NAME}</span>
        <span className={`mono ${styles.vaultId}`}>{VAULT_ID}</span>
        <span className={styles.status}>
          <span className={styles.statusDot} data-frozen={frozen || undefined} aria-hidden="true" />
          {frozen ? "Payments frozen" : "Screening every payment"}
        </span>
      </div>
      <nav aria-label="Primary" className={styles.nav}>
        <span className={styles.navGroup}>Vault</span>
        {VAULT_NAV.map(item)}
        <span className={styles.navGroup}>Other</span>
        {OTHER_NAV.map(item)}
      </nav>
      <div className={styles.sideFoot}>
        <button className={`${styles.footButton} ${frozen ? styles.footAlarm : ""} press`} onClick={onFreeze}>
          <Icon name={frozen ? "unlock" : "lock"} size={17} />
          {frozen ? "Unfreeze payments" : "Freeze all payments"}
        </button>
        <button className={`${styles.footButton} press`} onClick={accountId ? disconnect : connect}>
          <Icon name="wallet" size={17} />
          <span className={accountId ? `mono ${styles.ellipsis}` : undefined}>{accountId ? "Disconnect" : "Connect wallet"}</span>
        </button>
      </div>
    </aside>
  );
}

/* ---------------------------------------------------------------- top bar */

function TopBar() {
  const router = useRouter();
  const { state } = useVault();
  const { kept } = useKeptBlocked();
  const { accountId, connect } = useWallet();
  const attention = state ? needsDecision(state.proposals, kept) : [];

  return (
    <header className={styles.topbar}>
      <Search />
      <div className={styles.topRight}>
        <span className={styles.network}>
          <span className={styles.networkDot} aria-hidden="true" />
          {NETWORK === "testnet" ? "Testnet" : "Mainnet"}
        </span>
        <button
          className={`${styles.circle} press`}
          aria-label={attention.length ? `${attention.length} payment${attention.length === 1 ? "" : "s"} need your decision` : "No new notifications"}
          onClick={() => attention[0] && router.push(`/app/decisions/${attention[0].id}`)}
        >
          <Icon name="bell" size={18} stroke={1.8} />
          {attention.length > 0 && <span className={styles.bellDot} aria-hidden="true" />}
        </button>
        <button className={`${styles.account} press`} onClick={connect}>
          <span className={styles.avatar} aria-hidden="true">
            {(accountId ?? VAULT_NAME)[0].toUpperCase()}
          </span>
          <span className={styles.accountText}>
            <span className={styles.accountName}>{accountId ? "Owner wallet" : VAULT_NAME}</span>
            <span className={`mono ${styles.accountSub}`}>{accountId ?? "Connect wallet"}</span>
          </span>
          <Icon name="chevronDown" size={16} />
        </button>
      </div>
    </header>
  );
}

function Search() {
  const router = useRouter();
  const { state } = useVault();
  const calm = useCalm();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        input.current?.focus();
        setOpen(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const q = query.trim().toLowerCase().replace(/^#/, "");
  const results = useMemo(() => {
    if (!state || !q) return [];
    const proposals = state.proposals
      .filter(
        (p) =>
          p.id === q ||
          p.request.payee.toLowerCase().includes(q) ||
          (p.request.memo ?? "").toLowerCase().includes(q) ||
          payeeLabel(state.payees, p).toLowerCase().includes(q) ||
          (p.verdict?.request_hash ?? "").startsWith(q) ||
          (p.verdict?.chat_id ?? "").toLowerCase().includes(q),
      )
      .slice(0, 5)
      .map((p) => ({
        key: `p${p.id}`,
        href: `/app/decisions/${p.id}`,
        title: `${payeeLabel(state.payees, p)} · ${formatShort(p.request.amount, metaOf(state, p.request.asset))}`,
        sub: `#${p.id} · ${STATUS_TEXT[p.status]}${p.request.memo ? ` · ${p.request.memo}` : ""}`,
        icon: "activity" as IconName,
      }));
    const payees = state.payees
      .filter((p) => p.name.toLowerCase().includes(q) || p.address.toLowerCase().includes(q))
      .slice(0, 3)
      .map((p) => ({ key: `y${p.address}`, href: "/app/payees", title: p.name, sub: `${p.chain.toUpperCase()} · ${p.address}`, icon: "users" as IconName }));
    return [...proposals, ...payees];
  }, [state, q]);

  return (
    <div className={styles.search}>
      <Icon name="search" size={17} className={styles.searchIcon} />
      <label htmlFor="global-search" className="visually-hidden">Search payees, decisions and hashes</label>
      <input
        ref={input}
        id="global-search"
        className={styles.searchInput}
        placeholder="Search payees, decisions, hashes"
        value={query}
        autoComplete="off"
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && results[0]) {
            router.push(results[0].href);
            setOpen(false);
            input.current?.blur();
          }
          if (e.key === "Escape") input.current?.blur();
        }}
      />
      <kbd className={styles.kbd}>⌘ K</kbd>
      <AnimatePresence>
        {open && q && (
          <motion.div
            className={styles.results}
            initial={calm ? { opacity: 0 } : { opacity: 0, y: -6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, transition: { duration: 0.12 } }}
            transition={SPRING_UI}
          >
            {results.length === 0 && <span className={styles.noResults}>Nothing matches “{query}”.</span>}
            {results.map((r) => (
              <Link key={r.key} href={r.href} className={styles.result} onClick={() => setOpen(false)}>
                <span className={styles.resultIcon}>
                  <Icon name={r.icon} size={15} />
                </span>
                <span className={styles.resultText}>
                  <span className={styles.resultTitle}>{r.title}</span>
                  <span className={styles.resultSub}>{r.sub}</span>
                </span>
              </Link>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ---------------------------------------------------------- phone tab bar */

const TABS = VAULT_NAV.filter((n) => n.tab);

function TabBar({ visible, onInbox }: { visible: boolean; onInbox: () => void }) {
  const pulse = useDecisionPulse();
  const pathname = usePathname();
  const active = activeHref(pathname);
  const calm = useCalm();
  const left = TABS.slice(0, 2);
  const right = TABS.slice(2);

  const tab = (t: NavItem) => {
    const isActive = t.href === active;
    return (
      <Link key={t.href} href={t.href} className={`${styles.tab} ${isActive ? styles.tabActive : ""}`} aria-current={isActive ? "page" : undefined} aria-label={t.label}>
        {isActive && <motion.span layoutId="tab-well" className={styles.tabWell} transition={SPRING_UI} />}
        <motion.span
          key={isActive ? "on" : "off"}
          className={styles.tabIcon}
          initial={isActive && !calm ? { scale: 0.7, y: 3 } : false}
          animate={{ scale: 1, y: 0 }}
          transition={SPRING_BOUNCE}
        >
          <Icon name={t.icon === "dashboard" ? "home" : t.icon} size={21} stroke={1.8} />
        </motion.span>
        {isActive && <motion.span layoutId="tab-dot" className={styles.tabDot} transition={SPRING_UI} />}
      </Link>
    );
  };

  return (
    <AnimatePresence initial={false}>
      {visible && (
        <motion.nav
          aria-label="Primary"
          className={styles.tabbar}
          initial={calm ? { opacity: 0 } : { y: 130, opacity: 0.6 }}
          animate={{ y: 0, opacity: 1 }}
          exit={calm ? { opacity: 0 } : { y: 130, opacity: 0.6 }}
          transition={calm ? { duration: 0.2 } : SPRING_SURFACE}
        >
          {left.map(tab)}
          <button className={styles.tryIt} onClick={onInbox} aria-label="Try it: open the agent inbox">
            <span key={pulse?.key ?? "still"} className={styles.tryMark} data-pulse={pulse?.tone}>
              <Mark size={30} tone="mono" />
            </span>
          </button>
          {right.map(tab)}
        </motion.nav>
      )}
    </AnimatePresence>
  );
}
