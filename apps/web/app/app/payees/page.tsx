import type { Metadata } from "next";
import { PayeesView } from "@/views/PayeesView";

export const metadata: Metadata = { title: "Payees" };

export default function Page() {
  return <PayeesView />;
}
