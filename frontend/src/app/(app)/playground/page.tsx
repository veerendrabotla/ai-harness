"use client";

import { useState, useEffect } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Play, Loader2, Copy, Code } from "lucide-react";
import { apiFetch } from "@/lib/api-client";
import { Card, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AppShell } from "@/components/app-shell";

interface ModelOption {
  id: string;
  name: string;
  provider: string;
}

interface PlaygroundResult {
  content: string;
  model: string;
  tokens: { input: number; output: number };
  duration: number;
  cost: number;
}

export default function PromptPlaygroundPage() {
  const [prompt, setPrompt] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [selectedModel, setSelectedModel] = useState("gpt-4o");
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(1024);
  const [result, setResult] = useState<PlaygroundResult | null>(null);

  const models = useQuery({
    queryKey: ["models"],
    queryFn: async () => {
      try {
        const data = await apiFetch<{ models: ModelOption[] }>("/v1/playground/models");
        return { models: data.models ?? [] };
      } catch {
        return { models: [] as ModelOption[], error: true as const };
      }
    },
  });

  useEffect(() => {
    if (models.data?.models?.[0]?.id) setSelectedModel(models.data.models[0].id);
  }, [models.data]);

  const runMutation = useMutation({
    mutationFn: async () => {
      const res = await apiFetch<PlaygroundResult>("/v1/playground/run", {
        method: "POST",
        json: {
          prompt,
          systemPrompt: systemPrompt || undefined,
          model: selectedModel,
          temperature,
          maxTokens,
        },
      });
      return res;
    },
    onSuccess: (data) => setResult(data),
  });

  return (
    <AppShell>
      <div className="px-6 py-5 pb-24 mx-auto max-w-6xl">
        <div className="flex items-center gap-3">
          <Code className="h-5 w-5 text-brand" />
          <div>
            <h1 className="text-h1">Prompt Playground</h1>
            <p className="mt-1 text-[12px] text-text-muted">Test and iterate on prompts with different models</p>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Input Panel */}
          <div className="space-y-4">
            <Card className="p-4">
              <CardTitle className="text-[13px]">System Prompt</CardTitle>
              <textarea
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder="You are a helpful assistant..."
                className="mt-2 w-full h-24 px-3 py-2 text-[12px] bg-surface-2 border border-border rounded-md resize-none focus:outline-none focus:ring-1 focus:ring-brand font-mono"
              />
            </Card>

            <Card className="p-4">
              <CardTitle className="text-[13px]">User Prompt</CardTitle>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Enter your prompt here..."
                className="mt-2 w-full h-40 px-3 py-2 text-[12px] bg-surface-2 border border-border rounded-md resize-none focus:outline-none focus:ring-1 focus:ring-brand font-mono"
              />
            </Card>

            <Card className="p-4">
              <CardTitle className="text-[13px]">Settings</CardTitle>
              <div className="mt-3 grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[11px] text-text-muted">Model</label>
                  <select
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    className="mt-1 w-full px-2 py-1.5 text-[12px] bg-surface-2 border border-border rounded-md"
                  >
                    {models.data?.models?.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} ({m.provider})
                      </option>
                    )) ?? <option>gpt-4o</option>}
                  </select>
                  {models.data?.error && (
                    <p className="mt-1 text-[11px] text-danger">Failed to load models</p>
                  )}
                </div>
                <div>
                  <label className="text-[11px] text-text-muted">Temperature: {temperature}</label>
                  <input
                    type="range"
                    min="0"
                    max="2"
                    step="0.1"
                    value={temperature}
                    onChange={(e) => setTemperature(parseFloat(e.target.value))}
                    className="mt-1 w-full"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-text-muted">Max Tokens</label>
                  <input
                    type="number"
                    value={maxTokens}
                    onChange={(e) => setMaxTokens(parseInt(e.target.value) || 1024)}
                    className="mt-1 w-full px-2 py-1.5 text-[12px] bg-surface-2 border border-border rounded-md"
                  />
                </div>
              </div>
            </Card>

            <Button
              onClick={() => runMutation.mutate()}
              disabled={!prompt.trim() || runMutation.isPending}
              className="w-full gap-1.5"
            >
              {runMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              Run Prompt
            </Button>
          </div>

          {/* Output Panel */}
          <div className="space-y-4">
            <Card className="p-4 min-h-[300px]">
              <div className="flex items-center justify-between">
                <CardTitle className="text-[13px]">Output</CardTitle>
                {result && (
                  <button
                    onClick={() => navigator.clipboard.writeText(result.content)}
                    className="p-1 text-text-muted hover:text-text-primary transition-colors"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              {result ? (
                <div className="mt-3">
                  <pre className="text-[12px] text-text-primary whitespace-pre-wrap font-mono leading-relaxed">
                    {result.content}
                  </pre>
                  <div className="mt-4 pt-3 border-t border-border flex items-center gap-4 text-[11px] text-text-muted">
                    <span>Model: {result.model}</span>
                    <span>Input: {result.tokens.input} tokens</span>
                    <span>Output: {result.tokens.output} tokens</span>
                    <span>Duration: {result.duration}ms</span>
                    <span>Cost: ${result.cost.toFixed(4)}</span>
                  </div>
                </div>
              ) : (
                <div className="mt-8 text-center text-[12px] text-text-muted">
                  <Code className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  <p>Enter a prompt and click Run to see the output</p>
                </div>
              )}
            </Card>

            {runMutation.isError && (
              <Card className="p-4 border-danger/30">
                <p className="text-[12px] text-danger">
                  Error: {runMutation.error instanceof Error ? runMutation.error.message : "Request failed"}
                </p>
              </Card>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
