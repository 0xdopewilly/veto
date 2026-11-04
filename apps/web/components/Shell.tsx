"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { VaultProvider, useVault, needsDecision } from "@/lib/vault";
import { WalletProvider, useVaultKind, useWallet } from "@/lib/wallet";
import { DemoProvider } from "@/lib/demoClient";
import { useKeptBlocked } from "@/lib/dismissed";
import { NETWORK } from "@/lib/config";
import { payeeLabel, STATUS_TEXT } from "@/lib/decision";
import { metaOf } from "@/lib/vault";
import { formatShort, chainLabel } from "@/lib/format";
import { SPRING_BOUNCE, SPRING_SURFACE, SPRING_UI, useCalm } from "@/lib/motion";
import { Lockup, Mark } from "./Logo";
import { useDecisionPulse } from "@/lib/pulse";
import { useStartHint } from "@/lib/hint";
import { recordPath } from "@/lib/backTo";
import { ABOUT_LINKS } from "@/lib/nav";
import { Icon, type IconName } from "./Icon";
import { RouteStage, levelOf } from "./RouteStage";
import { FreezeSheet } from "./FreezeSheet";
import { VaultSwitcher } from "./VaultSwitcher";
import { InboxSheet } from "./AgentInbox";
import { NotificationsSheet } from "./NotificationsSheet";
import { WalletSheet } from "./WalletSheet";
import { MorphOverlay } from "./MorphOverlay";
import { Spotlight } from "./Spotlight";
import { ToastProvider, useToast } from "./Toaster";
import styles from "./Shell.module.css";

interface ShellApi {
  openFreeze: () => void;
  openInbox: () => void;
  openVaults: () => void;
  /** The bell: what needs a decision, then recent payments. */
  openNotes: () => void;
  /** The connected wallet's sheet; connects one first if there's none. */
  openWallet: () => void;
}
const noop = () => {};
const ShellContext = createContext<ShellApi>({ openFreeze: noop, openInbox: noop, openVaults: noop, openNotes: noop, openWallet: noop });
export const useShell = () => useContext(ShellContext);

interface NavItem {
  href: string;
  label: string;
  icon?: IconName;
  tab?: boolean;
  external?: boolean;
}

// One structure on phone and desktop: Home, Activity, Rules, Agents. Trying the agent is the V
// button on phones and the first button in the sidebar on desktop.
const VAULT_NAV: NavItem[] = [
  { href: "/app", label: "Home", icon: "home", tab: true },
  { href: "/app/decisions", label: "Activity", icon: "activity", tab: true },
  { href: "/app/rules", label: "Rules", icon: "shield", tab: true },
  { href: "/app/agents", label: "Agents", icon: "bot", tab: true },
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
            <GasToast />
            <ShellFrame>{children}</ShellFrame>
          </ToastProvider>
        </DemoProvider>
      </WalletProvider>
    </VaultProvider>
  );
}

/** Shows the free gas an empty wallet is sent on connect (see GasStatus in lib/wallet). */
function GasToast() {
  const { gas } = useWallet();
  const { track } = useToast();
  const pending = useRef<{ resolve: () => void; reject: (e: Error) => void } | null>(null);

  useEffect(() => {
    if (gas.state === "sending" && !pending.current) {
      void track({
        pending: "Your wallet is low on test NEAR. Sending it some for gas",
        success: "Sent your wallet 0.3 test NEAR for gas, free",
        run: () => new Promise<void>((resolve, reject) => (pending.current = { resolve, reject })),
      });
    } else if (gas.state === "sent") {
      pending.current?.resolve();
      pending.current = null;
    } else if (gas.state === "failed") {
      pending.current?.reject(new Error(gas.reason));
      pending.current = null;
    }
  }, [gas, track]);
  return null;
}

function ShellFrame({ children }: { children: ReactNode }) {
  const [freezeOpen, setFreezeOpen] = useState(false);
  const [vaultsOpen, setVaultsOpen] = useState(false);
  const pathname = usePathname();
  // The inbox belongs to the page it was opened on, so following a link out of it closes it.
  const [inboxAt, setInboxAt] = useState<string | null>(null);
  const inboxOpen = inboxAt === pathname;
  // Same for notifications: opening a payment from the list closes it.
  const [notesAt, setNotesAt] = useState<string | null>(null);
  const [walletOpen, setWalletOpen] = useState(false);
  const { accountId, connect } = useWallet();
  const showTabs = levelOf(pathname) === 0;
  useEffect(() => recordPath(pathname), [pathname]);
  const api = useMemo(
    () => ({
      openFreeze: () => setFreezeOpen(true),
      openInbox: () => setInboxAt(pathname),
      openVaults: () => setVaultsOpen(true),
      openNotes: () => setNotesAt(pathname),
      openWallet: () => (accountId ? setWalletOpen(true) : void connect()),
    }),
    [pathname, accountId, connect],
  );

  return (
    <ShellContext.Provider value={api}>
      <div className={styles.shell}>
        <Sidebar onFreeze={api.openFreeze} onVaults={api.openVaults} onInbox={api.openInbox} />
        <div className={styles.main}>
          <TopBar />
          <RouteStage>{children}</RouteStage>
        </div>
        <TabBar visible={showTabs} onInbox={api.openInbox} />
      </div>
      <FreezeSheet open={freezeOpen} onClose={() => setFreezeOpen(false)} />
      <VaultSwitcher open={vaultsOpen} onClose={() => setVaultsOpen(false)} />
      <InboxSheet open={inboxOpen} onClose={() => setInboxAt(null)} />
      <NotificationsSheet open={notesAt === pathname} onClose={() => setNotesAt(null)} />
      <WalletSheet open={walletOpen} onClose={() => setWalletOpen(false)} onVaults={api.openVaults} />
      <MorphOverlay />
      <Spotlight />
    </ShellContext.Provider>
  );
}

