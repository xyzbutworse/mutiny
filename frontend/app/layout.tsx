import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { GameAudioProvider } from "@/components/GameAudio";
import "./globals.css";

function metadataBase() {
  const configuredUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  const vercelUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  const candidates = [configuredUrl, vercelUrl && `https://${vercelUrl}`, "http://localhost:3000"];

  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      return new URL(candidate);
    } catch {
      // Ignore malformed deployment configuration and use the next safe origin.
    }
  }

  return new URL("http://localhost:3000");
}

export const metadata: Metadata = {
  metadataBase: metadataBase(),
  applicationName: "MUTINY",
  title: {
    default: "MUTINY | Everyone Has Something To Hide",
    template: "%s | MUTINY",
  },
  description: "A confidential social strategy game aboard the dying vessel BLACKWATER-7, powered by Inco Lightning on Base.",
  keywords: ["MUTINY", "Inco Lightning", "Base Sepolia", "confidential game", "social strategy"],
  creator: "MUTINY",
  category: "game",
  icons: {
    icon: [{ url: "/mutiny-mark.svg", type: "image/svg+xml" }],
    apple: "/mutiny-mark.svg",
  },
  openGraph: {
    type: "website",
    title: "MUTINY | Everyone Has Something To Hide",
    description: "One crew member is secretly destroying BLACKWATER-7. Only the blockchain knows the whole truth.",
    siteName: "MUTINY",
    images: [{ url: "/og-mutiny.png", width: 1200, height: 630, alt: "MUTINY aboard BLACKWATER-7" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "MUTINY | Everyone Has Something To Hide",
    description: "A confidential social strategy game powered by Inco Lightning on Base.",
    images: ["/og-mutiny.png"],
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#060706",
  colorScheme: "dark",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <body><GameAudioProvider>{children}</GameAudioProvider></body>
    </html>
  );
}
