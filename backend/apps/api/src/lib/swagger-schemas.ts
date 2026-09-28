/**
 * Shared OpenAPI schema definitions for Swagger documentation.
 * Reused across route files via fastify-swagger's $ref mechanism.
 */

export const errorSchema = {
  type: "object" as const,
  properties: {
    error: {
      type: "object" as const,
      properties: {
        code: { type: "string" as const, description: "Machine-readable error code" },
        message: { type: "string" as const, description: "Human-readable error message" },
      },
      required: ["code", "message"],
    },
    requestId: { type: "string" as const, format: "uuid" },
  },
};

export const paginationQuerySchema = {
  type: "object" as const,
  properties: {
    page: { type: "integer" as const, minimum: 1, default: 1, description: "Page number" },
    limit: { type: "integer" as const, minimum: 1, maximum: 100, default: 20, description: "Items per page" },
    sort: { type: "string" as const, enum: ["asc", "desc"], default: "desc", description: "Sort order" },
  },
};

export const workspaceParamsSchema = {
  type: "object" as const,
  required: ["workspaceId"],
  properties: {
    workspaceId: { type: "string" as const, format: "uuid", description: "Workspace ID" },
  },
};

export const projectParamsSchema = {
  type: "object" as const,
  required: ["workspaceId", "projectId"],
  properties: {
    workspaceId: { type: "string" as const, format: "uuid", description: "Workspace ID" },
    projectId: { type: "string" as const, format: "uuid", description: "Project ID" },
  },
};

export const taskParamsSchema = {
  type: "object" as const,
  required: ["taskId"],
  properties: {
    taskId: { type: "string" as const, format: "uuid", description: "Task ID" },
  },
};

export const userResponseSchema = {
  type: "object" as const,
  properties: {
    id: { type: "string" as const, format: "uuid" },
    email: { type: "string" as const, format: "email" },
    displayName: { type: "string" as const },
    avatarUrl: { type: "string" as const, nullable: true },
    createdAt: { type: "string" as const, format: "date-time" },
  },
};

export const workspaceResponseSchema = {
  type: "object" as const,
  properties: {
    id: { type: "string" as const, format: "uuid" },
    name: { type: "string" as const },
    description: { type: "string" as const, nullable: true },
    executionMode: { type: "string" as const, enum: ["LOCAL", "CLOUD"] },
    status: { type: "string" as const, enum: ["ACTIVE", "ARCHIVED"] },
    ownerId: { type: "string" as const, format: "uuid" },
    createdAt: { type: "string" as const, format: "date-time" },
    updatedAt: { type: "string" as const, format: "date-time" },
  },
};

export const projectResponseSchema = {
  type: "object" as const,
  properties: {
    id: { type: "string" as const, format: "uuid" },
    workspaceId: { type: "string" as const, format: "uuid" },
    name: { type: "string" as const },
    connectionType: { type: "string" as const, enum: ["LOCAL_BRIDGE", "REMOTE"] },
    repositoryUrl: { type: "string" as const, nullable: true },
    rootReference: { type: "string" as const },
    defaultBranch: { type: "string" as const, nullable: true },
    status: { type: "string" as const },
    createdAt: { type: "string" as const, format: "date-time" },
  },
};

export const taskResponseSchema = {
  type: "object" as const,
  properties: {
    id: { type: "string" as const, format: "uuid" },
    workspaceId: { type: "string" as const, format: "uuid" },
    projectId: { type: "string" as const, format: "uuid" },
    goal: { type: "string" as const },
    state: { type: "string" as const },
    agentMode: { type: "string" as const },
    createdAt: { type: "string" as const, format: "date-time" },
    updatedAt: { type: "string" as const, format: "date-time" },
    inputTokens: { type: "integer" as const },
    outputTokens: { type: "integer" as const },
    totalTokens: { type: "integer" as const },
    estimatedCost: { type: "number" as const },
  },
};

export const providerResponseSchema = {
  type: "object" as const,
  properties: {
    id: { type: "string" as const, format: "uuid" },
    providerType: { type: "string" as const },
    displayName: { type: "string" as const },
    hasCredential: { type: "boolean" as const },
    createdAt: { type: "string" as const, format: "date-time" },
  },
};

