// The link-preview image for a shared decision ("Veto stopped $300 to an address one letter off a
// supplier's") and for the challenge page. A catch posted on X shows what was stopped and why, and
// links back to the decision with its proof.
//   /api/card?vault=<vault>&id=<proposal>   one decision
//   /api/card?challenge=1                   "Can you fool Veto?" with the sandbox's running totals
import { ImageResponse } from "next/og";
import { VaultReader } from "@veto/core/vault";
import type { Proposal } from "@veto/core/proposal";
import { AGENT_INBOX } from "@/lib/challenge";
import { isKnownVault, SANDBOX_ID } from "@/lib/config";
import { listedPayee, outcomeOf, reasonText } from "@/lib/decision";
import { formatShort, type AssetMeta } from "@/lib/format";
import { challengeStats } from "@/lib/server/challenge";
import { serverRpc } from "@/lib/server/rpc";
import { vaultSnapshot } from "@/lib/server/state";

export const runtime = "nodejs";

const W = 1200;
const H = 630;
const INK = "#000000";
const SAND = "#f2f1e9";
const CORAL = "#ff7966";
const GREEN = "#00ec97";
const MUTED = "#acaba6";

type Font = { name: string; data: ArrayBuffer; weight: 500 | 700 | 800; style: "normal" };
let fonts: Promise<Font[]> | null = null;

/** The site's own fonts, served from /fonts, read once per instance. */
function loadFonts(origin: string): Promise<Font[]> {
  const get = (file: string) => fetch(`${origin}/fonts/${file}`).then((r) => {
    if (!r.ok) throw new Error(`font ${file}: ${r.status}`);
    return r.arrayBuffer();
  });
  fonts ??= Promise.all([
    get("MonaSans-Medium.ttf").then((data): Font => ({ name: "Mona", data, weight: 500, style: "normal" })),
    get("MonaSans-Bold.ttf").then((data): Font => ({ name: "Mona", data, weight: 700, style: "normal" })),
    get("MonaSans-ExtraBoldWide.ttf").then((data): Font => ({ name: "MonaWide", data, weight: 800, style: "normal" })),
    get("JetBrainsMono-Medium.ttf").then((data): Font => ({ name: "Mono", data, weight: 500, style: "normal" })),
  ]).catch((e) => {
    fonts = null;
    throw e;
  });
  return fonts;
}

/** The mark: two strokes meeting in one V, the payer's and Veto's. */
function Mark({ size, payer, veto }: { size: number; payer: string; veto: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64">
      <path d="M17 14 32 50" stroke={payer} strokeWidth={11} strokeLinecap="round" fill="none" />
      <path d="M47 14 32 50" stroke={veto} strokeWidth={11} strokeLinecap="round" fill="none" />
    </svg>
  );
}

function Brand({ ink, payer, veto, right }: { ink: string; payer: string; veto: string; right: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
        <Mark size={52} payer={payer} veto={veto} />
        <span style={{ fontFamily: "Mona", fontWeight: 700, fontSize: 34, color: ink, letterSpacing: -1 }}>Veto</span>
      </div>
      <span style={{ fontFamily: "Mona", fontWeight: 500, fontSize: 24, color: ink, opacity: 0.72 }}>{right}</span>
    </div>
  );
}

const fullOrShort = (address: string) => (address.length <= 40 ? address : `${address.slice(0, 18)}…${address.slice(-14)}`);

async function proposalFor(vault: string, id: string): Promise<{ p: Proposal; meta: AssetMeta; payee: string | null } | null> {
  const { state } = await vaultSnapshot(vault);
  const p = state.proposals.find((x) => x.id === id) ?? (await new VaultReader(vault, serverRpc()).proposal(id));
  if (!p) return null;
  const meta = state.assets[p.request.asset] ?? { symbol: p.request.asset.split(":").pop()?.toUpperCase() ?? "", decimals: 0 };
  return { p, meta, payee: listedPayee(state.payees, p)?.name ?? null };
}

