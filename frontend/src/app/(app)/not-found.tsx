import Link from "next/link";
import { FileQuestion } from "lucide-react";

export default function NotFound() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-6">
      <div className="max-w-md text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-surface-3">
          <FileQuestion className="h-6 w-6 text-text-muted" />
        </div>
        <h2 className="text-xl font-semibold text-text-primary mb-2">
          Page not found
        </h2>
        <p className="text-sm text-text-secondary mb-6">
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
        </p>
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-[#0B1020] hover:bg-brand-hover transition-colors"
        >
          Go to Dashboard
        </Link>
      </div>
    </div>
  );
}
