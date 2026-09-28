#!/usr/bin/env node
import { AiHarnessClient, SDKError } from "@ai-harness/sdk";
import { runCIAgent, formatCIResult, type CIConfig } from "./ci.js";

const BASE_URL = process.env.AIHarness_URL ?? process.env.AI_HARNESS_URL ?? "http://localhost:4000";
const API_KEY = process.env.AI_HARNESS_API_KEY;
const TOKEN = process.env.AI_HARNESS_TOKEN;

const client = new AiHarnessClient({
  baseUrl: BASE_URL,
  apiKey: API_KEY,
  token: TOKEN,
});

const args = process.argv.slice(2);
const command = args[0];

function usage() {
  console.log(`
AI Harness CLI

Usage: aiharness <command> [options]

Commands:
  build <goal> [--project <id>]    Create and run a task
  run <prompt> [--project <id>]    Create and start a new task (build mode)
  ask <question> [--project <id>]  Create a task in ask mode
  plan <description> [--project <id>] Create a task in plan mode
  review [--ci] [--project <id>]   Run code review
  fix <goal> [--project <id>]      Create a task in fix mode
  deploy <environment> [--project <id>] Deploy a project
  sessions [--workspace <id>]      List recent sessions
  resume <task-id>                 Resume a paused task
  status <task-id>                 Show task status
  events <task-id>                 Stream task events in real-time
  health                           Check API health
  test --ci [--project <id>]       Run tests in CI mode
  security --ci [--project <id>]   Run security audit in CI mode

Environment:
  AI_HARNESS_URL        API base URL (default: http://localhost:4000)
  AI_HARNESS_API_KEY    API key for authentication
  AI_HARNESS_TOKEN      JWT token for authentication
`);
}

