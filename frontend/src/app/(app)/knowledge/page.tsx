"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { BookOpen, Plus, FileText, Trash2, Search, Loader2, X, Pencil } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { Card, CardTitle } from "@/components/ui/card";
import { ErrorState, Skeleton } from "@/components/ui/states";
import { Button } from "@/components/ui/button";
import { AppShell } from "@/components/app-shell";
import { useState } from "react";

interface KnowledgeEntry {
  id: string;
  title: string;
  content: string;
  type: "DOCUMENT" | "CODE_SNIPPET" | "LINK" | "NOTE";
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

export default function KnowledgeBasePage() {
  const [search, setSearch] = useState("");
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newContent, setNewContent] = useState("");
  const [newType, setNewType] = useState<KnowledgeEntry["type"]>("DOCUMENT");
  const [newTags, setNewTags] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [editingEntry, setEditingEntry] = useState<KnowledgeEntry | null>(null);
  const queryClient = useQueryClient();

  const workspaces = useQuery({
    queryKey: ["workspaces"],
    queryFn: () => apiFetch<Array<{ id: string }>>("/v1/workspaces"),
  });
  const wsId = workspaces.data?.[0]?.id ?? "";

  const entries = useQuery({
    queryKey: ["knowledge-base", wsId],
    queryFn: () => apiFetch<{ entries: KnowledgeEntry[] }>(`/v1/knowledge?workspaceId=${wsId}`),
    enabled: Boolean(wsId),
  });

