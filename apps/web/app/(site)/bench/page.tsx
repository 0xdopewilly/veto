import type { Metadata } from "next";
import { BenchView, type BenchResults } from "@/views/BenchView";
// Built into the page, so the numbers are in its HTML (bench/publish.ts writes this file).
import results from "@/public/bench/results.json";

export const metadata: Metadata = {
  title: "Veto Bench",
  description: "100 payment scenarios, half attacks and half ordinary payments, scoring how well each model screens them.",
};

export default function Page() {
  return <BenchView results={results as BenchResults} />;
}
