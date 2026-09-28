"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Building2,
  Plus,
  Users,
  FolderKanban,
  ArrowRight,
  Loader2,
  X,
} from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { Card, CardTitle } from "@/components/ui/card";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states";
import { Button } from "@/components/ui/button";
import { AppShell } from "@/components/app-shell";

interface Organization {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  status: string;
  role: string;
  createdAt: string;
  _count: { members: number; workspaces: number };
}

export default function OrganizationsPage() {
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newSlug, setNewSlug] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const orgs = useQuery({
    queryKey: ["organizations"],
    queryFn: () => apiFetch<Organization[]>("/v1/organizations"),
  });

  const createMutation = useMutation({
    mutationFn: (data: { name: string; slug: string; description?: string }) =>
      apiFetch<Organization>("/v1/organizations", {
        method: "POST",
        json: data,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["organizations"] });
      setShowCreate(false);
      setNewName("");
      setNewSlug("");
      setNewDescription("");
    },
    onError: (err) => {
      setFormError(err instanceof Error ? err.message : "Failed to create organization");
    },
  });

  const handleSlugGenerate = (name: string) => {
    setNewSlug(
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, ""),
    );
  };

  return (
    <AppShell>
      <div className="px-6 py-5 pb-24 mx-auto max-w-3xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Building2 className="h-5 w-5 text-brand" />
            <div>
              <h1 className="text-h1">Organizations</h1>
              <p className="mt-1 text-[12px] text-text-muted">Manage team hierarchy and workspace grouping</p>
            </div>
          </div>
          <Button onClick={() => setShowCreate(true)} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" />
            New Organization
          </Button>
        </div>

        {showCreate && (
          <Card className="mt-4 p-5">
            <div className="flex items-center justify-between mb-4">
              <CardTitle className="text-[14px]">Create Organization</CardTitle>
              <button onClick={() => setShowCreate(false)} className="text-text-muted hover:text-text-primary">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-[11px] text-text-muted mb-1">Name</label>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => {
                    setNewName(e.target.value);
                    handleSlugGenerate(e.target.value);
                  }}
                  placeholder="My Organization"
                  className="w-full px-3 py-2 text-[13px] bg-surface-2 border border-border rounded-lg focus:outline-none focus:border-brand"
                />
              </div>
              <div>
                <label className="block text-[11px] text-text-muted mb-1">Slug</label>
                <input
                  type="text"
                  value={newSlug}
                  onChange={(e) => setNewSlug(e.target.value)}
                  placeholder="my-organization"
                  className="w-full px-3 py-2 text-[13px] bg-surface-2 border border-border rounded-lg font-mono focus:outline-none focus:border-brand"
                />
              </div>
              <div>
                <label className="block text-[11px] text-text-muted mb-1">Description (optional)</label>
                <textarea
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  placeholder="Brief description..."
                  rows={2}
                  className="w-full px-3 py-2 text-[13px] bg-surface-2 border border-border rounded-lg resize-none focus:outline-none focus:border-brand"
                />
              </div>
              {formError && (
                <p className="text-[12px] text-danger">{formError}</p>
              )}
              <div className="flex justify-end gap-2 pt-1">
                <Button variant="secondary" onClick={() => setShowCreate(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={() => createMutation.mutate({ name: newName, slug: newSlug, description: newDescription || undefined })}
                  disabled={!newName || !newSlug || createMutation.isPending}
                  className="gap-1.5"
                >
                  {createMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Create
                </Button>
              </div>
            </div>
          </Card>
        )}

        <div className="mt-6 space-y-3">
          {orgs.isLoading && (
            <>
              <Skeleton className="h-20" />
              <Skeleton className="h-20" />
            </>
          )}

          {orgs.isError && (
            <ErrorState error="Failed to load organizations" onRetry={() => orgs.refetch()} />
          )}

          {orgs.data?.length === 0 && !orgs.isLoading && (
            <EmptyState
              what="No organizations yet"
              why="Create an organization to group workspaces and manage team access."
            />
          )}

          {orgs.data?.map((org) => (
            <Link
              key={org.id}
              href={`/organizations/${org.id}`}
              className="flex items-center gap-4 rounded-lg border border-border bg-surface-1 px-4 py-3.5 transition-colors hover:border-border-strong hover:bg-surface-2 group"
            >
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-surface-3 text-brand">
                <Building2 className="h-4.5 w-4.5" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-[13px] font-medium text-text-primary group-hover:text-brand transition-colors">
                    {org.name}
                  </p>
                  <span className="text-[11px] text-text-muted bg-surface-3 rounded-full px-2 py-0.5">
                    {org.role}
                  </span>
                </div>
                {org.description && (
                  <p className="mt-0.5 text-[11px] text-text-muted truncate">{org.description}</p>
                )}
                <div className="mt-1 flex items-center gap-3 text-[11px] text-text-muted">
                  <span className="flex items-center gap-1">
                    <Users className="h-3 w-3" /> {org._count.members} members
                  </span>
                  <span className="flex items-center gap-1">
                    <FolderKanban className="h-3 w-3" /> {org._count.workspaces} workspaces
                  </span>
                </div>
              </div>
              <ArrowRight className="h-4 w-4 text-text-muted group-hover:text-brand group-hover:translate-x-0.5 transition-all" />
            </Link>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
