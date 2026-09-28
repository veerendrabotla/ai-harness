"use client";

import { Component, type ReactNode } from "react";
import { AlertCircle, RefreshCw, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallbackTitle?: string;
  fallbackMessage?: string;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("[ErrorBoundary]", error, errorInfo);
    this.props.onError?.(error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <Card className="flex flex-col items-center justify-center p-6 text-center">
          <AlertCircle className="h-8 w-8 text-danger mb-3" />
          <CardTitle className="text-sm font-semibold text-text-primary mb-1">
            {this.props.fallbackTitle ?? "Something went wrong"}
          </CardTitle>
          <p className="text-xs text-text-secondary mb-4 max-w-xs">
            {this.props.fallbackMessage ?? "This component failed to load. You can try again."}
          </p>
          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={this.handleReset} className="gap-1.5">
              <RefreshCw className="h-3 w-3" />
              Try Again
            </Button>
            <a
              href="https://github.com/anomalyco/opencode/issues"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-text-primary hover:bg-surface-2 transition-colors"
            >
              <ExternalLink className="h-3 w-3" />
              Report Issue
            </a>
          </div>
        </Card>
      );
    }

    return this.props.children;
  }
}
