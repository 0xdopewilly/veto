import type { Metadata } from "next";
import { BenchView } from "@/views/BenchView";

export const metadata: Metadata = {
  title: "Veto Bench",
  description: "100 payment scenarios, half attacks and half ordinary payments, scoring how well each model screens them.",
};

export default function Page() {
  return <BenchView />;
}