export const deploymentResponseSchema = {
  type: "object" as const,
  properties: {
    id: { type: "string" as const, format: "uuid" },
    projectId: { type: "string" as const, format: "uuid" },
    status: { type: "string" as const, enum: ["PENDING", "BUILDING", "DEPLOYING", "SUCCESS", "FAILED"] },
    environment: { type: "string" as const, enum: ["production", "preview", "staging"] },
    url: { type: "string" as const, nullable: true },
    createdAt: { type: "string" as const, format: "date-time" },
    completedAt: { type: "string" as const, format: "date-time", nullable: true },
  },
};

export const planResponseSchema = {
  type: "object" as const,
  properties: {
    id: { type: "string" as const, format: "uuid" },
    taskId: { type: "string" as const, format: "uuid" },
    title: { type: "string" as const },
    steps: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          order: { type: "integer" as const },
          action: { type: "string" as const },
          description: { type: "string" as const },
        },
      },
    },
    status: { type: "string" as const },
    createdAt: { type: "string" as const, format: "date-time" },
  },
};

export const activityResponseSchema = {
  type: "object" as const,
  properties: {
    id: { type: "string" as const, format: "uuid" },
    taskId: { type: "string" as const, format: "uuid" },
    eventType: { type: "string" as const },
    payload: { type: "object" as const },
    createdAt: { type: "string" as const, format: "date-time" },
  },
};

export const authResponseSchema = {
  type: "object" as const,
  properties: {
    user: { $ref: "#/components/schemas/User" },
    accessToken: { type: "string" as const, description: "JWT access token" },
    refreshToken: { type: "string" as const, description: "JWT refresh token" },
  },
};

export const apiKeyResponseSchema = {
  type: "object" as const,
  properties: {
    id: { type: "string" as const, format: "uuid" },
    workspaceId: { type: "string" as const, format: "uuid" },
    name: { type: "string" as const },
    keyPrefix: { type: "string" as const },
    permissions: { type: "object" as const },
    lastUsedAt: { type: "string" as const, format: "date-time", nullable: true },
    expiresAt: { type: "string" as const, format: "date-time", nullable: true },
    createdAt: { type: "string" as const, format: "date-time" },
    updatedAt: { type: "string" as const, format: "date-time" },
  },
};

export const mcpServerResponseSchema = {
  type: "object" as const,
  properties: {
    id: { type: "string" as const, format: "uuid" },
    ownerId: { type: "string" as const, format: "uuid" },
    name: { type: "string" as const },
    transportType: { type: "string" as const },
    status: { type: "string" as const },
    createdAt: { type: "string" as const, format: "date-time" },
    updatedAt: { type: "string" as const, format: "date-time" },
    discoveredTools: { type: "object" as const, nullable: true },
  },
};

export const bridgeResponseSchema = {
  type: "object" as const,
  properties: {
    id: { type: "string" as const, format: "uuid" },
    userId: { type: "string" as const, format: "uuid" },
    name: { type: "string" as const },
    version: { type: "string" as const },
    status: { type: "string" as const },
    capabilities: { type: "object" as const, nullable: true },
    lastSeenAt: { type: "string" as const, format: "date-time", nullable: true },
    createdAt: { type: "string" as const, format: "date-time" },
  },
};

export const ssoConfigResponseSchema = {
  type: "object" as const,
  properties: {
    id: { type: "string" as const, format: "uuid" },
    workspaceId: { type: "string" as const, format: "uuid" },
    provider: { type: "string" as const },
    enabled: { type: "boolean" as const },
    clientId: { type: "string" as const, nullable: true },
    issuerUrl: { type: "string" as const, nullable: true },
    metadataUrl: { type: "string" as const, nullable: true },
    domain: { type: "string" as const, nullable: true },
    createdAt: { type: "string" as const, format: "date-time" },
    updatedAt: { type: "string" as const, format: "date-time" },
  },
};

export const knowledgeEntryResponseSchema = {
  type: "object" as const,
  properties: {
    id: { type: "string" as const, format: "uuid" },
    workspaceId: { type: "string" as const, format: "uuid" },
    title: { type: "string" as const },
    content: { type: "string" as const },
    type: { type: "string" as const, enum: ["DOCUMENT", "CODE_SNIPPET", "LINK", "NOTE"] },
    tags: { type: "array" as const, items: { type: "string" as const } },
    createdAt: { type: "string" as const, format: "date-time" },
    updatedAt: { type: "string" as const, format: "date-time" },
  },
};

