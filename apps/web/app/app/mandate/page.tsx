import { redirect } from "next/navigation";

// The mandate now lives on Rules, with the limits, suppliers and freeze.
export default function Page() {
  redirect("/app/rules#mandate");
}