/* --------------------------------------------------------------- sidebar */

function Sidebar({ onFreeze, onVaults, onInbox }: { onFreeze: () => void; onVaults: () => void; onInbox: () => void }) {
  const pathname = usePathname();
  const active = activeHref(pathname);
  const { state, vaultId, vaultName } = useVault();
  const kind = useVaultKind();
  const frozen = state?.config.frozen;

  const item = (n: NavItem) => {
    const isActive = !n.external && n.href === active && pathname.startsWith("/app");
    const content = (
      <>
        {isActive && <motion.span layoutId="sidebar-pill" className={styles.navPill} transition={SPRING_UI} />}
        {n.icon && <Icon name={n.icon} size={19} stroke={1.75} />}
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
      <button type="button" className={`${styles.vaultCard} press`} onClick={onVaults} aria-label={`${vaultName}. Switch vault`}>
        <span className={styles.vaultTop}>
          <span className={styles.vaultName}>{vaultName}</span>
          <Icon name="chevronDown" size={15} className={styles.vaultChevron} />
        </span>
        <span className={`mono ${styles.vaultId}`}>{vaultId ?? "\u00a0"}</span>
        <span className={styles.vaultKind} data-mine={kind.mine || undefined}>
          {kind.label}
        </span>
        <span className={styles.status}>
          <span className={styles.statusDot} data-frozen={frozen || undefined} aria-hidden="true" />
          {frozen ? "Payments frozen" : "Screening every payment"}
        </span>
      </button>
      <button type="button" className={`${styles.tryAgent} press`} onClick={onInbox}>
        <span className={styles.tryAgentMark} aria-hidden="true">
          <Mark size={18} />
        </span>
        <span className={styles.tryAgentText}>
          <strong>Try the agent</strong>
          <span>Invoices and salaries</span>
        </span>
        <Icon name="arrowRight" size={16} />
      </button>
      <nav aria-label="Primary" className={styles.nav}>
        {VAULT_NAV.map(item)}
      </nav>
      <div className={styles.sideFoot}>
        <button className={`${styles.footButton} ${frozen ? styles.footAlarm : ""} press`} onClick={onFreeze}>
          <Icon name={frozen ? "unlock" : "lock"} size={17} />
          {frozen ? "Unfreeze payments" : "Freeze all payments"}
        </button>
        <nav aria-label="About Veto" className={styles.footLinks}>
          {ABOUT_LINKS.map((n) =>
            n.external ? (
              <a key={n.href} href={n.href} target="_blank" rel="noreferrer">
                {n.label}
              </a>
            ) : (
              <Link key={n.href} href={n.href}>
                {n.label}
              </Link>
            ),
          )}
        </nav>
      </div>
    </aside>
  );
}

/* ---------------------------------------------------------------- top bar */

function TopBar() {
  const { state } = useVault();
  const { kept } = useKeptBlocked();
  const { accountId, isOwner } = useWallet();
  const { openNotes, openWallet } = useShell();
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
          aria-label={attention.length ? `Notifications: ${attention.length} payment${attention.length === 1 ? "" : "s"} need your decision` : "Notifications"}
          onClick={openNotes}
        >
          <Icon name="bell" size={18} stroke={1.8} />
          {attention.length > 0 && <span className={styles.bellDot} aria-hidden="true" />}
        </button>
        {accountId ? (
          <button className={`${styles.account} press`} onClick={openWallet}>
            <span className={styles.avatar} aria-hidden="true">
              {accountId[0].toUpperCase()}
            </span>
            <span className={styles.accountText}>
              <span className={styles.accountName}>{isOwner ? "Owner wallet" : "Your wallet"}</span>
              <span className={`mono ${styles.accountSub}`}>{accountId}</span>
            </span>
            <Icon name="chevronDown" size={16} />
          </button>
        ) : (
          <button className={`${styles.connectWallet} press`} onClick={openWallet}>
            <Icon name="wallet" size={17} />
            Connect wallet
          </button>
        )}
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
      .map((p) => ({ key: `y${p.address}`, href: "/app/rules#payees", title: p.name, sub: `${chainLabel(p.chain)} · ${p.address}`, icon: "users" as IconName }));
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
  const hint = useStartHint();
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
          <Icon name={t.icon ?? "home"} size={21} stroke={1.8} />
        </motion.span>
        {isActive && <motion.span layoutId="tab-dot" className={styles.tabDot} transition={SPRING_UI} />}
      </Link>
    );
  };

  return (
    <AnimatePresence initial={false}>
      {visible && (
        <motion.div
          key="scrim"
          className={styles.tabScrim}
          aria-hidden="true"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.28, ease: [0.2, 0, 0, 1] }}
        />
      )}
      {visible && (
        <motion.nav
          key="nav"
          aria-label="Primary"
          className={styles.tabbar}
          initial={calm ? { opacity: 0 } : { y: 130, opacity: 0.6 }}
          animate={{ y: 0, opacity: 1 }}
          exit={calm ? { opacity: 0 } : { y: 130, opacity: 0.6 }}
          transition={calm ? { duration: 0.2 } : SPRING_SURFACE}
        >
          {left.map(tab)}
          <button
            className={styles.tryIt}
            data-hint={(hint.show && pathname === "/app") || undefined}
            onClick={() => {
              hint.done();
              onInbox();
            }}
            aria-label="Try it: open the agent inbox"
          >
            {/* Only on Home: elsewhere it would sit on top of the page's own buttons. */}
            {hint.show && pathname === "/app" && (
              <span className={styles.hintBubble} aria-hidden="true">
                Start here
              </span>
            )}
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
