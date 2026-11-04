import type { Metadata } from "next";
import { RulesView } from "@/views/RulesView";

export const metadata: Metadata = { title: "Rules" };

export default function Page() {
  return <RulesView />;
}
