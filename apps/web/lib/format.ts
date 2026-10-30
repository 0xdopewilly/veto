export interface AssetMeta {
  symbol: string;
  decimals: number;
}

export const NATIVE: AssetMeta = { symbol: "NEAR", decimals: 24 };

const isDollar = (meta: AssetMeta) => meta.symbol.toUpperCase().includes("USD");

function split(raw: bigint, decimals: number, places: number) {
  const negative = raw < 0n;
  const value = negative ? -raw : raw;
  const base = 10n ** BigInt(decimals);
  const whole = value / base;
  const frac = (value % base).toString().padStart(decimals, "0").slice(0, places).padEnd(places, "0");
  return { negative, whole, frac };
}

/** "$300.00" for dollar tokens, "0.30 NEAR" otherwise. */
export function formatAmount(raw: string | bigint, meta: AssetMeta, opts: { symbol?: boolean } = {}): string {
  const { negative, whole, frac } = split(BigInt(raw), meta.decimals, 2);
  const number = `${negative ? "-" : ""}${whole.toLocaleString("en-US")}.${frac}`;
  if (isDollar(meta)) return `${negative ? "-" : ""}$${whole.toLocaleString("en-US")}.${frac}`;
  return opts.symbol === false ? number : `${number} ${meta.symbol}`;
}

/** Whole part and cents separately, for the large balance figure. */
export function formatParts(raw: string | bigint, meta: AssetMeta) {
  const { whole, frac } = split(BigInt(raw), meta.decimals, 2);
  return { prefix: isDollar(meta) ? "$" : "", whole: whole.toLocaleString("en-US"), cents: `.${frac}`, suffix: isDollar(meta) ? "" : meta.symbol };
}

/** Short amount for sentences: "$300" or "0.3 NEAR". */
export function formatShort(raw: string | bigint, meta: AssetMeta): string {
  const { whole, frac } = split(BigInt(raw), meta.decimals, 2);
  const trimmed = frac.replace(/0+$/, "");
  const number = `${whole.toLocaleString("en-US")}${trimmed ? `.${trimmed}` : ""}`;
  return isDollar(meta) ? `$${number}` : `${number} ${meta.symbol}`;
}

export function shortAddress(address: string): string {
  if (/^0x[0-9a-fA-F]{40}$/.test(address)) return `${address.slice(0, 6)}…${address.slice(-4)}`;
  if (address.length > 28) return `${address.slice(0, 12)}…${address.slice(-10)}`;
  return address;
}

export const shortHash = (hash: string) => (hash.length > 12 ? `${hash.slice(0, 4)}…${hash.slice(-4)}` : hash);

const nsToMs = (ns: string | bigint) => Number(BigInt(ns) / 1_000_000n);

const sameDay = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

const clock = (d: Date) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

/** "Today, 14:32", "Yesterday", "Mon 3 Nov". */
export function formatWhen(ns: string | bigint, now = new Date()): string {
  const d = new Date(nsToMs(ns));
  if (sameDay(d, now)) return `Today, ${clock(d)}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, yesterday)) return "Yesterday";
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

/** "2 min ago", "3h", "1d". */
export function formatAgo(ns: string | bigint, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - nsToMs(ns)) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
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
