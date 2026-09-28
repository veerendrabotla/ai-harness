import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { BridgeGatewayClient, errors, getEnv } from "@ai-harness/shared";
import { randomUUID } from "node:crypto";
import { ok, reqParam } from "../../lib/http.js";

const startSchema = z.object({
  command: z.string().min(1).max(2048),
  port: z.number().int().min(1).max(65535).default(3000),
  cwd: z.string().default("."),
});

interface PreviewInstance {
  id: string;
  projectId: string;
  bridgeId: string;
  command: string;
  port: number;
  status: "starting" | "running" | "error" | "stopped";
  url: string | null;
  processId: string | null;
  startedAt: Date;
  logs: string[];
  logOffset: number;
}

const instances = new Map<string, PreviewInstance>();

async function resolveBridge(projectId: string, prisma: FastifyInstance["prisma"]) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    include: { bridge: true },
  });
  if (!project) throw errors.notFound("Project");
  if (project.connectionType !== "LOCAL_BRIDGE" || !project.bridgeId || !project.bridge) {
    throw errors.projectUnavailable("Preview requires a Local Bridge project");
  }
  if (project.bridge.status !== "CONNECTED") {
    throw errors.bridgeDisconnected("The bridge owning this project is not connected");
  }
  return { project, bridge: project.bridge };
}

function gateway(_app: FastifyInstance) {
  const env = getEnv();
  return new BridgeGatewayClient({ baseUrl: env.BRIDGE_GATEWAY_URL, internalToken: env.BRIDGE_INTERNAL_TOKEN });
}

/**
 * Preview management API.
 * Manages dev server processes through the Bridge Gateway.
 * Uses process.start/process.stop/process.status/process.logs bridge kinds.
 */
