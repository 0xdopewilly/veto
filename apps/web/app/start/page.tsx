import type { Metadata } from "next";
import { WelcomeView } from "@/views/StartViews";

export const metadata: Metadata = { title: "Welcome" };

export default function Page() {
  return <WelcomeView />;
}
