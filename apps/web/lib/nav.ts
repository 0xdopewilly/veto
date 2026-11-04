import { GITHUB_URL } from "./config";

/** About the project, not the vault: a quiet row in the sidebar's foot and in the vault menu. */
export const ABOUT_LINKS: { href: string; label: string; external?: boolean }[] = [
  { href: "/", label: "About Veto" },
  { href: "/docs", label: "Docs" },
  { href: "/bench", label: "Veto Bench" },
  { href: GITHUB_URL, label: "GitHub", external: true },
];
