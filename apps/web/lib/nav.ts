import { GITHUB_URL } from "./config";

/** About the project, not the vault: a quiet row in the sidebar's foot and in the vault menu. */
export const ABOUT_LINKS: { href: string; label: string; external?: boolean }[] = [
  { href: "/", label: "About Veto" },
  { href: "/docs", label: "Docs" },
  { href: "/bench", label: "Veto Bench" },
  { href: GITHUB_URL, label: "GitHub", external: true },
];

/** The public pages, in the order the site's header, phone menu and footer list them. */
export const SITE_PAGES: { href: string; label: string; sub: string }[] = [
  { href: "/", label: "Overview", sub: "What Veto stops, and how" },
  { href: "/docs", label: "Docs", sub: "How it works, step by step" },
  { href: "/bench", label: "Bench", sub: "100 payments, every verdict signed" },
];
