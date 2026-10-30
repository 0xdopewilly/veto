import type { Metadata } from "next";
import { AgentsView } from "@/views/AgentsView";

export const metadata: Metadata = { title: "Agents" };

export default function Page() {
  return <AgentsView />;
}
