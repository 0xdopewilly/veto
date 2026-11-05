import type { Metadata } from "next";
import { DocsView } from "@/views/DocsView";

export const metadata: Metadata = {
  title: "Docs",
  description: "What Veto is, how a payment is screened and decided on NEAR, how to check a decision, and how to try it on testnet.",
};

export default function Page() {
  return <DocsView />;
}
