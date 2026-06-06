import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "banyan — parallel features for multi-repo projects",
  description:
    "tmux + git worktrees + Claude Code. Run N AI agents in parallel across N repos, each with isolated worktrees, dev ports, docker stacks, and conversations.",
  metadataBase: new URL("https://banyan.dev"),
  openGraph: {
    title: "banyan",
    description: "Parallel features across N repos. One CLI. One Claude agent per feature.",
    url: "https://banyan.dev",
    siteName: "banyan",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "banyan",
    description: "Parallel features across N repos. One CLI. One Claude agent per feature.",
  },
};

export const viewport: Viewport = {
  themeColor: "#0a0a0a",
};

export default function RootLayout({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700;800&family=Geist+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
