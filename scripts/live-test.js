// Live check of a deployed hosted server: node scripts/live-test.js <base-url>
// e.g. node scripts/live-test.js https://mcp.costkits.com   (calls /mcp)
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const base = (process.argv[2] || "").replace(/\/$/, "");
if (!base) throw new Error("usage: node scripts/live-test.js <base-url>");

const c = new Client({ name: "live-test", version: "1" });
await c.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));

const { tools } = await c.listTools();
const names = tools.map((t) => t.name);
console.log("tools:", names.length, "| analyze_bill exposed:", names.includes("analyze_bill"));

const demo = await c.callTool({ name: "demo_estimate", arguments: {} });
console.log("demo_estimate ok:", !demo.isError);

const est = await c.callTool({ name: "estimate_procedure_cost", arguments: { procedure: "colonoscopy", state: "CT" } });
console.log("estimate_procedure_cost isError:", !!est.isError, "| content parts:", est.content.length);
if (est.isError) console.log(est.content[0].text.slice(0, 300));
else {
  console.log("estimate keys:", Object.keys(JSON.parse(est.content[0].text)).slice(0, 6).join(", "));
  console.log("next step:", est.content[1]?.text);
}

const trig = await c.callTool({ name: "get_coverage", arguments: { procedure: "colonoscopy", carrier: "aetna", aspect: "triggers" } });
console.log("coverage triggers blocked:", !!trig.isError, "|", trig.content[0].text.slice(0, 70));

const prov = await c.callTool({ name: "find_providers", arguments: { procedure: "colonoscopy", state: "CT", limit: 100 } });
if (!prov.isError) {
  const j = JSON.parse(prov.content[0].text);
  const list = j.entities || [];
  console.log("find_providers limit=100 returned:", list.length, "(hosted cap is 10)");
} else console.log("find_providers isError:", prov.content[0].text.slice(0, 200));

await c.close();
