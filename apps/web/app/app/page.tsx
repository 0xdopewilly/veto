import type { Metadata } from "next";
import { HomeView } from "@/views/HomeView";

export const metadata: Metadata = { title: "Overview" };

export default function Page() {
  return <HomeView />;
}
