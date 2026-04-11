import type { Metadata } from "next";
import { IBM_Plex_Mono, Inter } from "next/font/google";
import type { ReactNode } from "react";

import { Shell } from "@/components/shell";
import "@/app/globals.css";
import { getAdminSession } from "@/lib/auth/server";

const sans = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "BAM Control",
  description: "Single-app control plane for BAM sites, feeds, content, and jobs.",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const session = await getAdminSession();

  return (
    <html lang="en">
      <body className={`${sans.variable} ${mono.variable}`}>
        {session ? <Shell>{children}</Shell> : children}
      </body>
    </html>
  );
}
