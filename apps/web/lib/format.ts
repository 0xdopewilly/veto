export interface AssetMeta {
  symbol: string;
  decimals: number;
}

export const NATIVE: AssetMeta = { symbol: "NEAR", decimals: 24 };

const isDollar = (meta: AssetMeta) => meta.symbol.toUpperCase().includes("USD");

/** Rounds half up to `places` decimals. */
function split(raw: bigint, decimals: number, places: number) {
  const negative = raw < 0n;
  const value = negative ? -raw : raw;
  const base = 10n ** BigInt(decimals);
  const scale = 10n ** BigInt(places);
  const q = places >= decimals ? value * 10n ** BigInt(places - decimals) : (value * scale + base / 2n) / base;
  const whole = q / scale;
  const frac = places ? (q % scale).toString().padStart(places, "0") : "";
  return { negative, whole, frac };
}

/**
 * Decimal places for an amount, one rule app-wide:
 * dollars take two ("$2.02", never "$2.019738"), except a real sub-cent amount under a dollar
 * keeps up to four ("$0.075", "$0.0024"); other tokens take two from 1 up ("5.13 NEAR") and three
 * significant digits below ("0.0159 ETH", "0.0001 ETH").
 */
function placesFor(raw: bigint, meta: AssetMeta) {
  const value = raw < 0n ? -raw : raw;
  const base = 10n ** BigInt(meta.decimals);
  if (value === 0n || value >= base) return Math.min(2, meta.decimals);
  const digits = value.toString().padStart(meta.decimals, "0");
  if (isDollar(meta)) return Math.min(meta.decimals, Math.max(2, Math.min(4, digits.replace(/0+$/, "").length)));
  const zeros = digits.length - digits.replace(/^0+/, "").length;
  return Math.min(meta.decimals, Math.max(2, zeros + 3));
}

/** Drops trailing zeros past the second decimal: "0.01590" becomes "0.0159", "0.50" stays. */
const trimTail = (frac: string) => (frac.length > 2 ? frac.replace(/0+$/, "").padEnd(2, "0") : frac);

/** A dollar figure divided down for the Agent API demo, to the digit: "180.00" at 1:2000 is "0.09", "150.00" is "0.075". */
export function scaleDollars(amount: string, scale: number): string {
  const [whole, frac = ""] = (Number(amount.replace(/,/g, "")) / scale).toFixed(6).replace(/0+$/, "").split(".");
  return `${whole}.${frac.padEnd(2, "0")}`;
}

/** Lists, tables and detail rows: "$300.00", "$0.075", "5.13 NEAR", "0.0001 ETH". Never "$… USDC". */
export function formatAmount(raw: string | bigint, meta: AssetMeta, opts: { symbol?: boolean } = {}): string {
  const { negative, whole, frac: f } = split(BigInt(raw), meta.decimals, placesFor(BigInt(raw), meta));
  const frac = trimTail(f);
  const sign = negative ? "-" : "";
  const number = `${whole.toLocaleString("en-US")}${frac ? `.${frac}` : ""}`;
  if (isDollar(meta)) return `${sign}$${number}`;
  return opts.symbol === false ? `${sign}${number}` : `${sign}${number} ${meta.symbol}`;
}

/** Whole part and cents separately, for a large figure. Dollars carry a "$" and no unit. */
export function formatParts(raw: string | bigint, meta: AssetMeta) {
  const { whole, frac } = split(BigInt(raw), meta.decimals, placesFor(BigInt(raw), meta));
  const cents = trimTail(frac);
  return { prefix: isDollar(meta) ? "$" : "", whole: whole.toLocaleString("en-US"), cents: cents ? `.${cents}` : "", suffix: isDollar(meta) ? "" : meta.symbol };
}

/** Sentences, banners and big round figures: "$1,341", "$0.09", "0.5 NEAR". */
export function formatShort(raw: string | bigint, meta: AssetMeta): string {
  const { negative, whole, frac } = split(BigInt(raw), meta.decimals, placesFor(BigInt(raw), meta));
  const trimmed = /^0*$/.test(frac) ? "" : isDollar(meta) ? trimTail(frac) : frac.replace(/0+$/, "");
  const sign = negative ? "-" : "";
  const number = `${whole.toLocaleString("en-US")}${trimmed ? `.${trimmed}` : ""}`;
  return isDollar(meta) ? `${sign}$${number}` : `${sign}${number} ${meta.symbol}`;
}

export const isDollarAsset = isDollar;

const CHAIN_NAMES: Record<string, string> = {
  near: "NEAR",
  base: "Base",
  "base-sepolia": "Base Sepolia",
  arbitrum: "Arbitrum",
  ethereum: "Ethereum",
  sepolia: "Sepolia",
  solana: "Solana",
};

