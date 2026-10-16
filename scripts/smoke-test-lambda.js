// Smoke test for the Lambda entrypoint: feed it Function-URL-shaped events and
// check the JSON-RPC round trip. No AWS, no API key (tools/list needs neither).

import { handler } from "../src/lambda.js";

const ev = (method, rawPath, body) => ({
  rawPath,
  isBase64Encoded: false,
  body: body ? JSON.stringify(body) : undefined,
  headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
  requestContext: { domainName: "example.lambda-url.us-east-2.on.aws", http: { method, sourceIp: "203.0.113.9" } },
});

const health = await handler(ev("GET", "/healthz"));
if (health.statusCode !== 200) throw new Error("healthz failed");

const wrongMethod = await handler(ev("GET", "/mcp"));
if (wrongMethod.statusCode !== 405) throw new Error(`GET /mcp expected 405, got ${wrongMethod.statusCode}`);

const init = await handler(ev("POST", "/mcp", {
  jsonrpc: "2.0", id: 1, method: "initialize",
  params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "smoke", version: "1" } },
}));
if (init.statusCode !== 200) throw new Error(`initialize failed: ${init.statusCode} ${init.body}`);

const list = await handler(ev("POST", "/mcp", { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }));
if (list.statusCode !== 200) throw new Error(`tools/list failed: ${list.statusCode} ${list.body}`);
const names = JSON.parse(list.body).result.tools.map((t) => t.name);
console.log(`lambda tools exposed: ${names.length}`);
if (names.includes("analyze_bill")) throw new Error("analyze_bill must not be exposed");
if (!names.includes("estimate_procedure_cost")) throw new Error("estimate_procedure_cost missing");

const unknown = await handler(ev("POST", "/other", {}));
if (unknown.statusCode !== 404) throw new Error("expected 404");
console.log("lambda smoke test passed");
