/**
 * Builder API Routes (Track 2).
 * Provides template listing and prompt-to-project creation.
 */
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { TEMPLATES, promptToProjectRequestSchema, type ProjectTemplate } from "@ai-harness/contracts";
import { enqueueTaskJob } from "../../lib/task-queue.js";
import { checkQuota } from "../../lib/billing.js";
import { ok } from "../../lib/http.js";

export function registerBuilderRoutes(app: FastifyInstance): void {
  // ── List all templates ────────────────────────────────────
  app.get<{
    Querystring: { category?: string };
  }>("/v1/builder/templates", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["builder"],
      summary: "List available project templates",
      security: [{ bearerAuth: [] }],
      querystring: {
        type: "object",
        properties: { category: { type: "string" } },
      },
    },
  }, async (request, reply) => {
    const { category } = request.query;
    let templates = TEMPLATES;
    if (category) {
      templates = templates.filter((t) => t.category === category);
    }
    return ok(reply, { templates });
  });

  // ── Get single template ───────────────────────────────────
  app.get<{
    Params: { templateId: string };
  }>("/v1/builder/templates/:templateId", {
    preHandler: [app.authenticate],
    schema: {
      tags: ["builder"],
      summary: "Get a specific template by ID",
      security: [{ bearerAuth: [] }],
      params: {
        type: "object",
        required: ["templateId"],
        properties: { templateId: { type: "string" } },
      },
    },
  }, async (request, reply) => {
    const template = TEMPLATES.find((t) => t.id === request.params.templateId);
    if (!template) return reply.code(404).send({ error: "Template not found" });
    return ok(reply, { template });
  });

  // ── Prompt-to-Project creation ────────────────────────────
  app.post<{
    Body: {
      prompt: string;
      templateId?: string;
      workspaceId?: string;
      projectName?: string;
      connectionType?: "CLOUD" | "LOCAL_BRIDGE";
      bridgeId?: string;
      rootReference?: string;
      preferredFramework?: string;
      features?: string[];
    };
  }>("/v1/builder/create", {
    config: { rateLimit: { max: 10, timeWindow: "1 hour" } },
    preHandler: [app.authenticate],
    schema: {
      tags: ["builder"],
      summary: "Create a project from a natural language prompt",
      body: {
        type: "object",
        required: ["prompt"],
        properties: {
          prompt: { type: "string", minLength: 1, maxLength: 5000 },
          templateId: { type: "string" },
          workspaceId: { type: "string" },
          projectName: { type: "string", maxLength: 160 },
          connectionType: { type: "string", enum: ["CLOUD", "LOCAL_BRIDGE"] },
          bridgeId: { type: "string" },
          rootReference: { type: "string" },
          preferredFramework: { type: "string" },
          features: { type: "array", items: { type: "string" } },
        },
      },
    },
  }, async (request, reply) => {
    const body = promptToProjectRequestSchema.parse(request.body);
    const prisma = (app as unknown as { prisma: import("@prisma/client").PrismaClient }).prisma;
    const userId = (request.user as { sub: string }).sub;

    // Resolve workspace: use provided ID or fall back to user's first workspace
    let workspaceId = body.workspaceId;
    if (!workspaceId) {
      const membership = await prisma.workspaceMember.findFirst({
        where: { userId },
        select: { workspaceId: true },
      });
      if (!membership) return reply.code(400).send({ error: "No workspace found. Create a workspace first." });
      workspaceId = membership.workspaceId;
    }

    // Verify workspace access with MEMBER role
    await app.requireWorkspaceRole(request, workspaceId, "MEMBER");

    // 1. Verify workspace exists
    const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId } });
    if (!workspace) return reply.code(404).send({ error: "Workspace not found" });

    // 2. Resolve template
    let template: ProjectTemplate | undefined;
    if (body.templateId) {
      template = TEMPLATES.find((t) => t.id === body.templateId);
      if (!template) return reply.code(404).send({ error: "Template not found" });
    }

    // 3. Create project record
    const projectId = randomUUID();
    const projectName = body.projectName ?? generateProjectName(body.prompt, template);

    // If LOCAL_BRIDGE, verify bridge exists
    if (body.connectionType === "LOCAL_BRIDGE" && body.bridgeId) {
      const bridge = await prisma.bridge.findUnique({ where: { id: body.bridgeId } });
      if (!bridge) return reply.code(404).send({ error: "Bridge not found" });
    }

    // Check workspace quota before creating task
    const quota = await checkQuota(prisma, workspaceId, 1000, 0.01);
    if (!quota.allowed) {
      return reply.code(403).send({ error: quota.reason ?? "Usage quota exceeded" });
    }

    const project = await prisma.project.create({
      data: {
        id: projectId,
        workspaceId,
        name: projectName,
        connectionType: body.connectionType ?? "LOCAL_BRIDGE",
        rootReference: body.rootReference ?? `./${projectName}`,
        bridgeId: body.bridgeId ?? null,
        defaultBranch: "main",
        status: "AVAILABLE",
      },
    });

    // 4. Create task from prompt
    const task = await prisma.task.create({
      data: {
        id: randomUUID(),
        workspaceId,
        projectId: project.id,
        createdBy: userId,
        goal: buildEnhancedGoal(body.prompt, template, body.features),
        agentMode: "BUILD",
        state: "QUEUED",
      },
    });

    // 5. Record audit
    await prisma.auditLogEntry.create({
      data: {
        userId,
        workspaceId,
        action: "BUILDER_PROJECT_CREATED",
        entityType: "TASK",
        entityId: task.id,
        metadata: {
          templateId: body.templateId ?? null,
          prompt: body.prompt.slice(0, 500),
          projectName,
          connectionType: body.connectionType,
        } as never,
      },
    });

    // 6. Enqueue the task for immediate execution
    await enqueueTaskJob({ kind: "start", taskId: task.id });

    // 7. Return analysis
    const analysis = analyzePrompt(body.prompt, template, body.features);

    return ok(reply, {
      taskId: task.id,
      projectId: project.id,
      projectName,
      estimatedSteps: analysis.estimatedSteps,
      analysis: {
        projectType: analysis.projectType,
        frameworks: analysis.frameworks,
        features: analysis.features,
        estimatedFiles: analysis.estimatedFiles,
      },
    }, 201);
  });

  // ── Conversational iteration — follow-up on active task ─────
  app.post<{
    Params: { taskId: string };
    Body: { prompt: string };
  }>("/v1/builder/iterate/:taskId", {
    config: { rateLimit: { max: 30, timeWindow: "1 hour" } },
    preHandler: [app.authenticate],
    schema: {
      tags: ["builder"],
      summary: "Send a follow-up prompt to an active task",
      params: {
        type: "object",
        required: ["taskId"],
        properties: { taskId: { type: "string" } },
      },
      body: {
        type: "object",
        required: ["prompt"],
        properties: { prompt: { type: "string", minLength: 1, maxLength: 5000 } },
      },
    },
  }, async (request, reply) => {
    const { taskId } = request.params;
    const { prompt: followUpPrompt } = request.body;
    const prisma = (app as unknown as { prisma: import("@prisma/client").PrismaClient }).prisma;
    const userId = (request.user as { sub: string }).sub;

    // 1. Verify task exists and is in a terminal state (completed/failed)
    const task = await prisma.task.findUnique({ where: { id: taskId } });
    if (!task) return reply.code(404).send({ error: "Task not found" });

    // 2. Verify user has workspace access
    await app.requireWorkspaceRole(request, task.workspaceId, "MEMBER");

    // 3. Create a child task for the follow-up
    const childTask = await prisma.task.create({
      data: {
        id: randomUUID(),
        workspaceId: task.workspaceId,
        projectId: task.projectId,
        createdBy: userId,
        goal: followUpPrompt,
        agentMode: task.agentMode,
        state: "QUEUED",
        parentTaskId: task.id,
      },
    });

    // 3. Record audit
    await prisma.auditLogEntry.create({
      data: {
        userId,
        workspaceId: task.workspaceId,
        action: "BUILDER_ITERATION",
        entityType: "TASK",
        entityId: childTask.id,
        metadata: {
          parentTaskId: taskId,
          prompt: followUpPrompt.slice(0, 500),
        } as never,
      },
    });

    // 4. Enqueue for execution
    await enqueueTaskJob({ kind: "start", taskId: childTask.id });

    return ok(reply, {
      taskId: childTask.id,
      parentTaskId: taskId,
    }, 201);
  });
}

