import type { Metadata } from "next";
import { VaultSetupView } from "@/views/StartViews";

export const metadata: Metadata = { title: "Your vault" };

export default function Page() {
  return <VaultSetupView />;
}
