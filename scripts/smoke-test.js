// Smoke test: spawn the server over stdio and call the no-auth demo tool
// through the real MCP client path — the same wire protocol Claude Desktop uses.
// No API key required, so this runs in CI with zero secrets.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { spawn } from "node:child_process";

// The stdio server is a shim over the hosted HTTP server, so boot a local one first.
const port = 30000 + Math.floor(Math.random() * 10000);
const hosted = spawn(process.execPath, ["src/http.js"], { env: { ...process.env, PORT: String(port), COSTKITS_API_KEY: "" }, stdio: ["ignore", "pipe", "pipe"] });
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error("hosted server did not start")), 5000);
  hosted.stderr.on("data", (d) => { if (String(d).includes("hosted on")) { clearTimeout(t); resolve(); } });
});

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["src/server.js"],
  env: { ...process.env, COSTKITS_MCP_URL: `http://localhost:${port}/mcp` },
});
const client = new Client({ name: "smoke-test", version: "1.0.0" });
await client.connect(transport);

const { tools } = await client.listTools();
console.log(`tools exposed: ${tools.length}`);
if (tools.length < 10) throw new Error("expected at least 10 tools");
if (tools.some((t) => t.name === "analyze_bill")) throw new Error("analyze_bill must not be exposed");

const result = await client.callTool({ name: "demo_estimate", arguments: {} });
if (result.isError) throw new Error(`demo_estimate errored: ${JSON.stringify(result.content)}`);

const payload = JSON.parse(result.content[0].text);
for (const key of ["procedure", "estimated_total_allowed_amount", "billing_components", "data_vintage"]) {
  if (!(key in payload)) throw new Error(`demo response missing key: ${key}`);
}
console.log(`demo_estimate OK: ${payload.procedure}, ${payload.state}, vintage ${payload.data_vintage}`);

await client.close();
hosted.kill();
console.log("smoke test passed");