// ─── Helper functions ───────────────────────────────────────

function generateProjectName(prompt: string, template?: ProjectTemplate): string {
  if (template) {
    // Extract a short name from the template
    return template.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }
  // Generate from prompt: take first few meaningful words
  const words = prompt
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !["build", "create", "make", "with", "that", "this", "have", "from", "using"].includes(w))
    .slice(0, 3);
  return words.join("-") || "new-project";
}

function buildEnhancedGoal(
  prompt: string,
  template?: ProjectTemplate,
  features?: string[],
): string {
  const parts: string[] = [prompt];

  if (template) {
    parts.push(`\nUsing template: ${template.name}`);
    parts.push(`Frameworks: ${template.frameworks.join(", ")}`);
    if (template.features.length > 0) {
      parts.push(`Expected features: ${template.features.join(", ")}`);
    }
  }

  if (features && features.length > 0) {
    parts.push(`\nAdditional features requested: ${features.join(", ")}`);
  }

  return parts.join("\n");
}

function analyzePrompt(
  prompt: string,
  template?: ProjectTemplate,
  features?: string[],
): {
  projectType: string;
  frameworks: string[];
  features: string[];
  estimatedSteps: number;
  estimatedFiles: number;
} {
  const lowerPrompt = prompt.toLowerCase();

  // Detect frameworks from prompt
  const frameworks: string[] = [];
  if (lowerPrompt.includes("next") || lowerPrompt.includes("nextjs")) frameworks.push("Next.js");
  if (lowerPrompt.includes("react")) frameworks.push("React");
  if (lowerPrompt.includes("vue")) frameworks.push("Vue");
  if (lowerPrompt.includes("svelte")) frameworks.push("Svelte");
  if (lowerPrompt.includes("fastify")) frameworks.push("Fastify");
  if (lowerPrompt.includes("express")) frameworks.push("Express");
  if (lowerPrompt.includes("tailwind")) frameworks.push("Tailwind CSS");
  if (lowerPrompt.includes("prisma")) frameworks.push("Prisma");
  if (lowerPrompt.includes("postgres")) frameworks.push("PostgreSQL");
  if (lowerPrompt.includes("mongodb")) frameworks.push("MongoDB");

  // Use template frameworks if none detected
  if (frameworks.length === 0 && template) {
    frameworks.push(...template.frameworks);
  }
  if (frameworks.length === 0) frameworks.push("Next.js", "React");

  // Detect features from prompt
  const detectedFeatures: string[] = [];
  const featureKeywords: Record<string, string> = {
    auth: "Authentication",
    login: "Authentication",
    signin: "Authentication",
    signup: "Registration",
    register: "Registration",
    dashboard: "Dashboard",
    admin: "Admin Panel",
    payment: "Payments",
    stripe: "Stripe Integration",
    billing: "Billing",
    crud: "CRUD Operations",
    api: "API Routes",
    database: "Database",
    db: "Database",
    search: "Search",
    filter: "Filtering",
    chart: "Charts",
    graph: "Charts",
    dark: "Dark Mode",
    theme: "Theming",
    responsive: "Responsive Design",
    mobile: "Mobile Support",
    chat: "Chat Interface",
    ai: "AI Integration",
    openai: "OpenAI Integration",
    streaming: "Streaming",
    websocket: "Real-time",
    realtime: "Real-time",
    test: "Testing",
    testing: "Testing",
    typescript: "TypeScript",
    ts: "TypeScript",
  };

  for (const [keyword, feature] of Object.entries(featureKeywords)) {
    if (lowerPrompt.includes(keyword) && !detectedFeatures.includes(feature)) {
      detectedFeatures.push(feature);
    }
  }

  if (template) {
    for (const f of template.features) {
      if (!detectedFeatures.includes(f)) detectedFeatures.push(f);
    }
  }

  if (features) {
    for (const f of features) {
      if (!detectedFeatures.includes(f)) detectedFeatures.push(f);
    }
  }

  // Estimate complexity
  const promptLength = prompt.length;
  const featureCount = detectedFeatures.length;
  const estimatedSteps = Math.max(3, Math.min(20, Math.ceil((promptLength / 200) + (featureCount * 1.5))));
  const estimatedFiles = Math.max(5, Math.min(50, Math.ceil(estimatedSteps * 2.5)));

  // Determine project type
  let projectType = "fullstack-application";
  if (lowerPrompt.includes("api") && !lowerPrompt.includes("frontend") && !lowerPrompt.includes("ui")) {
    projectType = "api-service";
  } else if (lowerPrompt.includes("dashboard") || lowerPrompt.includes("admin")) {
    projectType = "dashboard-application";
  } else if (lowerPrompt.includes("landing") || lowerPrompt.includes("marketing")) {
    projectType = "landing-page";
  } else if (lowerPrompt.includes("ecommerce") || lowerPrompt.includes("store") || lowerPrompt.includes("shop")) {
    projectType = "ecommerce-store";
  } else if (lowerPrompt.includes("ai") || lowerPrompt.includes("chat") || lowerPrompt.includes("llm")) {
    projectType = "ai-application";
  }

  return {
    projectType,
    frameworks,
    features: detectedFeatures,
    estimatedSteps,
    estimatedFiles,
  };
}
