import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "AI Harness — Agentic Development Control Plane",
    short_name: "AI Harness",
    description:
      "Plan, approve and audit AI coding agents across providers, tools and execution environments.",
    start_url: "/agent",
    scope: "/",
    display: "standalone",
    background_color: "#0B1020",
    theme_color: "#0B1020",
    orientation: "any",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
