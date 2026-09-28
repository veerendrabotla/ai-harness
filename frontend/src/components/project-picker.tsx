"use client";

import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api-client";
import type { ProjectDtoLike } from "@/lib/types";

export function ProjectPicker({
  workspaceId,
  value,
  onChange,
}: {
  workspaceId: string;
  value: string;
  onChange: (id: string) => void;
}) {
  const projects = useQuery({
    queryKey: ["projects", workspaceId],
    queryFn: () => apiFetch<ProjectDtoLike[]>(`/v1/workspaces/${workspaceId}/projects`),
  });
  if (projects.isLoading) return null;
  return (
    <select
      aria-label="Select project"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-9 rounded-lg border border-border bg-surface-1 px-2 text-sm"
    >
      {(projects.data ?? []).map((p) => (
        <option key={p.id} value={p.id}>
          {p.name} ({p.connectionType === "LOCAL_BRIDGE" ? "bridge" : "cloud"})
        </option>
      ))}
    </select>
  );
}
