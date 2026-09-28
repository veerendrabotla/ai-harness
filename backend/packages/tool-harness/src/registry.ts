import { errors } from "@ai-harness/shared";
import { zodToJsonSchema } from "./schema-converter.js";
import type { ToolDefinition } from "./types.js";

/**
 * Tool Registry — declares every tool the runtime may propose.
 * The model can only ever reference tools registered here; nothing else executes.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();
  private readonly dynamicTools = new Map<string, ToolDefinition>();

  register(definition: ToolDefinition): void {
    if (this.tools.has(definition.name)) {
      throw errors.conflict(`Tool already registered: ${definition.name}`);
    }
    this.tools.set(definition.name, definition);
  }

  /**
   * Register a dynamic tool from an extension or MCP server.
   * Dynamic tools can be unregistered later.
   * Throws if a tool with the same name already exists in either registry.
   */
  registerDynamic(definition: ToolDefinition): void {
    if (this.tools.has(definition.name)) {
      throw errors.conflict(`Tool already registered as static: ${definition.name}`);
    }
    if (this.dynamicTools.has(definition.name)) {
      throw errors.conflict(`Dynamic tool already registered: ${definition.name}`);
    }
    this.dynamicTools.set(definition.name, definition);
  }

  /**
   * Unregister a dynamic tool.
   */
  unregisterDynamic(name: string): boolean {
    return this.dynamicTools.delete(name);
  }

  get(name: string): ToolDefinition | undefined {
    return this.tools.get(name) ?? this.dynamicTools.get(name);
  }

  require(name: string): ToolDefinition {
    const tool = this.get(name);
    if (!tool) throw errors.notFound(`Tool '${name}'`);
    return tool;
  }

  list(): ToolDefinition[] {
    return [...this.tools.values(), ...this.dynamicTools.values()];
  }

  /**
   * List tools by category.
   */
  listByCategory(category: string): ToolDefinition[] {
    return this.list().filter((t) => t.name.startsWith(category + "."));
  }

  /**
   * List tools by risk level.
   */
  listByRisk(riskLevel: string): ToolDefinition[] {
    return this.list().filter((t) => t.riskLevel === riskLevel);
  }

  /**
   * Get tool names for model consumption.
   */
  getToolNames(): string[] {
    return this.list().map((t) => t.name);
  }

  /**
   * Get tool descriptions for model consumption.
   */
  getToolDescriptions(): Array<{ name: string; description: string; riskLevel: string }> {
    return this.list().map((t) => ({
      name: t.name,
      description: t.description,
      riskLevel: t.riskLevel,
    }));
  }

  /** Provider-neutral descriptions with JSON Schemas handed to model adapters. */
  toModelDefinitions(): Array<{
    name: string;
    description: string;
    riskLevel: string;
    parameters: Record<string, unknown>;
  }> {
    return this.list().map((t) => ({
      name: t.name,
      description: `${t.description} [risk=${t.riskLevel}]`,
      riskLevel: t.riskLevel,
      parameters: zodToJsonSchema(t.inputSchema),
    }));
  }

  /**
   * Compose multiple tools into a pipeline.
   * Each tool's output is passed as input to the next tool.
   */
  async executePipeline(
    tools: Array<{ name: string; input: unknown }>,
    executor: (tool: ToolDefinition, input: unknown) => Promise<unknown>,
  ): Promise<Array<{ name: string; output: unknown; error?: string }>> {
    const results: Array<{ name: string; output: unknown; error?: string }> = [];
    let previousOutput: unknown = undefined;

    for (const step of tools) {
      const definition = this.get(step.name);
      if (!definition) {
        results.push({ name: step.name, output: null, error: `Tool not found: ${step.name}` });
        break;
      }

      const input = previousOutput !== undefined
        ? { ...(step.input as Record<string, unknown>), _previousOutput: previousOutput }
        : step.input;

      try {
        const output = await executor(definition, input);
        results.push({ name: step.name, output });
        previousOutput = output;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        results.push({ name: step.name, output: null, error: message });
        break;
      }
    }

    return results;
  }
}
