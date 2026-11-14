import type { Metadata } from "next";
import { DecisionView } from "@/views/DecisionView";
import { isKnownVault, SANDBOX_ID } from "@/lib/config";
import { listedPayee, outcomeOf, reasonText } from "@/lib/decision";
import { formatShort, shortAddress } from "@/lib/format";
import { vaultSnapshot } from "@/lib/server/state";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

const within = <T,>(ms: number, p: Promise<T>) => Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), ms))]);

/**
 * A shared decision previews as what happened: "Veto stopped $300 to kano-c0tton…", its reasons,
 * and a card drawn from the payment itself. Anything slow or missing falls back to the plain title.
 */
export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { id } = await params;
  const asked = (await searchParams).vault;
  const vault = typeof asked === "string" && isKnownVault(asked) ? asked : SANDBOX_ID;
  const plain: Metadata = { title: "Decision" };
  if (!/^\d{1,10}$/.test(id)) return plain;
  const snap = await within(2500, vaultSnapshot(vault).catch(() => null));
  const p = snap?.state.proposals.find((x) => x.id === id);
  if (!snap || !p) return plain;
  const meta = snap.state.assets[p.request.asset];
  const amount = meta ? formatShort(p.request.amount, meta) : "a payment";
  const to = listedPayee(snap.state.payees, p)?.name ?? shortAddress(p.request.payee);
  const vetoed = outcomeOf(p.status) === "vetoed";
  const title = vetoed ? `Veto stopped ${amount} to ${to}` : p.status === "Paid" ? `Veto passed ${amount} to ${to}` : `Payment #${id}: ${amount} to ${to}`;
  const description = vetoed
    ? `${(p.verdict?.reasons ?? []).map(reasonText).join(". ")}. Nothing moved: the AI that said no ran in NEAR AI's enclave, and the vault checked its signature on-chain.`
    : "Screened by an AI in NEAR AI's enclave whose signature the vault checks on-chain. The decision, the email it read and the proof.";
  const image = `/api/card?vault=${encodeURIComponent(vault)}&id=${id}`;
  return {
    title,
    description,
    openGraph: { title, description, images: [{ url: image, width: 1200, height: 630, alt: title }] },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

export default async function Page({ params }: Props) {
  const { id } = await params;
  return <DecisionView id={id} />;
}
