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

const tools = JSON.parse(list.body).result.tools;
if (!tools.every((t) => t.annotations && t.annotations.readOnlyHint === true && t.annotations.destructiveHint === false && typeof t.annotations.openWorldHint === "boolean")) {
  throw new Error("every tool must carry explicit readOnlyHint/destructiveHint/openWorldHint annotations");
}
if (!names.includes("check_financial_assistance")) throw new Error("check_financial_assistance missing");

// per-plugin profiles expose only their own tools
const listAt = async (path) => {
  const r = await handler(ev("POST", path, { jsonrpc: "2.0", id: 3, method: "tools/list", params: {} }));
  return { status: r.statusCode, names: r.statusCode === 200 ? JSON.parse(r.body).result.tools.map((t) => t.name) : [] };
};
const assist = await listAt("/p/assistance-checker/mcp");
if (assist.names.join() !== "check_financial_assistance") throw new Error(`assistance profile tools wrong: ${assist.names}`);
const cost = await listAt("/p/cost-finder/mcp");
if (cost.names.includes("calculate_liability") || !cost.names.includes("find_providers")) throw new Error(`cost-finder tools wrong: ${cost.names}`);
if ((await listAt("/p/nope/mcp")).status !== 404) throw new Error("unknown profile must 404");
if ((await listAt("/p/funnel/mcp")).status !== 404) throw new Error("/p/funnel is not a valid plugin path");

// info-mode plugin answers link to informational pages (no plans); funnel answers link to the plan pages
const call = async (path, name, args) => JSON.parse((await handler(ev("POST", path, { jsonrpc: "2.0", id: 4, method: "tools/call", params: { name, arguments: args } }))).body).result;
const a = await call("/p/assistance-checker/mcp", "check_financial_assistance", { household_size: 3, annual_household_income: 52000, state: "TX" });
const data = JSON.parse(a.content[0].text);
if (data.income_as_percent_of_guideline !== 190) throw new Error(`bad percent ${data.income_as_percent_of_guideline}`);
if (!a.content[1].text.includes("/agents/info/assistance/") || !a.content[1].text.includes("utm_medium=assistance-checker")) throw new Error("info link wrong: " + a.content[1].text);
if (a.content[1].text.includes("52000")) throw new Error("income must never appear in the link");
const f = await call("/mcp", "check_financial_assistance", { household_size: 1, annual_household_income: 10000 });
if (!f.content[1].text.includes("/agents/assistance/") || f.content[1].text.includes("/info/")) throw new Error("funnel link wrong");

const unknown = await handler(ev("POST", "/other", {}));
if (unknown.statusCode !== 404) throw new Error("expected 404");
console.log("lambda smoke test passed");
