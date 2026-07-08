// Smoke test: spawn the server over stdio and call the no-auth demo tool
// through the real MCP client path — the same wire protocol Claude Desktop uses.
// No API key required, so this runs in CI with zero secrets.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["src/server.js"],
});
const client = new Client({ name: "smoke-test", version: "1.0.0" });
await client.connect(transport);

const { tools } = await client.listTools();
console.log(`tools exposed: ${tools.length}`);
if (tools.length < 10) throw new Error("expected at least 10 tools");

const result = await client.callTool({ name: "demo_estimate", arguments: {} });
if (result.isError) throw new Error(`demo_estimate errored: ${JSON.stringify(result.content)}`);

const payload = JSON.parse(result.content[0].text);
for (const key of ["procedure", "estimated_total_allowed_amount", "billing_components", "data_vintage"]) {
  if (!(key in payload)) throw new Error(`demo response missing key: ${key}`);
}
console.log(`demo_estimate OK: ${payload.procedure}, ${payload.state}, vintage ${payload.data_vintage}`);

await client.close();
console.log("smoke test passed");
