"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/form";
import { apiFetch } from "@/lib/api-client";
import { useAuthStore } from "@/lib/auth-store";
import { Send, Trash2 } from "lucide-react";
import { formatRelative as timeAgo } from "@/lib/utils";

interface DeploymentComment {
  id: string;
  content: string;
  createdAt: string;
  user: {
    id: string;
    displayName?: string;
    avatarUrl?: string;
  };
}

interface DeploymentCommentsProps {
  deploymentId: string;
}

export function DeploymentComments({ deploymentId }: DeploymentCommentsProps) {
  const [comments, setComments] = useState<DeploymentComment[]>([]);
  const [newComment, setNewComment] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const user = useAuthStore((s) => s.user);
  const userId = user?.id;

  const fetchComments = useCallback(async () => {
    try {
      const data = await apiFetch<DeploymentComment[]>(
        `/v1/deployments/${deploymentId}/comments`
      );
      setComments(data);
    } catch {
      // Error logged
    } finally {
      setLoading(false);
    }
  }, [deploymentId]);

  useEffect(() => {
    fetchComments();
  }, [fetchComments]);

  async function handleSend() {
    if (!newComment.trim()) return;
    setSending(true);
    try {
      const comment = await apiFetch<DeploymentComment>(
        `/v1/deployments/${deploymentId}/comments`,
        { method: "POST", json: { content: newComment.trim() } }
      );
      setComments((prev) => [...prev, comment]);
      setNewComment("");
    } catch {
      // Error logged
    } finally {
      setSending(false);
    }
  }

  async function handleDelete(commentId: string) {
    try {
      await apiFetch(`/v1/deployments/${deploymentId}/comments/${commentId}`, {
        method: "DELETE",
      });
      setComments((prev) => prev.filter((c) => c.id !== commentId));
    } catch {
      // Error logged
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSend();
    }
  }

  if (loading) {
    return <div className="text-text-muted text-sm p-2">Loading comments...</div>;
  }

  return (
    <div className="space-y-3">
      <h4 className="text-sm font-medium text-text-primary">Comments</h4>

      <div className="space-y-2 max-h-64 overflow-y-auto">
        {comments.length === 0 ? (
          <p className="text-text-muted text-xs">No comments yet.</p>
        ) : (
          comments.map((comment) => (
            <div key={comment.id} className="rounded-lg border border-border bg-surface-2 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="font-medium text-text-primary">
                      {comment.user.displayName || comment.user.id.slice(0, 8)}
                    </span>
                    <span className="text-text-muted">
                      {timeAgo(comment.createdAt)}
                    </span>
                  </div>
                  <p className="text-sm mt-1 text-text-primary whitespace-pre-wrap">{comment.content}</p>
                </div>
                {comment.user.id === userId && (
                  <button
                    onClick={() => handleDelete(comment.id)}
                    className="p-1 text-text-muted hover:text-danger"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      <div className="flex gap-2">
        <Textarea
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Add a comment... (Ctrl+Enter to send)"
          rows={2}
          className="flex-1 resize-none"
        />
        <Button
          size="sm"
          onClick={handleSend}
          disabled={sending || !newComment.trim()}
        >
          <Send className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
