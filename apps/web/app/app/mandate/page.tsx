import type { Metadata } from "next";
import { MandateView } from "@/views/MandateView";

export const metadata: Metadata = { title: "Mandate" };

export default function Page() {
  return <MandateView />;
}
