import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { OfflineIndicator } from "@/components/offline-indicator";
import { ErrorBoundary } from "@/components/error-boundary";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const jetbrains = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains" });

export const metadata: Metadata = {
  title: "AI Harness",
  description:
    "A model-independent agentic development environment: plans, approvals, controlled tools and auditable execution.",
  applicationName: "AI Harness",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "AI Harness" },
};

export const viewport: Viewport = {
  themeColor: "#0B1020",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrains.variable}`}>
      <head>
        {/* Runtime API URL injection — populated by docker-entrypoint.sh in production */}
        {/* eslint-disable-next-line @next/next/no-sync-scripts */}
        <script src="/env.js" />
      </head>
      <body>
        <ErrorBoundary>{children}</ErrorBoundary>
        <OfflineIndicator />
      </body>
    </html>
  );
}