function DecisionCard({ p, meta, payee }: { p: Proposal; meta: AssetMeta; payee: string | null }) {
  const vetoed = outcomeOf(p.status) === "vetoed";
  const bg = vetoed ? CORAL : INK;
  const ink = vetoed ? INK : SAND;
  const reasons = (p.verdict?.reasons ?? []).slice(0, 3).map(reasonText);
  const amount = formatShort(p.request.amount, meta);
  const word = vetoed ? "VETOED" : p.status === "Paid" ? "PAID" : p.status === "OverridePending" ? "HELD" : "SCREENED";
  return (
    <div style={{ width: W, height: H, display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "52px 64px 48px", background: bg, color: ink }}>
      <Brand ink={ink} payer={vetoed ? INK : SAND} veto={vetoed ? SAND : CORAL} right={`Payment #${p.id}`} />
      <div style={{ display: "flex", flexDirection: "column" }}>
        <span style={{ fontFamily: "MonaWide", fontWeight: 800, fontSize: 150, lineHeight: 0.9, letterSpacing: -5, color: vetoed ? INK : GREEN }}>{word}</span>
        <div style={{ display: "flex", alignItems: "baseline", gap: 18, marginTop: 18 }}>
          <span style={{ fontFamily: "Mona", fontWeight: 700, fontSize: 64, letterSpacing: -2 }}>{amount}</span>
          <span style={{ fontFamily: "Mona", fontWeight: 500, fontSize: 30, opacity: 0.72 }}>to</span>
          <span style={{ fontFamily: payee ? "Mona" : "Mono", fontWeight: payee ? 700 : 500, fontSize: payee ? 40 : 30 }}>{payee ?? fullOrShort(p.request.payee)}</span>
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {(vetoed ? reasons : ["Matched the mandate, the payee list and the payment history"]).map((r) => (
          <div key={r} style={{ display: "flex", alignItems: "center", gap: 14, fontFamily: "Mona", fontWeight: 500, fontSize: 27 }}>
            <div style={{ width: 10, height: 10, borderRadius: 5, background: vetoed ? INK : GREEN }} />
            <span>{r}</span>
          </div>
        ))}
        <span style={{ marginTop: 14, fontFamily: "Mona", fontWeight: 500, fontSize: 22, opacity: 0.72 }}>
          {vetoed
            ? "Nothing moved. Screened in NEAR AI's enclave; the vault checked the signature on-chain."
            : "Within the caps. Screened in NEAR AI's enclave; the vault checked the signature on-chain."}
        </span>
      </div>
    </div>
  );
}

function ChallengeCard({ asked, vetoed, paid }: { asked: number | null; vetoed: number | null; paid: number | null }) {
  const figure = (label: string, n: number | null, color: string) => (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={{ fontFamily: "Mona", fontWeight: 500, fontSize: 24, color: MUTED }}>{label}</span>
      <span style={{ fontFamily: "Mona", fontWeight: 700, fontSize: 72, letterSpacing: -3, color }}>{n === null ? "–" : n.toLocaleString("en-US")}</span>
    </div>
  );
  return (
    <div style={{ width: W, height: H, display: "flex", flexDirection: "column", justifyContent: "space-between", padding: "52px 64px 48px", background: INK, color: SAND }}>
      <Brand ink={SAND} payer={SAND} veto={CORAL} right="veto-beta.vercel.app/challenge" />
      <div style={{ display: "flex", flexDirection: "column" }}>
        <span style={{ fontFamily: "MonaWide", fontWeight: 800, fontSize: 112, lineHeight: 0.95, letterSpacing: -4 }}>Can you fool Veto?</span>
        <span style={{ marginTop: 22, fontFamily: "Mona", fontWeight: 500, fontSize: 30, color: MUTED }}>
          Email the agent a scam. Six tricks real invoice fraud uses.
        </span>
        <span style={{ marginTop: 8, fontFamily: "Mono", fontWeight: 500, fontSize: 30, color: SAND }}>{AGENT_INBOX}</span>
      </div>
      <div style={{ display: "flex", gap: 72 }}>
        {figure("Payments asked for", asked, SAND)}
        {figure("Vetoed", vetoed, CORAL)}
        {figure("Paid", paid, GREEN)}
      </div>
    </div>
  );
}

const CACHE = { "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=86400" };

export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = url.origin;
  try {
    const loaded = await loadFonts(origin);
    if (url.searchParams.get("challenge")) {
      const s = await challengeStats().catch(() => null);
      return new ImageResponse(<ChallengeCard asked={s?.asked ?? null} vetoed={s?.vetoed ?? null} paid={s?.paid ?? null} />, { width: W, height: H, fonts: loaded, headers: CACHE });
    }
    const vault = url.searchParams.get("vault") || SANDBOX_ID;
    const id = url.searchParams.get("id") ?? "";
    if (!isKnownVault(vault) || !/^\d{1,10}$/.test(id)) return Response.redirect(`${origin}/og.png`, 302);
    const found = await proposalFor(vault, id);
    if (!found) return Response.redirect(`${origin}/og.png`, 302);
    return new ImageResponse(<DecisionCard {...found} />, { width: W, height: H, fonts: loaded, headers: CACHE });
  } catch (e) {
    console.error("card failed:", (e as Error).message);
    return Response.redirect(`${origin}/og.png`, 302);
  }
}
