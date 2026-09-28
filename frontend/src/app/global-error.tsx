"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body className="bg-[#0a0a0a] text-[#e5e5e5]">
        <div className="flex flex-col items-center justify-center min-h-screen p-8 text-center">
          <div className="w-12 h-12 rounded-full bg-red-500/15 flex items-center justify-center mb-4">
            <svg className="h-6 w-6 text-red-400" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
          </div>
          <h1 className="text-xl font-semibold mb-2">Something went wrong</h1>
          <p className="text-sm text-[#a3a3a3] mb-6 max-w-sm">
            An unexpected error occurred. Please try again or refresh the page.
          </p>
          <button
            onClick={reset}
            className="px-4 py-2 rounded-lg border border-[#262626] bg-[#1a1a1a] hover:bg-[#262626] text-sm font-medium transition-colors"
          >
            Try again
          </button>
          {error.digest && (
            <p className="mt-4 text-xs text-[#525252]">
              Error ID: {error.digest}
            </p>
          )}
        </div>
      </body>
    </html>
  );
}