export function registerPreviewRoutes(app: FastifyInstance) {
  // Start a preview server
  app.post("/v1/projects/:projectId/preview/start", { preHandler: [app.authenticate] }, async (req, reply) => {
    const projectId = reqParam(req, "projectId");
    const input = startSchema.parse(req.body);
    const { project, bridge } = await resolveBridge(projectId, app.prisma);
    await app.requireWorkspaceRole(req, project.workspaceId, "MEMBER");

    // Stop any existing preview for this project
    const existing = Array.from(instances.values()).find((i) => i.projectId === projectId && i.status === "running");
    if (existing) {
      const gw = gateway(app);
      await gw.execute(bridge.id, "process.stop", { processId: existing.processId }, 10_000).catch((err) => {
        req.log.error({ err }, "[Preview] Failed to stop existing preview process:");
      });
      instances.delete(existing.id);
    }

    const gw = gateway(app);
    const id = randomUUID();

    // Start the process through the bridge using process.start
    const response = await gw.execute(
      bridge.id,
      "process.start",
      { root: project.rootReference, command: input.command, cwd: input.cwd },
      10_000,
    );

    const instance: PreviewInstance = {
      id,
      projectId,
      bridgeId: bridge.id,
      command: input.command,
      port: input.port,
      status: response.ok ? "running" : "error",
      url: response.ok ? `http://localhost:${input.port}` : null,
      processId: response.ok ? (response.data?.processId as string) ?? null : null,
      startedAt: new Date(),
      logs: response.ok ? [] : [response.error?.message ?? "Failed to start"],
      logOffset: 0,
    };
    instances.set(id, instance);

    return ok(reply, {
      id: instance.id,
      projectId: instance.projectId,
      command: instance.command,
      port: instance.port,
      status: instance.status,
      url: instance.url,
      processId: instance.processId,
      startedAt: instance.startedAt.toISOString(),
    });
  });

  // Stop a preview server
  app.post("/v1/projects/:projectId/preview/stop", { preHandler: [app.authenticate] }, async (req, reply) => {
    const projectId = reqParam(req, "projectId");
    const project = await app.prisma.project.findUnique({ where: { id: projectId }, include: { bridge: true } });
    if (!project) throw errors.notFound("Project");
    await app.requireWorkspaceRole(req, project.workspaceId, "MEMBER");

    const instance = Array.from(instances.values()).find((i) => i.projectId === projectId && i.status === "running");
    if (!instance) return ok(reply, { success: true, message: "No running preview" });

    if (project.bridge && instance.processId) {
      const gw = gateway(app);
      await gw.execute(project.bridge.id, "process.stop", { processId: instance.processId }, 10_000).catch((err) => {
        req.log.error({ err }, "[Preview] Failed to stop preview process:");
      });
    }

    instance.status = "stopped";
    return ok(reply, { success: true });
  });

  // Restart a preview server
  app.post("/v1/projects/:projectId/preview/restart", { preHandler: [app.authenticate] }, async (req, reply) => {
    const projectId = reqParam(req, "projectId");
    const existing = Array.from(instances.values()).find((i) => i.projectId === projectId);
    if (!existing) throw errors.notFound("Preview instance");

    const project = await app.prisma.project.findUnique({ where: { id: projectId }, include: { bridge: true } });
    if (!project) throw errors.notFound("Project");
    await app.requireWorkspaceRole(req, project.workspaceId, "MEMBER");

    // Stop old
    if (project.bridge && existing.processId && existing.status === "running") {
      const gw = gateway(app);
      await gw.execute(project.bridge.id, "process.stop", { processId: existing.processId }, 10_000).catch((err) => {
        req.log.error({ err }, "[Preview] Failed to stop old preview process:");
      });
    }

    instances.delete(existing.id);

    // Start new via the start route logic
    const { project: p, bridge } = await resolveBridge(projectId, app.prisma);
    const gw = gateway(app);
    const newId = randomUUID();

    const response = await gw.execute(
      bridge.id,
      "process.start",
      { root: p.rootReference, command: existing.command, cwd: "." },
      10_000,
    );

    const instance: PreviewInstance = {
      id: newId,
      projectId,
      bridgeId: bridge.id,
      command: existing.command,
      port: existing.port,
      status: response.ok ? "running" : "error",
      url: response.ok ? `http://localhost:${existing.port}` : null,
      processId: response.ok ? (response.data?.processId as string) ?? null : null,
      startedAt: new Date(),
      logs: response.ok ? [] : [response.error?.message ?? "Failed to start"],
      logOffset: 0,
    };
    instances.set(newId, instance);

    return ok(reply, {
      id: instance.id,
      projectId: instance.projectId,
      command: instance.command,
      port: instance.port,
      status: instance.status,
      url: instance.url,
      processId: instance.processId,
      startedAt: instance.startedAt.toISOString(),
    });
  });

  // Get preview status (polls bridge for live status)
  app.get("/v1/projects/:projectId/preview", { preHandler: [app.authenticate] }, async (req, reply) => {
    const projectId = reqParam(req, "projectId");
    const project = await app.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw errors.notFound("Project");
    await app.requireWorkspaceRole(req, project.workspaceId, "VIEWER");

    const instance = Array.from(instances.values()).find((i) => i.projectId === projectId);
    if (!instance) return ok(reply, { active: false });

    // If running, poll bridge for status
    if (instance.status === "running" && instance.processId) {
      const bridge = await app.prisma.bridge.findUnique({ where: { id: instance.bridgeId } });
      if (bridge?.status === "CONNECTED") {
        const gw = gateway(app);
        const statusResp = await gw.execute(bridge.id, "process.status", { processId: instance.processId }, 5_000).catch(() => null);
        if (statusResp?.ok && statusResp.data?.status === "exited") {
          instance.status = "error";
          instance.logs.push(`Process exited with code ${statusResp.data.exitCode}`);
        }
      }
    }

    return ok(reply, {
      active: instance.status === "running",
      id: instance.id,
      command: instance.command,
      port: instance.port,
      status: instance.status,
      url: instance.url,
      processId: instance.processId,
      startedAt: instance.startedAt.toISOString(),
      logs: instance.logs.slice(-50),
    });
  });

  // Get preview logs (with polling from bridge)
  app.get("/v1/projects/:projectId/preview/logs", { preHandler: [app.authenticate] }, async (req, reply) => {
    const projectId = reqParam(req, "projectId");
    const project = await app.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw errors.notFound("Project");
    await app.requireWorkspaceRole(req, project.workspaceId, "VIEWER");

    const instance = Array.from(instances.values()).find((i) => i.projectId === projectId);
    if (!instance) return ok(reply, { logs: "" });

    // Poll bridge for new logs
    if (instance.processId && instance.status === "running") {
      const bridge = await app.prisma.bridge.findUnique({ where: { id: instance.bridgeId } });
      if (bridge?.status === "CONNECTED") {
        const gw = gateway(app);
        const logsResp = await gw.execute(
          bridge.id,
          "process.logs",
          { processId: instance.processId, offset: instance.logOffset },
          5_000,
        ).catch(() => null);
        if (logsResp?.ok && logsResp.data) {
          const newLogs = String(logsResp.data.logs ?? "");
          if (newLogs) {
            instance.logs.push(newLogs);
            instance.logOffset = Number(logsResp.data.totalLines ?? instance.logOffset);
          }
          if (logsResp.data.exited === true) {
            instance.status = "error";
          }
        }
      }
    }

    return ok(reply, { logs: instance.logs.join(""), totalLines: instance.logs.length });
  });

  // ── Auto-detect preview configuration from project ─────────
  app.get("/v1/projects/:projectId/preview/detect", { preHandler: [app.authenticate] }, async (req, reply) => {
    const projectId = reqParam(req, "projectId");
    const project = await app.prisma.project.findUnique({
      where: { id: projectId },
      include: { bridge: true },
    });
    if (!project) throw errors.notFound("Project");
    await app.requireWorkspaceRole(req, project.workspaceId, "VIEWER");

    if (project.connectionType !== "LOCAL_BRIDGE" || !project.bridge || project.bridge.status !== "CONNECTED") {
      return ok(reply, {
        detected: false,
        command: "npm run dev",
        port: 3000,
        reason: "No connected bridge available for detection",
      });
    }

    try {
      const gw = gateway(app);
      // Read package.json from the project root
      const result = await gw.execute(
        project.bridge.id,
        "fs.read",
        { root: project.rootReference, path: "package.json" },
        5_000,
      );

      if (!result.ok || !result.data?.content) {
        return ok(reply, {
          detected: false,
          command: "npm run dev",
          port: 3000,
          reason: "No package.json found",
        });
      }

      const content = String(result.data.content);
      const pkg = JSON.parse(content) as Record<string, unknown>;
      const scripts = (pkg.scripts ?? {}) as Record<string, string>;
      const deps = { ...((pkg.dependencies ?? {}) as Record<string, string>), ...((pkg.devDependencies ?? {}) as Record<string, string>) };

      // Detect framework and command
      const detection = detectPreviewConfig(scripts, deps, pkg);

      return ok(reply, {
        detected: true,
        command: detection.command,
        port: detection.port,
        framework: detection.framework,
        reason: detection.reason,
      });
    } catch (err) {
      req.log.error({ err }, "[Preview] Failed to detect preview config:");
      return ok(reply, {
        detected: false,
        command: "npm run dev",
        port: 3000,
        reason: "Failed to read project configuration",
      });
    }
  });
}