export const webhookSubscriptionResponseSchema = {
  type: "object" as const,
  properties: {
    id: { type: "string" as const, format: "uuid" },
    workspaceId: { type: "string" as const, format: "uuid" },
    url: { type: "string" as const },
    eventTypes: { type: "array" as const, items: { type: "string" as const } },
    maxRetries: { type: "integer" as const },
    status: { type: "string" as const },
    createdAt: { type: "string" as const, format: "date-time" },
    updatedAt: { type: "string" as const, format: "date-time" },
  },
};

export const notificationResponseSchema = {
  type: "object" as const,
  properties: {
    id: { type: "string" as const, format: "uuid" },
    userId: { type: "string" as const, format: "uuid" },
    title: { type: "string" as const },
    message: { type: "string" as const },
    type: { type: "string" as const },
    metadata: { type: "object" as const, nullable: true },
    readAt: { type: "string" as const, format: "date-time", nullable: true },
    createdAt: { type: "string" as const, format: "date-time" },
  },
};

export const costAlertResponseSchema = {
  type: "object" as const,
  properties: {
    id: { type: "string" as const, format: "uuid" },
    workspaceId: { type: "string" as const, format: "uuid" },
    thresholdType: { type: "string" as const },
    thresholdValue: { type: "number" as const },
    period: { type: "string" as const },
    enabled: { type: "boolean" as const },
    lastTriggered: { type: "string" as const, format: "date-time", nullable: true },
    createdAt: { type: "string" as const, format: "date-time" },
    updatedAt: { type: "string" as const, format: "date-time" },
  },
};

export const taskTemplateResponseSchema = {
  type: "object" as const,
  properties: {
    id: { type: "string" as const, format: "uuid" },
    workspaceId: { type: "string" as const, format: "uuid" },
    name: { type: "string" as const },
    description: { type: "string" as const, nullable: true },
    goal: { type: "string" as const },
    agentMode: { type: "string" as const },
    config: { type: "object" as const },
    usageCount: { type: "integer" as const },
    createdAt: { type: "string" as const, format: "date-time" },
    updatedAt: { type: "string" as const, format: "date-time" },
  },
};

export const organizationResponseSchema = {
  type: "object" as const,
  properties: {
    id: { type: "string" as const, format: "uuid" },
    name: { type: "string" as const },
    slug: { type: "string" as const },
    description: { type: "string" as const, nullable: true },
    status: { type: "string" as const },
    ownerId: { type: "string" as const, format: "uuid" },
    createdAt: { type: "string" as const, format: "date-time" },
    updatedAt: { type: "string" as const, format: "date-time" },
  },
};

export const subscriptionResponseSchema = {
  type: "object" as const,
  properties: {
    id: { type: "string" as const, format: "uuid" },
    workspaceId: { type: "string" as const, format: "uuid" },
    plan: { type: "string" as const },
    status: { type: "string" as const },
    currentPeriodStart: { type: "string" as const, format: "date-time", nullable: true },
    currentPeriodEnd: { type: "string" as const, format: "date-time", nullable: true },
    cancelAtPeriodEnd: { type: "boolean" as const },
    trialStart: { type: "string" as const, format: "date-time", nullable: true },
    trialEnd: { type: "string" as const, format: "date-time", nullable: true },
    canceledAt: { type: "string" as const, format: "date-time", nullable: true },
    createdAt: { type: "string" as const, format: "date-time" },
    updatedAt: { type: "string" as const, format: "date-time" },
  },
};

export const openApiSchemas = {
  Error: errorSchema,
  User: userResponseSchema,
  Workspace: workspaceResponseSchema,
  Project: projectResponseSchema,
  Task: taskResponseSchema,
  Provider: providerResponseSchema,
  Deployment: deploymentResponseSchema,
  Plan: planResponseSchema,
  Activity: activityResponseSchema,
  AuthResponse: authResponseSchema,
  ApiKey: apiKeyResponseSchema,
  McpServer: mcpServerResponseSchema,
  Bridge: bridgeResponseSchema,
  SsoConfig: ssoConfigResponseSchema,
  KnowledgeEntry: knowledgeEntryResponseSchema,
  WebhookSubscription: webhookSubscriptionResponseSchema,
  Notification: notificationResponseSchema,
  CostAlert: costAlertResponseSchema,
  TaskTemplate: taskTemplateResponseSchema,
  Organization: organizationResponseSchema,
  Subscription: subscriptionResponseSchema,
};
