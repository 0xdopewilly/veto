import type { Metadata } from "next";
import { ChallengeView } from "@/views/ChallengeView";
import { challengeStats } from "@/lib/server/challenge";

// The counts are read from the sandbox vault on NEAR testnet, so the page is rebuilt at most every
// 30 seconds rather than at build time only.
export const revalidate = 30;

const description =
  "Email Veto's agent a scam: a changed bank account, a lookalike address, an invoice already paid, a hidden instruction. Six tricks real invoice fraud uses, each with an email to start from and a live count of how often Veto has caught it.";

export const metadata: Metadata = {
  title: "Can you fool Veto?",
  description,
  openGraph: { title: "Can you fool Veto?", description, images: [{ url: "/api/card?challenge=1", width: 1200, height: 630, alt: "Can you fool Veto?" }] },
  twitter: { card: "summary_large_image", title: "Can you fool Veto?", description, images: ["/api/card?challenge=1"] },
};

export default async function Page() {
  // Without the network (a build in a sandbox) the page still renders; the counts fill in on the next visit.
  const stats = await challengeStats().catch(() => null);
  return <ChallengeView stats={stats} />;
}
