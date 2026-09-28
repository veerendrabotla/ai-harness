"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Brain,
  FileText,
  Clock,
  Tag,
  RefreshCw,
} from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { Card, CardTitle } from "@/components/ui/card";
import { ErrorState, Skeleton } from "@/components/ui/states";
import { Button } from "@/components/ui/button";

interface ProjectMemory {
  id: string;
  category: string;
  key: string;
  value: string;
  source: string;
  confidence: number;
  createdAt: string;
  updatedAt: string;
}

interface ProjectMemoryViewerProps {
  projectId: string;
}

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  ARCHITECTURE: <Brain className="h-3.5 w-3.5" />,
  CONVENTION: <FileText className="h-3.5 w-3.5" />,
  PATTERN: <Tag className="h-3.5 w-3.5" />,
  DECISION: <Clock className="h-3.5 w-3.5" />,
};

const CATEGORY_COLORS: Record<string, string> = {
  ARCHITECTURE: "text-brand",
  CONVENTION: "text-info",
  PATTERN: "text-success",
  DECISION: "text-warning",
};

export function ProjectMemoryViewer({ projectId }: ProjectMemoryViewerProps) {
  const memories = useQuery({
    queryKey: ["project-memories", projectId],
    queryFn: () => apiFetch<ProjectMemory[]>(`/v1/projects/${projectId}/memories`),
  });

  const groupedMemories = (memories.data ?? []).reduce(
    (acc, memory) => {
      if (!acc[memory.category]) acc[memory.category] = [];
      acc[memory.category].push(memory);
      return acc;
    },
    {} as Record<string, ProjectMemory[]>,
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-brand" />
          <h3 className="text-[13px] font-medium text-text-primary">Project Memory</h3>
        </div>
        <Button
          onClick={() => memories.refetch()}
          variant="secondary"
          className="gap-1.5"
          size="sm"
        >
          <RefreshCw className="h-3 w-3" />
          Refresh
        </Button>
      </div>

      {memories.isLoading && (
        <div className="space-y-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
      )}

      {memories.isError && (
              <ErrorState error={{ message: "Failed to load memories" }} onRetry={() => memories.refetch()} />
      )}

      {memories.data?.length === 0 && !memories.isLoading && (
        <Card className="p-6 text-center">
          <Brain className="h-8 w-8 text-text-muted mx-auto mb-2" />
          <p className="text-[12px] text-text-muted">
            No memories recorded yet. The agent learns as it works.
          </p>
        </Card>
      )}

      {Object.entries(groupedMemories).map(([category, items]) => (
        <Card key={category} className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <span className={CATEGORY_COLORS[category] ?? "text-text-muted"}>
              {CATEGORY_ICONS[category] ?? <Brain className="h-3.5 w-3.5" />}
            </span>
            <CardTitle className="text-[12px] text-text-primary capitalize">
              {category.toLowerCase()}
            </CardTitle>
            <span className="text-[11px] text-text-muted bg-surface-3 rounded-full px-2 py-0.5">
              {items.length}
            </span>
          </div>
          <div className="space-y-2">
            {items.map((memory) => (
              <div
                key={memory.id}
                className="rounded-lg bg-surface-2 px-3 py-2"
              >
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-medium text-text-primary">{memory.key}</p>
                  <div className="flex items-center gap-1">
                    <div className="h-1.5 w-12 bg-surface-3 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-brand rounded-full"
                        style={{ width: `${memory.confidence * 100}%` }}
                      />
                    </div>
                    <span className="text-[11px] text-text-muted">
                      {Math.round(memory.confidence * 100)}%
                    </span>
                  </div>
                </div>
                <p className="mt-1 text-[11px] text-text-muted line-clamp-2">{memory.value}</p>
                <div className="mt-1 flex items-center gap-2 text-[11px] text-text-muted">
                  <span>Source: {memory.source}</span>
                  <span>Updated: {new Date(memory.updatedAt).toLocaleDateString()}</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}
