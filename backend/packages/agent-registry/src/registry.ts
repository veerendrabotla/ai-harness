import type { AgentRegistration, AgentHealth, AgentStatus } from "./types.js";

export class AgentRegistry {
  private agents = new Map<string, AgentRegistration>();
  private healthChecks = new Map<string, AgentHealth>();

  register(agent: Omit<AgentRegistration, "registeredAt" | "lastHeartbeat">): AgentRegistration {
    const registration: AgentRegistration = {
      ...agent,
      registeredAt: new Date(),
      lastHeartbeat: new Date(),
    };

    this.agents.set(agent.id, registration);
    this.healthChecks.set(agent.id, {
      agentId: agent.id,
      status: agent.status,
      uptime: 0,
      tasksCompleted: 0,
    });

    return registration;
  }

  unregister(agentId: string): boolean {
    this.agents.delete(agentId);
    this.healthChecks.delete(agentId);
    return true;
  }

  getAgent(agentId: string): AgentRegistration | undefined {
    return this.agents.get(agentId);
  }

  listAgents(type?: string): AgentRegistration[] {
    const agents = Array.from(this.agents.values());
    if (type) {
      return agents.filter((a) => a.type === type);
    }
    return agents;
  }

  updateStatus(agentId: string, status: AgentStatus): boolean {
    const agent = this.agents.get(agentId);
    if (!agent) return false;

    agent.status = status;
    agent.lastHeartbeat = new Date();

    const health = this.healthChecks.get(agentId);
    if (health) {
      health.status = status;
    }

    return true;
  }

  heartbeat(agentId: string): boolean {
    const agent = this.agents.get(agentId);
    if (!agent) return false;

    agent.lastHeartbeat = new Date();
    return true;
  }

  getHealth(agentId: string): AgentHealth | undefined {
    return this.healthChecks.get(agentId);
  }

  findAvailableAgents(capability?: string): AgentRegistration[] {
    return Array.from(this.agents.values()).filter((a) => {
      if (a.status !== "online") return false;
      if (capability) {
        return a.capabilities.some((c) => c.name === capability);
      }
      return true;
    });
  }

  getStaleAgents(timeoutMs: number = 60000): AgentRegistration[] {
    const now = Date.now();
    return Array.from(this.agents.values()).filter(
      (a) => now - a.lastHeartbeat.getTime() > timeoutMs
    );
  }
}
