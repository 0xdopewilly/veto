import type { Metadata, Viewport } from "next";
import { JetBrains_Mono, Mona_Sans } from "next/font/google";
import "./globals.css";

const sans = Mona_Sans({ subsets: ["latin"], axes: ["wdth"], variable: "--font-sans", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Veto", template: "%s · Veto" },
  description:
    "A vault where every payment your AI agent makes needs a second signer that can only say no: hard caps on NEAR plus a private AI screen in a TEE.",
  applicationName: "Veto",
  metadataBase: new URL("https://veto-beta.vercel.app"),
  openGraph: {
    type: "website",
    siteName: "Veto",
    title: "Veto: the AI can only say no",
    description:
      "Every payment an AI agent makes needs a second signer: a model in NEAR AI's enclave whose verdict the vault checks on-chain. Live on NEAR mainnet.",
    images: [{ url: "/og.png", width: 2400, height: 1260, alt: "Veto: a \"new wallet\" scam email, vetoed on NEAR mainnet; nothing moved" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Veto: the AI can only say no",
    description:
      "Every payment an AI agent makes needs a second signer: a model in NEAR AI's enclave whose verdict the vault checks on-chain. Live on NEAR mainnet.",
    images: ["/og.png"],
  },
  appleWebApp: { capable: true, title: "Veto", statusBarStyle: "black-translucent" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f2f1e9" },
    { media: "(prefers-color-scheme: dark)", color: "#000000" },
  ],
  colorScheme: "dark light",
};

// Runs before the first paint, so the page never flashes the other theme. The choice is
// "light", "dark" or absent (follow the system); lib/theme.ts writes it.
const themeScript = `(function(){var d=document.documentElement,p=null;try{p=localStorage.getItem("veto:theme")}catch(e){}var t=p==="light"||p==="dark"?p:(window.matchMedia&&matchMedia("(prefers-color-scheme: light)").matches?"light":"dark");d.dataset.theme=t;d.dataset.themePref=p||"system"})()`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`} data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
