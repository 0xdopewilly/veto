import type { Metadata } from "next";
import { ProofView } from "@/views/ProofView";

export const metadata: Metadata = { title: "Proof" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProofView id={id} />;
}
