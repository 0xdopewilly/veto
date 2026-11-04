import type { Metadata } from "next";
import { VaultSetupView } from "@/views/StartViews";

export const metadata: Metadata = { title: "Create your vault" };

export default function Page() {
  return <VaultSetupView />;
}
