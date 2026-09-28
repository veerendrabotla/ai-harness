// Minimal STDIO MCP server for tests: answers the first tools/list request.
let buffer = "";
process.stdin.on("data", (d: Buffer) => {
  buffer += d.toString("utf8");
  let idx: number;
  while ((idx = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    try {
      const req = JSON.parse(line) as { id?: number; method?: string };
      if (req.method === "tools/list") {
        process.stdout.write(
          JSON.stringify({
            jsonrpc: "2.0",
            id: req.id ?? 1,
            result: { tools: [{ name: "echo", description: "Echoes a message" }] },
          }) + "\n",
        );
      }
    } catch {
      /* ignore malformed */
    }
  }
});
