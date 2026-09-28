import type {
  Extension,
  ExtensionRegistry,
  ExtensionType,
  ExtensionContext,
  ExtensionState,
  ExtensionHealth,
  ExtensionManifest,
} from "./types.js";

export class InMemoryExtensionRegistry implements ExtensionRegistry {
  private extensions = new Map<string, Extension>();
  private states = new Map<string, ExtensionState>();
  private activationOrder: string[] = [];

  register(extension: Extension): void {
    if (this.extensions.has(extension.manifest.name)) {
      throw new Error(`Extension already registered: ${extension.manifest.name}`);
    }

    this.validateDependencies(extension.manifest);

    this.extensions.set(extension.manifest.name, extension);
    this.states.set(extension.manifest.name, {
      manifest: extension.manifest,
      lifecycle: "registered",
      health: { status: "unknown", lastChecked: new Date() },
    });
  }

  unregister(name: string): void {
    const state = this.states.get(name);
    if (state?.lifecycle === "active") {
      throw new Error(`Cannot unregister active extension: ${name}. Deactivate first.`);
    }
    this.extensions.delete(name);
    this.states.delete(name);
    this.activationOrder = this.activationOrder.filter((n) => n !== name);
  }

  getExtension(name: string): Extension | undefined {
    return this.extensions.get(name);
  }

  listExtensions(type?: ExtensionType): Extension[] {
    const all = Array.from(this.extensions.values());
    return type ? all.filter((e) => e.manifest.type === type) : all;
  }

  async activateAll(context: ExtensionContext): Promise<void> {
    const activationOrder = this.topologicalSort();

    for (const name of activationOrder) {
      const ext = this.extensions.get(name);
      const state = this.states.get(name);
      if (!ext || !state || state.lifecycle === "active") continue;

      try {
        state.lifecycle = "activating";
        await ext.activate(context);
        state.lifecycle = "active";
        state.activatedAt = new Date();
        state.error = undefined;
        this.activationOrder.push(name);
      } catch (err) {
        state.lifecycle = "error";
        state.error = err instanceof Error ? err.message : String(err);
        state.health = { status: "unhealthy", lastChecked: new Date(), error: state.error };
      }
    }
  }

  async deactivateAll(): Promise<void> {
    const deactivationOrder = [...this.activationOrder].reverse();

    for (const name of deactivationOrder) {
      const ext = this.extensions.get(name);
      const state = this.states.get(name);
      if (!ext || !state || state.lifecycle !== "active") continue;

      try {
        state.lifecycle = "deactivating";
        await ext.deactivate();
        state.lifecycle = "inactive";
        state.deactivatedAt = new Date();
        state.error = undefined;
      } catch (err) {
        state.lifecycle = "error";
        state.error = err instanceof Error ? err.message : String(err);
      }
    }
    this.activationOrder = [];
  }

  getState(name: string): ExtensionState | undefined {
    return this.states.get(name);
  }

  getHealth(name: string): ExtensionHealth | undefined {
    return this.states.get(name)?.health;
  }

  async activate(name: string, context: ExtensionContext): Promise<void> {
    const ext = this.extensions.get(name);
    const state = this.states.get(name);
    if (!ext) throw new Error(`Extension not found: ${name}`);
    if (!state) throw new Error(`Extension state not found: ${name}`);
    if (state.lifecycle === "active") return;

    const deps = ext.manifest.dependencies || [];
    for (const dep of deps) {
      const depState = this.states.get(dep.name);
      if (!dep.optional && (!depState || depState.lifecycle !== "active")) {
        state.lifecycle = "error";
        state.error = `Dependency ${dep.name} is not active`;
        state.health = { status: "unhealthy", lastChecked: new Date(), error: state.error };
        throw new Error(`Dependency ${dep.name} is not active for extension ${name}`);
      }
    }

    try {
      state.lifecycle = "activating";
      await ext.activate(context);
      state.lifecycle = "active";
      state.activatedAt = new Date();
      state.error = undefined;
      this.activationOrder.push(name);
    } catch (err) {
      state.lifecycle = "error";
      state.error = err instanceof Error ? err.message : String(err);
      state.health = { status: "unhealthy", lastChecked: new Date(), error: state.error };
      throw err;
    }
  }

  async deactivate(name: string): Promise<void> {
    const ext = this.extensions.get(name);
    const state = this.states.get(name);
    if (!ext || !state || state.lifecycle !== "active") return;

    const dependents = this.findDependents(name);
    for (const dep of dependents) {
      const depState = this.states.get(dep);
      if (depState?.lifecycle === "active") {
        await this.deactivate(dep);
      }
    }

    try {
      state.lifecycle = "deactivating";
      await ext.deactivate();
      state.lifecycle = "inactive";
      state.deactivatedAt = new Date();
      state.error = undefined;
      this.activationOrder = this.activationOrder.filter((n) => n !== name);
    } catch (err) {
      state.lifecycle = "error";
      state.error = err instanceof Error ? err.message : String(err);
    }
  }

  async checkHealth(name: string): Promise<ExtensionHealth> {
    const ext = this.extensions.get(name);
    const state = this.states.get(name);
    if (!ext || !state) {
      return { status: "unknown", lastChecked: new Date(), error: "Extension not found" };
    }

    if (ext.healthCheck) {
      try {
        const health = await ext.healthCheck();
        state.health = health;
        return health;
      } catch (err) {
        const health: ExtensionHealth = {
          status: "unhealthy",
          lastChecked: new Date(),
          error: err instanceof Error ? err.message : String(err),
        };
        state.health = health;
        return health;
      }
    }

    const health: ExtensionHealth = {
      status: state.lifecycle === "active" ? "healthy" : "unknown",
      lastChecked: new Date(),
    };
    state.health = health;
    return health;
  }

  listByType(type: ExtensionType): Extension[] {
    return this.listExtensions(type);
  }

  listActive(): Extension[] {
    return Array.from(this.extensions.values()).filter((ext) => {
      const state = this.states.get(ext.manifest.name);
      return state?.lifecycle === "active";
    });
  }

  listInactive(): Extension[] {
    return Array.from(this.extensions.values()).filter((ext) => {
      const state = this.states.get(ext.manifest.name);
      return state?.lifecycle !== "active";
    });
  }

  isRegistered(name: string): boolean {
    return this.extensions.has(name);
  }

  isActive(name: string): boolean {
    return this.states.get(name)?.lifecycle === "active";
  }

  private validateDependencies(manifest: ExtensionManifest): void {
    const deps = manifest.dependencies || [];
    for (const dep of deps) {
      if (!dep.optional && !this.extensions.has(dep.name)) {
        throw new Error(`Required dependency not found: ${dep.name}`);
      }
    }
  }

  private topologicalSort(): string[] {
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const order: string[] = [];

    const visit = (name: string) => {
      if (visited.has(name)) return;
      if (visiting.has(name)) throw new Error(`Circular dependency detected: ${name}`);
      visiting.add(name);

      const ext = this.extensions.get(name);
      if (ext) {
        const deps = ext.manifest.dependencies || [];
        for (const dep of deps) {
          if (!dep.optional) {
            visit(dep.name);
          }
        }
      }

      visiting.delete(name);
      visited.add(name);
      order.push(name);
    };

    for (const [name] of this.extensions) {
      visit(name);
    }

    return order;
  }

  private findDependents(name: string): string[] {
    const dependents: string[] = [];
    for (const [extName, ext] of this.extensions) {
      const deps = ext.manifest.dependencies || [];
      if (deps.some((d) => d.name === name)) {
        dependents.push(extName);
      }
    }
    return dependents;
  }
}
