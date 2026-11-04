import { redirect } from "next/navigation";

// The mandate now lives on Rules, with the limits, payees and freeze.
export default function Page() {
  redirect("/app/rules#mandate");
}