  const createMutation = useMutation({
    mutationFn: (data: { title: string; content: string; type: string; tags: string[] }) =>
      apiFetch(`/v1/knowledge`, { method: "POST", json: { ...data, workspaceId: wsId } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["knowledge-base"] });
      setShowCreateForm(false);
      setNewTitle("");
      setNewContent("");
      setNewTags("");
    },
    onError: (err) => {
      setFormError(err instanceof Error ? err.message : "Failed to create entry");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiFetch(`/v1/knowledge/${id}`, { method: "DELETE" }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["knowledge-base"] }),
    onError: (err) => {
      setFormError(err instanceof Error ? err.message : "Failed to delete entry");
    },
  });

  const updateMutation = useMutation({
    mutationFn: (data: { id: string; title: string; content: string; type: string; tags: string[] }) =>
      apiFetch(`/v1/workspaces/${wsId}/knowledge/${data.id}`, {
        method: "PATCH",
        json: { title: data.title, content: data.content, type: data.type, tags: data.tags },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["knowledge-base"] });
      setEditingEntry(null);
      setShowCreateForm(false);
      setNewTitle("");
      setNewContent("");
      setNewTags("");
    },
    onError: (err) => {
      setFormError(err instanceof Error ? err.message : "Failed to update entry");
    },
  });

  const knowledgeList = entries.data?.entries ?? [];
  const filtered = knowledgeList.filter((e) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      e.title.toLowerCase().includes(q) ||
      e.content.toLowerCase().includes(q) ||
      e.tags.some((t) => t.toLowerCase().includes(q))
    );
  });

  return (
    <AppShell>
      <div className="px-6 py-5 pb-24 mx-auto max-w-5xl">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <BookOpen className="h-5 w-5 text-brand" />
            <div>
              <h1 className="text-h1">Knowledge Base</h1>
              <p className="mt-1 text-[12px] text-text-muted">Documents, code snippets, and references for your projects</p>
            </div>
          </div>
          <Button size="sm" className="gap-1.5" onClick={() => {
            setShowCreateForm(!showCreateForm);
            if (showCreateForm) {
              setEditingEntry(null);
              setNewTitle("");
              setNewContent("");
              setNewTags("");
            }
          }}>
            {showCreateForm ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
            {showCreateForm ? "Cancel" : "Add Entry"}
          </Button>
        </div>

        {showCreateForm && (
          <Card className="mt-4 p-4 space-y-3">
            <h3 className="text-[13px] font-semibold text-text-primary">
              {editingEntry ? "Edit Knowledge Entry" : "New Knowledge Entry"}
            </h3>
            <input
              type="text"
              placeholder="Title"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              className="h-9 w-full rounded-md border border-border bg-surface-1 px-3 text-[12px]"
            />
            <textarea
              placeholder="Content..."
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              rows={4}
              className="w-full rounded-md border border-border bg-surface-1 px-3 py-2 text-[12px] resize-none"
            />
            <div className="flex gap-3">
              <select
                value={newType}
                onChange={(e) => setNewType(e.target.value as KnowledgeEntry["type"])}
                className="h-9 rounded-md border border-border bg-surface-1 px-3 text-[12px]"
              >
                <option value="DOCUMENT">Document</option>
                <option value="CODE_SNIPPET">Code Snippet</option>
                <option value="LINK">Link</option>
                <option value="NOTE">Note</option>
              </select>
              <input
                type="text"
                placeholder="Tags (comma separated)"
                value={newTags}
                onChange={(e) => setNewTags(e.target.value)}
                className="flex-1 h-9 rounded-md border border-border bg-surface-1 px-3 text-[12px]"
              />
            </div>
            <Button
              size="sm"
              disabled={!newTitle.trim() || !newContent.trim() || createMutation.isPending || updateMutation.isPending}
              onClick={() => {
                const tags = newTags.split(",").map((t) => t.trim()).filter(Boolean);
                if (editingEntry) {
                  updateMutation.mutate({
                    id: editingEntry.id,
                    title: newTitle,
                    content: newContent,
                    type: newType,
                    tags,
                  });
                } else {
                  createMutation.mutate({
                    title: newTitle,
                    content: newContent,
                    type: newType,
                    tags,
                  });
                }
              }}
            >
              {(createMutation.isPending || updateMutation.isPending) ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : editingEntry ? "Update" : "Create"}
            </Button>
          </Card>
        )}

        {formError && (
          <div className="mt-4 p-3 rounded-lg bg-danger/10 border border-danger/20 text-danger text-[12px]">
            {formError}
            <button onClick={() => setFormError(null)} className="ml-2 underline">Dismiss</button>
          </div>
        )}

        {entries.isError && (
          <div className="mt-4">
            <ErrorState error="Failed to load knowledge base" onRetry={() => entries.refetch()} />
          </div>
        )}

        {entries.isLoading && <Skeleton className="mt-6 h-48" />}

        {entries.data && (
          <>
            <div className="mt-6 relative max-w-xs">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-text-muted" />
              <input
                type="text"
                placeholder="Search knowledge base..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-10 w-full rounded-lg border border-border bg-surface-1 pl-9 pr-3 text-sm text-text-primary placeholder:text-text-muted focus:border-brand focus:outline-none focus-visible:outline-none"
              />
            </div>

            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-3">
              {filtered.map((entry) => (
                <Card key={entry.id} className="p-4 hover:border-border-strong transition-all">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-text-muted shrink-0" />
                      <CardTitle className="text-[13px]">{entry.title}</CardTitle>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => {
                          setEditingEntry(entry);
                          setNewTitle(entry.title);
                          setNewContent(entry.content);
                          setNewType(entry.type);
                          setNewTags(entry.tags.join(", "));
                          setShowCreateForm(true);
                        }}
                        className="p-1 text-text-muted hover:text-brand transition-colors"
                        aria-label={`Edit ${entry.title}`}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => {
                          if (window.confirm("Are you sure you want to delete this entry?")) {
                            deleteMutation.mutate(entry.id);
                          }
                        }}
                        className="p-1 text-text-muted hover:text-danger transition-colors"
                        aria-label={`Delete ${entry.title}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  <p className="mt-2 text-[11px] text-text-muted line-clamp-3">{entry.content}</p>
                  <div className="mt-3 flex items-center gap-2 flex-wrap">
                    <span className="px-1.5 py-0.5 text-[11px] rounded bg-surface-3 text-text-muted">
                      {entry.type}
                    </span>
                    {entry.tags.map((tag) => (
                      <span key={tag} className="px-1.5 py-0.5 text-[11px] rounded bg-brand/10 text-brand">
                        {tag}
                      </span>
                    ))}
                  </div>
                  <p className="mt-2 text-[11px] text-text-muted">
                    Updated {new Date(entry.updatedAt).toLocaleDateString()}
                  </p>
                </Card>
              ))}
              {filtered.length === 0 && (
                <p className="col-span-full text-center text-[12px] text-text-muted py-8">
                  {search ? "No entries match your search" : "No knowledge base entries yet"}
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
