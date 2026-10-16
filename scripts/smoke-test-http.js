// Smoke test for the hosted entrypoint: boot src/http.js on a random port and
// talk to it with the real MCP streamable-HTTP client. No API key needed
// (demo_estimate is unauthenticated); also asserts the hosted-mode contract.

import { spawn } from "node:child_process";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const port = 20000 + Math.floor(Math.random() * 10000);
const proc = spawn(process.execPath, ["src/http.js"], { env: { ...process.env, PORT: String(port), COSTKITS_API_KEY: "" }, stdio: ["ignore", "pipe", "pipe"] });
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error("server did not start")), 5000);
  proc.stderr.on("data", (d) => { if (String(d).includes("hosted on")) { clearTimeout(t); resolve(); } });
  proc.on("exit", (c) => reject(new Error(`server exited early (${c})`)));
});

try {
  const health = await fetch(`http://localhost:${port}/healthz`);
  if (!health.ok) throw new Error("healthz failed");

  const get = await fetch(`http://localhost:${port}/mcp`);
  if (get.status !== 405) throw new Error(`GET /mcp expected 405, got ${get.status}`);

  const client = new Client({ name: "smoke-http", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://localhost:${port}/mcp`)));

  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name);
  console.log(`hosted tools exposed: ${names.length}`);
  if (names.includes("analyze_bill")) throw new Error("analyze_bill must not be exposed in hosted mode");
  if (!names.includes("estimate_procedure_cost")) throw new Error("estimate_procedure_cost missing");

  const r = await client.callTool({ name: "demo_estimate", arguments: {} });
  if (r.isError) throw new Error(`demo_estimate errored: ${JSON.stringify(r.content)}`);
  console.log("demo_estimate OK over HTTP");

  await client.close();
  console.log("http smoke test passed");
} finally {
  proc.kill();
}
