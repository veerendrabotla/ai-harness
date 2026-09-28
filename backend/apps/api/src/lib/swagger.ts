import fastifySwagger from "@fastify/swagger";
import fastifySwaggerUi from "@fastify/swagger-ui";
import type { FastifyInstance } from "fastify";
import { openApiSchemas } from "./swagger-schemas.js";

export async function setupSwagger(app: FastifyInstance) {
  await app.register(fastifySwagger, {
    openapi: {
      info: {
        title: "AI Harness API",
        description:
          "AI-native software development platform API. " +
          "Manages workspaces, projects, tasks, deployments, AI provider integrations, " +
          "team collaboration, and real-time multiplayer editing.",
        version: "1.0.0",
        contact: {
          name: "AI Harness Team",
        },
        license: {
          name: "Proprietary",
        },
      },
      servers: [
        { url: "http://localhost:4000", description: "Local development" },
        { url: "https://api.ai-harness.dev", description: "Production" },
      ],
      components: {
        securitySchemes: {
          bearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "JWT",
            description: "JWT access token from /v1/auth/login or /v1/auth/signup",
          },
        },
        schemas: openApiSchemas,
      },
      security: [{ bearerAuth: [] }],
      tags: [
        { name: "auth", description: "Authentication, registration, and session management" },
        { name: "workspaces", description: "Workspace CRUD, membership, and settings" },
        { name: "projects", description: "Project management, file browsing, and cloning" },
        { name: "tasks", description: "Task creation, execution, and monitoring" },
        { name: "plans", description: "Execution plans and step management" },
        { name: "providers", description: "AI model provider connections and health" },
        { name: "deploy", description: "Application deployment and rollback" },
        { name: "mcp", description: "MCP server configuration" },
        { name: "bridges", description: "Local bridge device connections" },
        { name: "sso", description: "SSO/SAML/OIDC configuration" },
        { name: "admin", description: "Administrative operations and bulk actions" },
        { name: "webcontainer", description: "WebContainer session management" },
        { name: "multiplayer", description: "Real-time collaborative editing" },
        { name: "activity", description: "Audit trail and activity feed" },
        { name: "approvals", description: "Approval workflows for tasks" },
        { name: "billing", description: "Usage tracking and billing" },
        { name: "notifications", description: "Notifications, inbox, and webhooks" },
        { name: "api-keys", description: "API key management" },
        { name: "search", description: "Full-text search across resources" },
        { name: "builder", description: "Builder interface and configuration" },
        { name: "sandbox", description: "Sandbox environment management" },
        { name: "knowledge", description: "Knowledge base entries and documentation" },
        { name: "playground", description: "Interactive AI playground" },
        { name: "usage", description: "Token usage tracking and analytics" },
        { name: "organizations", description: "Organization management and membership" },
        { name: "webhooks", description: "Webhook subscription and delivery" },
        { name: "custom-roles", description: "Custom role definitions and permissions" },
        { name: "task-runs", description: "Task run execution and history" },
        { name: "execution-traces", description: "Execution trace logs and debugging" },
        { name: "file-versions", description: "File version history and diffing" },
        { name: "project-memory", description: "Project memory and context persistence" },
        { name: "rate-limits", description: "Rate limit configuration and monitoring" },
        { name: "audit-retention", description: "Audit log retention policies" },
        { name: "feature-flags", description: "Feature flag management and toggling" },
        { name: "cost-alerts", description: "Cost threshold alerts and notifications" },
        { name: "task-branches", description: "Task branching and parallel execution" },
        { name: "task-templates", description: "Reusable task templates" },
        { name: "project-permissions", description: "Project-level permission grants" },
      ],
    },
  });

  await app.register(fastifySwaggerUi, {
    routePrefix: "/docs",
    uiConfig: {
      docExpansion: "list",
      deepLinking: true,
      filter: true,
      showExtensions: true,
      showCommonExtensions: true,
      defaultModelsExpandDepth: 2,
      defaultModelExpandDepth: 2,
    },
    uiHooks: {
      onRequest(_request, _reply, next) {
        next();
      },
    },
  });
}
