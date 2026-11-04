import { redirect } from "next/navigation";

// Suppliers now live on Rules, with the mandate, limits and freeze.
export default function Page() {
  redirect("/app/rules#suppliers");
}
