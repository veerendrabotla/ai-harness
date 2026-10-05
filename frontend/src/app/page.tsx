import Link from "next/link";
import {
  ArrowRight,
  GitBranch,
  ShieldCheck,
  Workflow,
  Code,
  Eye,
  Rocket,
  Brain,
  Check,
  Layers,
  Lock,
  Zap,
  Globe,
  Database,
  Download,
} from "lucide-react";

export default function LandingPage() {
  return (
    <main className="min-h-dvh">
      {/* Hero Section */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-brand/5 via-transparent to-brand/10" />
        <div className="relative mx-auto max-w-6xl px-6 pt-20 pb-16">
          <div className="text-center">
            <p className="mb-4 text-sm font-medium uppercase tracking-widest text-brand">
              AI-Native Software Development Platform
            </p>
            <h1 className="text-5xl md:text-6xl font-bold tracking-tight text-text-primary mb-6">
              Build faster with
              <br />
              <span className="text-brand">AI-powered agents</span>
            </h1>
            <p className="mx-auto max-w-2xl text-lg text-text-secondary mb-8">
              Multi-agent orchestration with plan-approve-execute workflows.
              Human-in-the-loop approvals, session portability, and production-ready
              deployment — all in one platform.
            </p>
            <div className="flex flex-wrap justify-center gap-4">
              <Link
                href="/signup"
                className="inline-flex h-12 items-center gap-2 rounded-xl bg-brand px-8 font-semibold text-[#0B1020] hover:bg-brand-hover transition-colors"
              >
                Start Building Free <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/login"
                className="inline-flex h-12 items-center rounded-xl border border-border-strong px-8 font-medium text-text-primary hover:bg-surface-2 transition-colors"
              >
                Sign In
              </Link>
              <Link
                href="/download"
                className="inline-flex h-12 items-center gap-2 rounded-xl border border-border-strong px-8 font-medium text-text-primary hover:bg-surface-2 transition-colors"
              >
                <Download className="h-4 w-4" /> Download
              </Link>
            </div>
          </div>

          {/* Hero Visual - Agent Workflow */}
          <div className="mt-16 mx-auto max-w-4xl rounded-2xl border border-border bg-surface-1 p-6 shadow-2xl">
            <div className="flex items-center gap-2 mb-4">
              <div className="h-3 w-3 rounded-full bg-danger" />
              <div className="h-3 w-3 rounded-full bg-warning" />
              <div className="h-3 w-3 rounded-full bg-success" />
              <span className="ml-4 text-xs text-text-muted">Agent Workspace — Real-time execution</span>
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="rounded-lg bg-surface-2 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Brain className="h-4 w-4 text-brand" />
                  <span className="text-xs font-medium">Planning</span>
                </div>
                <div className="space-y-2">
                  <div className="h-2 w-full rounded bg-brand/20" />
                  <div className="h-2 w-3/4 rounded bg-brand/20" />
                  <div className="h-2 w-5/6 rounded bg-brand/20" />
                </div>
                <span className="text-[11px] text-text-muted mt-2 block">Analyzing requirements...</span>
              </div>
              <div className="rounded-lg bg-surface-2 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Code className="h-4 w-4 text-info" />
                  <span className="text-xs font-medium">Implementing</span>
                </div>
                <div className="space-y-1 font-mono text-[11px] text-text-muted">
                  <div><span className="text-brand">+</span> export async function handler()</div>
                  <div><span className="text-brand">+</span>   return {`{`} status: 200</div>
                  <div><span className="text-brand">+</span> {`}`}</div>
                </div>
              </div>
              <div className="rounded-lg bg-surface-2 p-4">
                <div className="flex items-center gap-2 mb-2">
                  <ShieldCheck className="h-4 w-4 text-success" />
                  <span className="text-xs font-medium">Approved</span>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-[11px] text-success">
                    <Check className="h-3 w-3" /> Plan approved
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-success">
                    <Check className="h-3 w-3" /> Tool: file_write
                  </div>
                  <div className="flex items-center gap-2 text-[11px] text-success">
                    <Check className="h-3 w-3" /> Tests passing
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Features Grid */}
      <div className="mx-auto max-w-6xl px-6 py-20">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold text-text-primary mb-3">
            Everything you need to ship with AI
          </h2>
          <p className="text-text-secondary max-w-2xl mx-auto">
            A complete development environment where AI agents work alongside you
            with full transparency and control.
          </p>
        </div>

        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {[
            {
              icon: Workflow,
              title: "Multi-Agent Orchestration",
              description: "Specialized agents for planning, implementation, and review. Each with isolated context and capabilities.",
              color: "text-brand",
            },
            {
              icon: ShieldCheck,
              title: "Human-in-the-Loop",
              description: "Every file write, shell command, and deployment requires your explicit approval. Full policy control.",
              color: "text-success",
            },
            {
              icon: Layers,
              title: "Session Portability",
              description: "Export and import agent sessions between environments. Pick up exactly where you left off.",
              color: "text-info",
            },
            {
              icon: Eye,
              title: "Live Preview",
              description: "See your app running in real-time as the agent builds it. Instant visual feedback loop.",
              color: "text-warning",
            },
            {
              icon: GitBranch,
              title: "Any Provider",
              description: "Use OpenAI, Anthropic, Google, or any OpenAI-compatible API. Route different stages to different models.",
              color: "text-brand",
            },
            {
              icon: Rocket,
              title: "One-Click Deploy",
              description: "Deploy to Vercel, Cloudflare, Railway, or your own infrastructure. Production-ready in seconds.",
              color: "text-danger",
            },
            {
              icon: Database,
              title: "Project Memory",
              description: "The agent remembers your codebase, decisions, and patterns across sessions. Continuous learning.",
              color: "text-info",
            },
            {
              icon: Lock,
              title: "Audit Trail",
              description: "Complete history of every action, decision, and approval. Full traceability for compliance.",
              color: "text-text-secondary",
            },
            {
              icon: Globe,
              title: "Extension System",
              description: "MCP servers, custom tools, and community plugins. Extend the agent's capabilities infinitely.",
              color: "text-brand",
            },
          ].map(({ icon: Icon, title, description, color }) => (
            <div
              key={title}
              className="rounded-xl border border-border bg-surface-1 p-6 hover:border-border-strong transition-colors"
            >
              <Icon className={`h-6 w-6 ${color}`} aria-hidden />
              <h3 className="mt-4 text-lg font-semibold text-text-primary">{title}</h3>
              <p className="mt-2 text-sm text-text-secondary">{description}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Comparison Table */}
      <div className="mx-auto max-w-5xl px-6 py-20">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold text-text-primary mb-3">
            Why AI Harness?
          </h2>
          <p className="text-text-secondary">
            The only platform that combines multi-agent orchestration with human control
          </p>
        </div>

        <div className="rounded-xl border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-2">
                <th className="text-left px-6 py-4 font-semibold text-text-primary">Feature</th>
                <th className="text-center px-4 py-4 font-semibold text-brand">AI Harness</th>
                <th className="text-center px-4 py-4 font-semibold text-text-muted">Cursor</th>
                <th className="text-center px-4 py-4 font-semibold text-text-muted">Bolt</th>
                <th className="text-center px-4 py-4 font-semibold text-text-muted">Claude Code</th>
              </tr>
            </thead>
            <tbody>
              {[
                { feature: "Multi-agent orchestration", harness: true, cursor: false, bolt: false, claude: false },
                { feature: "Plan-approve-execute workflow", harness: true, cursor: false, bolt: false, claude: true },
                { feature: "Human-in-the-loop approvals", harness: true, cursor: false, bolt: false, claude: true },
                { feature: "Session portability", harness: true, cursor: false, bolt: false, claude: false },
                { feature: "Live preview", harness: true, cursor: false, bolt: true, claude: false },
                { feature: "One-click deploy", harness: true, cursor: false, bolt: true, claude: false },
                { feature: "Project memory", harness: true, cursor: true, bolt: false, claude: true },
                { feature: "Extension system (MCP)", harness: true, cursor: false, bolt: false, claude: false },
                { feature: "Self-hosted option", harness: true, cursor: false, bolt: false, claude: false },
                { feature: "Audit trail", harness: true, cursor: false, bolt: false, claude: false },
              ].map((row) => (
                <tr key={row.feature} className="border-b border-border last:border-0">
                  <td className="px-6 py-3 text-text-primary">{row.feature}</td>
                  <td className="text-center px-4 py-3">
                    {row.harness ? (
                      <Check className="h-5 w-5 text-success mx-auto" />
                    ) : (
                      <span className="text-text-muted">-</span>
                    )}
                  </td>
                  <td className="text-center px-4 py-3">
                    {row.cursor ? (
                      <Check className="h-5 w-5 text-success mx-auto" />
                    ) : (
                      <span className="text-text-muted">-</span>
                    )}
                  </td>
                  <td className="text-center px-4 py-3">
                    {row.bolt ? (
                      <Check className="h-5 w-5 text-success mx-auto" />
                    ) : (
                      <span className="text-text-muted">-</span>
                    )}
                  </td>
                  <td className="text-center px-4 py-3">
                    {row.claude ? (
                      <Check className="h-5 w-5 text-success mx-auto" />
                    ) : (
                      <span className="text-text-muted">-</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* How It Works */}
      <div className="mx-auto max-w-5xl px-6 py-20">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold text-text-primary mb-3">
            How it works
          </h2>
          <p className="text-text-secondary">
            From idea to deployed app in four steps
          </p>
        </div>

        <div className="grid gap-8 md:grid-cols-4">
          {[
            {
              step: "1",
              title: "Describe",
              description: "Tell the AI what you want to build in natural language.",
              icon: Zap,
            },
            {
              step: "2",
              title: "Plan",
              description: "The agent creates an execution plan for your review.",
              icon: Workflow,
            },
            {
              step: "3",
              title: "Approve & Build",
              description: "Approve each step and watch the agent implement it.",
              icon: ShieldCheck,
            },
            {
              step: "4",
              title: "Deploy",
              description: "One click to deploy your app to production.",
              icon: Rocket,
            },
          ].map(({ step, title, description, icon: Icon }) => (
            <div key={step} className="text-center">
              <div className="mx-auto h-12 w-12 rounded-full bg-brand/15 flex items-center justify-center mb-4">
                <Icon className="h-6 w-6 text-brand" />
              </div>
              <div className="text-xs font-bold text-brand mb-1">Step {step}</div>
              <h3 className="text-lg font-semibold text-text-primary mb-1">{title}</h3>
              <p className="text-sm text-text-secondary">{description}</p>
            </div>
          ))}
        </div>
      </div>

      {/* CTA Section */}
      <div className="mx-auto max-w-4xl px-6 py-20">
        <div className="rounded-2xl bg-gradient-to-br from-brand/10 to-brand/5 border border-border p-12 text-center">
          <h2 className="text-3xl font-bold text-text-primary mb-4">
            Ready to build faster?
          </h2>
          <p className="text-text-secondary mb-8 max-w-lg mx-auto">
            Join developers who are shipping production apps with AI assistance
            while maintaining full control over every decision.
          </p>
          <div className="flex flex-wrap justify-center gap-4">
            <Link
              href="/signup"
              className="inline-flex h-12 items-center gap-2 rounded-xl bg-brand px-8 font-semibold text-[#0B1020] hover:bg-brand-hover transition-colors"
            >
              Get Started Free <ArrowRight className="h-4 w-4" />
            </Link>
            <a
              href="https://github.com/veerendrabotla/ai-harness"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-12 items-center gap-2 rounded-xl border border-border-strong px-8 font-medium text-text-primary hover:bg-surface-2 transition-colors"
            >
              <GitBranch className="h-4 w-4" /> View on GitHub
            </a>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="border-t border-border py-12 px-6">
        <div className="mx-auto max-w-6xl flex flex-wrap items-center justify-between gap-6">
          <div>
            <p className="font-semibold text-text-primary">AI Harness</p>
            <p className="text-sm text-text-muted">AI-native software development platform</p>
          </div>
          <div className="flex gap-6 text-sm text-text-secondary">
            <Link href="/download" className="hover:text-text-primary">Download</Link>
            <Link href="/login" className="hover:text-text-primary">Sign In</Link>
            <Link href="/signup" className="hover:text-text-primary">Sign Up</Link>
            <a href="https://github.com/veerendrabotla/ai-harness/tree/main/docs" className="hover:text-text-primary">Docs</a>
            <a href="https://github.com/veerendrabotla/ai-harness" className="hover:text-text-primary">GitHub</a>
          </div>
        </div>
      </footer>
    </main>
  );
}