// ─── Preview detection logic ─────────────────────────────────

function detectPreviewConfig(
  scripts: Record<string, string>,
  deps: Record<string, string>,
  _pkg: Record<string, unknown>,
): { command: string; port: number; framework: string; reason: string } {
  // Next.js
  if (deps["next"]) {
    const devScript = scripts["dev"];
    if (devScript) {
      return { command: "npm run dev", port: 3000, framework: "Next.js", reason: "Detected Next.js with dev script" };
    }
    return { command: "npx next dev", port: 3000, framework: "Next.js", reason: "Detected Next.js" };
  }

  // Vite (React, Vue, Svelte, etc.)
  if (deps["vite"]) {
    const devScript = scripts["dev"];
    if (devScript) {
      return { command: "npm run dev", port: 5173, framework: "Vite", reason: "Detected Vite with dev script" };
    }
    return { command: "npx vite", port: 5173, framework: "Vite", reason: "Detected Vite" };
  }

  // Create React App
  if (deps["react-scripts"]) {
    return { command: "npm start", port: 3000, framework: "Create React App", reason: "Detected Create React App" };
  }

  // Angular
  if (deps["@angular/core"]) {
    return { command: "npx ng serve", port: 4200, framework: "Angular", reason: "Detected Angular" };
  }

  // Vue CLI
  if (deps["@vue/cli-service"]) {
    return { command: "npm run serve", port: 8080, framework: "Vue CLI", reason: "Detected Vue CLI" };
  }

  // Nuxt
  if (deps["nuxt"]) {
    return { command: "npm run dev", port: 3000, framework: "Nuxt", reason: "Detected Nuxt" };
  }

  // SvelteKit
  if (deps["@sveltejs/kit"]) {
    return { command: "npm run dev", port: 5173, framework: "SvelteKit", reason: "Detected SvelteKit" };
  }

  // Astro
  if (deps["astro"]) {
    return { command: "npm run dev", port: 4321, framework: "Astro", reason: "Detected Astro" };
  }

  // Remix
  if (deps["@remix-run/dev"]) {
    return { command: "npm run dev", port: 3000, framework: "Remix", reason: "Detected Remix" };
  }

  // Express / Fastify / Koa (backend only)
  if (deps["express"] || deps["fastify"] || deps["koa"]) {
    const devScript = scripts["dev"];
    if (devScript) {
      return { command: "npm run dev", port: 3000, framework: "Backend", reason: "Detected backend framework with dev script" };
    }
    return { command: "node .", port: 3000, framework: "Backend", reason: "Detected backend framework" };
  }

  // Fallback: check for common scripts
  if (scripts["dev"]) {
    return { command: "npm run dev", port: 3000, framework: "Unknown", reason: "Found dev script" };
  }
  if (scripts["start"]) {
    return { command: "npm start", port: 3000, framework: "Unknown", reason: "Found start script" };
  }

  // Final fallback
  return { command: "npm run dev", port: 3000, framework: "Unknown", reason: "Default fallback" };
}