/** "base-sepolia" -> "Base Sepolia". */
export const chainLabel = (id: string) =>
  CHAIN_NAMES[id.toLowerCase()] ?? id.replace(/(^|-)([a-z])/g, (_, dash: string, c: string) => `${dash ? " " : ""}${c.toUpperCase()}`);

/**
 * Accounts under the vault's own parent read as their first name: "settlements", "kano-cottom",
 * not "settlements.veto-rhwe0krb.testnet". Accounts anywhere else keep their full name, so a
 * stranger's account stands out. Set by the vault provider when a vault opens.
 */
let accountRoot = "";
export function setAccountRoot(vaultId: string) {
  accountRoot = vaultId.includes(".") ? vaultId.slice(vaultId.indexOf(".") + 1) : "";
}

/** One shortening rule for every address: "settlements", "0x3d97…19B8", "a-long-name.…near". Display only. */
export function shortAddress(address: string): string {
  if (/^0x[0-9a-fA-F]{40}$/.test(address)) return `${address.slice(0, 6)}…${address.slice(-4)}`;
  if (accountRoot && address.endsWith(`.${accountRoot}`)) {
    const name = address.slice(0, -accountRoot.length - 1);
    if (name && !name.includes(".")) return name;
  }
  if (/^[0-9a-f]{64}$/.test(address)) return `${address.slice(0, 6)}…${address.slice(-4)}`;
  if (address.length > 28) return `${address.slice(0, 10)}…${address.slice(-8)}`;
  return address;
}

/** Hashes and keys: "bde1a1…cb3b". */
export const shortHash = (hash: string) => (hash.length > 14 ? `${hash.slice(0, 6)}…${hash.slice(-4)}` : hash);

const nsToMs = (ns: string | bigint) => Number(BigInt(ns) / 1_000_000n);

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

const clock = (d: Date) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

function dayOf(d: Date, now: Date): { day: string; relative: boolean } {
  if (sameDay(d, now)) return { day: "Today", relative: true };
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, yesterday)) return { day: "Yesterday", relative: true };
  const opts: Intl.DateTimeFormatOptions =
    d.getFullYear() === now.getFullYear() ? { weekday: "short", day: "numeric", month: "short" } : { day: "numeric", month: "short", year: "numeric" };
  return { day: d.toLocaleDateString("en-GB", opts).replace(",", ""), relative: false };
}

/** Lists and detail pages, always with the time: "Today, 14:32", "Yesterday, 09:12", "Mon 3 Nov, 14:08", "3 Nov 2025, 14:08". */
export function formatWhen(ns: string | bigint, now = new Date()): string {
  const d = new Date(nsToMs(ns));
  return `${dayOf(d, now).day}, ${clock(d)}`;
}

/** Inside a sentence: "today at 14:32", "yesterday at 09:12", "on Mon 3 Nov at 14:08". */
export function formatWhenInline(ns: string | bigint, now = new Date()): string {
  const d = new Date(nsToMs(ns));
  const { day, relative } = dayOf(d, now);
  return `${relative ? day.toLowerCase() : `on ${day}`} at ${clock(d)}`;
}

/** A date alone: "11 Nov 2026". */
export const formatDate = (d: Date) => d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

/** Live status lines only (banners, toasts): "just now", "2 min ago", "3 h ago", "2 d ago". */
export function formatAgo(ns: string | bigint, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - nsToMs(ns)) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  return `${Math.floor(seconds / 86400)} d ago`;
}

export function formatTime(ns: string | bigint): string {
  return clock(new Date(nsToMs(ns)));
}

/** Remaining time to a nanosecond timestamp, split for the countdown display. */
export function remaining(targetNs: string | bigint, now = Date.now()) {
  const ms = Math.max(0, nsToMs(targetNs) - now);
  const total = Math.floor(ms / 1000);
  return { done: ms === 0, hours: Math.floor(total / 3600), minutes: Math.floor((total % 3600) / 60), seconds: total % 60 };
}

/** "24 hours", "3 minutes", "90 seconds". */
export function formatDuration(secs: number): string {
  if (secs % 3600 === 0 && secs >= 3600) return `${secs / 3600} hour${secs === 3600 ? "" : "s"}`;
  if (secs % 60 === 0 && secs >= 60) return `${secs / 60} minute${secs === 60 ? "" : "s"}`;
  return `${secs} seconds`;
}

export const nsToDate = (ns: string | bigint) => new Date(nsToMs(ns));

/** "Kano Cotton Mills' address", "Aba's address". */
export const possessive = (name: string) => (name.endsWith("s") ? `${name}'` : `${name}'s`);
