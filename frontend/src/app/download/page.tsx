import type { Metadata } from "next";

import { DownloadView } from "./download-view";

export const metadata: Metadata = {
  title: "Download AI Harness",
  description:
    "Desktop app for Windows, macOS and Linux, one-line web stack installer, and the VS Code extension — pick your platform.",
};

export default function DownloadPage() {
  return <DownloadView />;
}
