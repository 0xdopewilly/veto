import type { Metadata } from "next";
import { DecisionsView } from "@/views/DecisionsView";

export const metadata: Metadata = { title: "Activity" };

export default function Page() {
  return <DecisionsView />;
}
