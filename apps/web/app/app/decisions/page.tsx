import type { Metadata } from "next";
import { DecisionsView } from "@/views/DecisionsView";

export const metadata: Metadata = { title: "Decisions" };

export default function Page() {
  return <DecisionsView />;
}
