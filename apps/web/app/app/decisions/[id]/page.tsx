import type { Metadata } from "next";
import { DecisionView } from "@/views/DecisionView";

export const metadata: Metadata = { title: "Decision" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <DecisionView id={id} />;
}
