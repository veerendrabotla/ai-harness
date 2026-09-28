/**
 * Vertical-slice smoke test against a running API.
 * Usage: npx tsx scripts/smoke-vertical-slice.ts [baseUrl]
 */
const BASE = process.argv[2] ?? "http://localhost:4000";

let failures = 0;
function check(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    console.log(`PASS ${name}`);
  } else {
    failures += 1;
    console.error(`FAIL ${name}`, detail !== undefined ? JSON.stringify(detail).slice(0, 300) : "");
  }
}

interface Json { status: number; body: any }

async function call(method: string, path: string, opts: {
  token?: string;
  json?: unknown;
} = {}): Promise<Json> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(opts.json ? { "content-type": "application/json" } : {}),
      ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
    },
    body: opts.json ? JSON.stringify(opts.json) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  let body: unknown;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

async function main() {
  // Health
  const health = await call("GET", "/healthz");
  check("healthz ok", health.status === 200 && health.body.status === "ok", health);

  // Signup (unique email)
  const email = `smoke-${Date.now()}@example.com`;
  const signup = await call("POST", "/v1/auth/signup", {
    json: { email, password: "SmokePass123", displayName: "Smoke Tester" },
  });
  check("signup 201 envelope", signup.status === 201 && Boolean(signup.body?.data?.accessToken), signup);
  const accessToken: string | undefined = signup.body?.data?.accessToken;

  // Duplicate signup conflicts
  const dup = await call("POST", "/v1/auth/signup", {
    json: { email, password: "SmokePass123", displayName: "Dup" },
  });
  check("duplicate signup CONFLICT", dup.status === 409 && dup.body?.error?.code === "CONFLICT", dup);

  // Auth guard
  const guard = await call("GET", "/v1/workspaces");
  check("protected route without token -> UNAUTHENTICATED", guard.status === 401 && guard.body?.error?.code === "UNAUTHENTICATED", guard);

  // Refresh rotation via cookie-less body flow
  const refreshToken: string | undefined = signup.body?.data?.refreshToken;
  const refresh = await call("POST", "/v1/auth/refresh", { json: { refreshToken } });
  check("refresh returns new access token", refresh.status === 200 && Boolean(refresh.body?.data?.accessToken), refresh);

  // Refresh reuse detection: replaying the OLD token must fail
  const reuse = await call("POST", "/v1/auth/refresh", { json: { refreshToken } });
  check("refresh token reuse detected", reuse.status === 401, reuse);

  // Workspace lifecycle
  const ws = await call("POST", "/v1/workspaces", { token: accessToken, json: { name: "Smoke WS", executionMode: "CLOUD" } });
  check("create workspace", ws.status === 201 && ws.body?.data?.viewerRole === undefined || ws.body?.data, ws.body);
  const workspaceId: string = ws.body?.data?.id;

  const project = await call("POST", `/v1/workspaces/${workspaceId}/projects`, {
    token: accessToken,
    json: { name: "smoke-repo", connectionType: "CLOUD", rootReference: "github.com/smoke/repo" },
  });
  check("create project", project.status === 201, project);
  const projectId: string = project.body?.data?.id;

  // Task without configured route -> structured PROVIDER_UNAVAILABLE
  const taskNoRoute = await call("POST", "/v1/tasks", {
    token: accessToken,
    json: { workspaceId, projectId, goal: "Write a tiny module for testing", selectedModelMode: "ROUTED" },
  });
  check(
    "task creation without routes -> PROVIDER_UNAVAILABLE",
    taskNoRoute.status === 503 && taskNoRoute.body?.error?.code === "PROVIDER_UNAVAILABLE",
    taskNoRoute,
  );

  // MANUAL mode without override -> VALIDATION_ERROR
  const taskManualInvalid = await call("POST", "/v1/tasks", {
    token: accessToken,
    json: { workspaceId, projectId, goal: "x", selectedModelMode: "MANUAL" },
  });
  check("manual mode requires modelOverride", taskManualInvalid.status === 400, taskManualInvalid);

  // Policy readback (default policy exists)
  const policy = await call("GET", `/v1/workspaces/${workspaceId}/policy`, { token: accessToken });
  check("default policy present", policy.status === 200 && policy.body?.data?.requirePlanApproval === true, policy);

  // Instructions versioning
  const instr = await call("POST", `/v1/workspaces/${workspaceId}/instructions`, {
    token: accessToken,
    json: { content: "# Project instructions\nAlways run tests." },
  });
  check("instructions v1 saved", instr.status === 201 && instr.body?.data?.version === 1, instr);

  // Logout invalidates session
  const logout = await call("POST", "/v1/auth/logout", { token: accessToken });
  check("logout success", logout.status === 200 && logout.body?.data?.success === true, logout);

  console.log(failures === 0 ? "\nALL SMOKE CHECKS PASSED" : `\n${failures} SMOKE CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("smoke test crashed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