async function main() {
  if (!command || command === "help") {
    usage();
    process.exit(0);
  }

  try {
    switch (command) {
      case "build": {
        const goal = args[1];
        if (!goal) { console.error("Usage: aiharness build <goal> [--project <id>]"); process.exit(1); }
        const projectIdx = args.indexOf("--project");
        const projectId = projectIdx !== -1 ? args[projectIdx + 1] : undefined;
        console.log(`Creating task: ${goal}`);
        const task = await client.createTask({ goal, agentMode: "BUILD", ...(projectId ? { projectId } : {}) });
        console.log(`Task created: ${task.id}`);
        console.log(`State: ${task.state}`);
        console.log(`\nStream events: aiharness status ${task.id}`);
        break;
      }
      case "run": {
        const prompt = args[1];
        if (!prompt) { console.error("Usage: aiharness run <prompt> [--project <id>]"); process.exit(1); }
        const projectIdx = args.indexOf("--project");
        const projectId = projectIdx !== -1 ? args[projectIdx + 1] : undefined;
        console.log(`Creating task: ${prompt}`);
        const task = await client.createTask({ goal: prompt, agentMode: "BUILD", ...(projectId ? { projectId } : {}) });
        console.log(`Task created: ${task.id}`);
        console.log(`State: ${task.state}`);
        console.log(`\nStream events: aiharness status ${task.id}`);
        break;
      }
      case "ask": {
        const question = args[1];
        if (!question) { console.error("Usage: aiharness ask <question> [--project <id>]"); process.exit(1); }
        const projectIdx = args.indexOf("--project");
        const projectId = projectIdx !== -1 ? args[projectIdx + 1] : undefined;
        console.log(`Creating task: ${question}`);
        const task = await client.createTask({ goal: question, agentMode: "ASK", ...(projectId ? { projectId } : {}) });
        console.log(`Task created: ${task.id}`);
        console.log(`State: ${task.state}`);
        console.log(`\nStream events: aiharness status ${task.id}`);
        break;
      }
      case "plan": {
        const description = args[1];
        if (!description) { console.error("Usage: aiharness plan <description> [--project <id>]"); process.exit(1); }
        const projectIdx = args.indexOf("--project");
        const projectId = projectIdx !== -1 ? args[projectIdx + 1] : undefined;
        console.log(`Creating task: ${description}`);
        const task = await client.createTask({ goal: description, agentMode: "PLAN", ...(projectId ? { projectId } : {}) });
        console.log(`Task created: ${task.id}`);
        console.log(`State: ${task.state}`);
        console.log(`\nStream events: aiharness status ${task.id}`);
        break;
      }
      case "fix": {
        const goal = args[1];
        if (!goal) { console.error("Usage: aiharness fix <goal> [--project <id>]"); process.exit(1); }
        const projectIdx = args.indexOf("--project");
        const projectId = projectIdx !== -1 ? args[projectIdx + 1] : undefined;
        console.log(`Creating task: ${goal}`);
        const task = await client.createTask({ goal, agentMode: "FIX", ...(projectId ? { projectId } : {}) });
        console.log(`Task created: ${task.id}`);
        console.log(`State: ${task.state}`);
        console.log(`\nStream events: aiharness status ${task.id}`);
        break;
      }
      case "deploy": {
        const environment = args[1];
        if (!environment) { console.error("Usage: aiharness deploy <environment> --provider <name> [--project <id>]"); process.exit(1); }
        const projectIdx = args.indexOf("--project");
        const projectId = projectIdx !== -1 ? args[projectIdx + 1] : undefined;
        if (!projectId) { console.error("Usage: aiharness deploy <environment> --project <id>"); process.exit(1); }
        const providerIdx = args.indexOf("--provider");
        const provider = providerIdx !== -1 ? args[providerIdx + 1] : "default";
        console.log(`Deploying to ${environment} via ${provider}...`);
        const deployment = await client.createDeployment(projectId, { provider: provider ?? "default", environment });
        console.log(`Deployment created: ${deployment.deploymentId}`);
        console.log(`Status: ${deployment.status}`);
        break;
      }
      case "resume": {
        const taskId = args[1];
        if (!taskId) { console.error("Usage: aiharness resume <task-id>"); process.exit(1); }
        console.log(`Resuming task ${taskId}...`);
        const task = await client.resumeTask(taskId);
        console.log(`Task resumed: ${task.id}`);
        console.log(`State: ${task.state}`);
        break;
      }
      case "status": {
        const taskId = args[1];
        if (!taskId) { console.error("Usage: aiharness status <task-id>"); process.exit(1); }
        const task = await client.getTask(taskId);
        console.log(`Task: ${task.id}`);
        console.log(`Goal: ${task.goal}`);
        console.log(`State: ${task.state}`);
        console.log(`Created: ${task.createdAt}`);
        break;
      }
      case "sessions": {
        const wsIdx = args.indexOf("--workspace");
        const workspaceId = wsIdx !== -1 ? args[wsIdx + 1] : "";
        if (!workspaceId) {
          console.error("Usage: aiharness sessions --workspace <id>");
          process.exit(1);
        }
        const sessions = await client.listSessions(workspaceId);
        if (sessions.length === 0) {
          console.log("No sessions found.");
        } else {
          for (const s of sessions) {
            console.log(`  ${s.id}  ${s.status.padEnd(10)}  ${s.title ?? "(untitled)"}  ${new Date(s.createdAt).toLocaleString()}`);
          }
        }
        break;
      }
      case "events": {
        if (!args[1]) {
          console.error("Usage: aiharness events <task-id>");
          process.exit(1);
        }
        const evTaskId = args[1];
        console.log(`Streaming events for task ${evTaskId}...`);
        for await (const event of client.streamEvents(evTaskId)) {
          const ts = new Date(event.createdAt).toLocaleTimeString();
          console.log(`[${ts}] ${event.eventType} (${event.actorType})`);
          if (event.payload && Object.keys(event.payload).length > 0) {
            console.log(`  ${JSON.stringify(event.payload).slice(0, 200)}`);
          }
        }
        console.log("Stream ended.");
        break;
      }
      case "health": {
        const health = await client.health();
        console.log("API Status:", JSON.stringify(health, null, 2));
        break;
      }
      case "review": {
        if (args.includes("--ci")) {
          const projectIdx = args.indexOf("--project");
          const projectId = projectIdx !== -1 ? args[projectIdx + 1] : "";
          if (!projectId) {
            console.error("Usage: aiharness review --ci --project <id>");
            process.exit(1);
          }
          const result = await runCIAgent({
            client,
            mode: "review",
            projectId,
            failOnIssues: true,
            outputFormat: args.includes("--json") ? "json" : args.includes("--github") ? "github-actions" : "text",
          });
          console.log(formatCIResult(result, args.includes("--json") ? "json" : args.includes("--github") ? "github-actions" : "text"));
          process.exit(result.passed ? 0 : 1);
        } else {
          console.log("Running code review...");
          console.log("(Use --ci flag for CI mode with --project <id>)");
        }
        break;
      }
      case "test":
      case "security": {
        if (args.includes("--ci")) {
          const projectIdx = args.indexOf("--project");
          const projectId = projectIdx !== -1 ? args[projectIdx + 1] : "";
          if (!projectId) {
            console.error(`Usage: aiharness ${command} --ci --project <id>`);
            process.exit(1);
          }
          const mode = command === "security" ? "security" : "test";
          const result = await runCIAgent({
            client,
            mode: mode as CIConfig["mode"],
            projectId,
            failOnIssues: true,
            outputFormat: args.includes("--json") ? "json" : args.includes("--github") ? "github-actions" : "text",
          });
          console.log(formatCIResult(result, args.includes("--json") ? "json" : args.includes("--github") ? "github-actions" : "text"));
          process.exit(result.passed ? 0 : 1);
        } else {
          console.error(`Usage: aiharness ${command} --ci [--project <id>]`);
          process.exit(1);
        }
        break;
      }
      default:
        console.error(`Unknown command: ${command}`);
        usage();
        process.exit(1);
    }
  } catch (err: unknown) {
    if (err instanceof SDKError) {
      console.error(`API Error (${err.status}): ${err.message}`);
      if (err.body) console.error(JSON.stringify(err.body, null, 2));
    } else if (err instanceof Error) {
      console.error("Error:", err.message);
    } else {
      console.error("Error:", err);
    }
    process.exit(1);
  }
}

main();
