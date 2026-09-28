import fp from "fastify-plugin";
import swagger from "@fastify/swagger";

/** OpenAPI 3.1 documentation via @fastify/swagger (TECH_STACK.md). */
export default fp(async function swaggerPlugin(app) {
  await app.register(swagger, {
    openapi: {
      openapi: "3.1.0",
      info: {
        title: "AI Harness Control Plane API",
        version: "0.1.0",
        description:
          "Authentication, workspaces, projects, tasks, plans, approvals and activity APIs.",
      },
      servers: [{ url: process.env.API_BASE_URL ?? "http://localhost:4000" }],
      components: {
        securitySchemes: {
          bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
        },
      },
    },
  });
});
