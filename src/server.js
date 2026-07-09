#!/usr/bin/env node
// CostKits MCP server — thin stdio bridge to https://api.costkits.com.
// Tools map 1:1 to the REST endpoints documented at
// https://github.com/costkits/costkits-api. No state, no caching, no secrets
// beyond the COSTKITS_API_KEY environment variable.

import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const PKG_VERSION = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8")
).version;

const API_BASE = process.env.COSTKITS_API_BASE || "https://api.costkits.com";
const API_KEY = process.env.COSTKITS_API_KEY || null;

// ---------------------------------------------------------------------------
// HTTP helper: every CostKits error is RFC 7807 problem+json with an
// agent_hint field. Surfacing that hint verbatim is the whole error strategy —
// it tells the model exactly which call to make next.
// ---------------------------------------------------------------------------
async function callApi(method, path, { query, body, auth = true } = {}) {
  const url = new URL(API_BASE + path);
  for (const [k, v] of Object.entries(query || {})) {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  }

  const headers = { "User-Agent": `costkits-mcp/${PKG_VERSION}` };
  if (auth) {
    if (!API_KEY) {
      return {
        isError: true,
        content: [{
          type: "text",
          text: "COSTKITS_API_KEY is not set. This tool needs an API key — get a free one at https://www.costkits.com/api-keys/ and set it in the MCP server's env config. (The demo_estimate tool works without a key.)",
        }],
      };
    }
    headers["Authorization"] = `Bearer ${API_KEY}`;
  }
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let resp;
  try {
    resp = await fetch(url, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    return {
      isError: true,
      content: [{ type: "text", text: `Network error reaching ${API_BASE}: ${err.message}. Retry may succeed.` }],
    };
  }

  const text = await resp.text();
  if (!resp.ok) {
    let hint = "";
    try {
      const problem = JSON.parse(text);
      hint = problem.agent_hint ? `\nagent_hint: ${problem.agent_hint}` : "";
    } catch { /* non-JSON error body; return as-is */ }
    return {
      isError: true,
      content: [{ type: "text", text: `HTTP ${resp.status} from ${method} ${path}:\n${text}${hint}` }],
    };
  }
  return { content: [{ type: "text", text }] };
}

// ---------------------------------------------------------------------------
// Server + tools
// ---------------------------------------------------------------------------
const server = new McpServer({ name: "costkits", version: "1.0.0" });

const insuranceShape = {
  plan_type: z.enum(["commercial", "medicare", "medicaid"]).optional()
    .describe("Insurance plan type (default commercial)"),
  deductible_remaining: z.number().optional().describe("Dollars left on the member's deductible"),
  coinsurance_pct: z.number().optional().describe("Coinsurance percentage, e.g. 20 for 20%"),
  oop_remaining: z.number().optional().describe("Dollars left to the member's out-of-pocket max"),
};

server.registerTool(
  "demo_estimate",
  {
    description:
      "Static sample cost estimate (colonoscopy in Connecticut) from the CostKits API. Works with NO API key — use it to verify connectivity and see the response shape.",
    inputSchema: {},
  },
  () => callApi("GET", "/v1/demo/estimate", { auth: false })
);

server.registerTool(
  "estimate_procedure_cost",
  {
    description:
      "Estimate what a medical procedure costs in a US state: allowed-amount range (low/median/high), billing components, risk flags, and — if insurance details are given — the patient's expected out-of-pocket. Use resolve_procedure first if the user gave a free-text procedure name. Always present ranges, not single numbers, and cite the returned data_vintage.",
    inputSchema: {
      procedure: z.string().describe("Procedure slug or plain name, e.g. 'colonoscopy' or 'mri-knee'"),
      state: z.string().describe("2-letter US state code, e.g. 'CT'"),
      zip_code: z.string().optional().describe("Optional 5-digit ZIP for locality"),
      ...insuranceShape,
    },
  },
  ({ procedure, state, zip_code, plan_type, deductible_remaining, coinsurance_pct, oop_remaining }) => {
    const body = { procedure: { type: procedure }, location: { state } };
    if (zip_code) body.location.zip_code = zip_code;
    if (plan_type || deductible_remaining != null || coinsurance_pct != null || oop_remaining != null) {
      body.insurance = { plan_type, deductible_remaining, coinsurance_pct, oop_remaining };
    }
    return callApi("POST", "/v1/estimate/procedure", { body });
  }
);

server.registerTool(
  "calculate_liability",
  {
    description:
      "Stateless insurance math: given an allowed amount and a plan snapshot (deductible, coinsurance, OOP max), returns exact patient responsibility, plan payment, and the breakdown, plus p25/p75 scenarios. Use when you already have a dollar amount (e.g. from an EOB or a prior estimate).",
    inputSchema: {
      allowed_amount: z.number().describe("Negotiated/allowed amount in dollars"),
      deductible: z.number().describe("Annual deductible in dollars"),
      deductible_met: z.number().optional().describe("Deductible already met this year"),
      coinsurance: z.number().describe("Coinsurance as a fraction, e.g. 0.2 for 20%"),
      oop_max: z.number().describe("Annual out-of-pocket maximum in dollars"),
      oop_met: z.number().optional().describe("Out-of-pocket already met this year"),
      copay: z.number().optional().describe("Flat copay, if the plan uses one"),
      preventive_exception: z.boolean().optional().describe("True if ACA preventive $0 cost-sharing applies"),
    },
  },
  ({ allowed_amount, ...plan }) => callApi("POST", "/v1/estimate/liability", { body: { allowed_amount, plan } })
);

server.registerTool(
  "full_estimate",
  {
    description:
      "One call chaining procedure ontology + cost + providers + patient liability. Cheapest way (one metered request) to get the complete picture. Use `fields` to request a subset; liability requires the plan_* inputs.",
    inputSchema: {
      procedure: z.string().describe("Procedure slug or plain name"),
      state: z.string().describe("2-letter US state code"),
      fields: z.array(z.enum(["procedure", "cost", "providers", "liability"])).optional()
        .describe("Which services to include (default: all)"),
      plan_deductible: z.number().optional(),
      plan_deductible_met: z.number().optional(),
      plan_coinsurance: z.number().optional().describe("Fraction, e.g. 0.2"),
      plan_oop_max: z.number().optional(),
      plan_oop_met: z.number().optional(),
    },
  },
  ({ procedure, state, fields, plan_deductible, plan_deductible_met, plan_coinsurance, plan_oop_max, plan_oop_met }) => {
    const body = { procedure: { type: procedure }, location: { state } };
    if (fields?.length) body.fields = fields;
    if (plan_deductible != null || plan_coinsurance != null || plan_oop_max != null) {
      body.plan = {
        deductible: plan_deductible,
        deductible_met: plan_deductible_met,
        coinsurance: plan_coinsurance,
        oop_max: plan_oop_max,
        oop_met: plan_oop_met,
      };
    }
    return callApi("POST", "/v1/estimate/full", { body });
  }
);

server.registerTool(
  "find_providers",
  {
    description:
      "Find healthcare providers for a procedure in a US state. Each provider has pricing_status: 'observed' (real negotiated rate from hospital transparency data — prefer these), 'estimated', or 'none'. Set cluster=true for city-level groups with lat/lng.",
    inputSchema: {
      procedure: z.string().describe("Procedure slug or plain name"),
      state: z.string().describe("2-letter US state code"),
      limit: z.number().int().min(1).max(100).optional().describe("Max results (default 25)"),
      cluster: z.boolean().optional().describe("Group by city with lat/lng (default false)"),
    },
  },
  ({ procedure, state, limit, cluster }) =>
    callApi("GET", "/v1/providers", { query: { procedure, state, limit, cluster } })
);

server.registerTool(
  "get_provider",
  {
    description: "Public profile for a single provider by 10-digit NPI number: name, specialty, address, entity type.",
    inputSchema: { npi: z.string().describe("10-digit NPI number") },
  },
  ({ npi }) => callApi("GET", `/v1/providers/${encodeURIComponent(npi)}`)
);

server.registerTool(
  "resolve_procedure",
  {
    description:
      "Fuzzy-match a free-text procedure name ('knee mri', 'gallbladder removal') to a canonical slug with confidence scores. Call this BEFORE estimate tools whenever the user's wording might not be an exact slug.",
    inputSchema: { query: z.string().describe("Free-text procedure name") },
  },
  ({ query }) => callApi("GET", "/v1/procedures/resolve", { query: { q: query } })
);

server.registerTool(
  "list_procedures",
  {
    description: "The full CostKits catalog: 30 procedures with slugs, display names, categories, and CPT codes (paginated).",
    inputSchema: {
      limit: z.number().int().min(1).max(200).optional(),
      cursor: z.string().optional().describe("next_cursor from a previous response"),
    },
  },
  ({ limit, cursor }) => callApi("GET", "/v1/procedures", { query: { limit, cursor } })
);

server.registerTool(
  "get_procedure_details",
  {
    description:
      "Structured knowledge about one procedure. aspect='facts' returns LLM-ready billing rules and cost drivers (best for grounding an answer); 'bundle' explains which separate bills to expect (facility, physician, anesthesia...); 'full' returns the complete ontology.",
    inputSchema: {
      slug: z.string().describe("Canonical procedure slug, e.g. 'colonoscopy'"),
      aspect: z.enum(["full", "bundle", "facts"]).optional().describe("Default 'facts'"),
    },
  },
  ({ slug, aspect = "facts" }) => {
    const suffix = aspect === "full" ? "" : `/${aspect}`;
    return callApi("GET", `/v1/procedure/${encodeURIComponent(slug)}${suffix}`);
  }
);

server.registerTool(
  "get_coverage",
  {
    description:
      "Insurance coverage rules for a procedure/carrier combination. aspect: 'summary' (status + plain English), 'prior-auth', 'cost-sharing' (deductible/coinsurance/ACA preventive), 'frequency' (how often covered, age rules), or 'triggers' (Pro plan: billing events that flip a $0 preventive claim to diagnostic — the highest-signal aspect).",
    inputSchema: {
      procedure: z.string().describe("Procedure slug, e.g. 'colonoscopy'"),
      carrier: z.string().describe("Carrier key, e.g. 'aetna', 'cigna', 'bcbs', 'medicare' — see list_carriers"),
      aspect: z.enum(["summary", "prior-auth", "cost-sharing", "frequency", "triggers"]).optional()
        .describe("Default 'summary'"),
      plan_type: z.enum(["commercial", "medicare", "medicaid"]).optional(),
    },
  },
  ({ procedure, carrier, aspect = "summary", plan_type }) =>
    callApi("GET", `/v1/coverage/${aspect}`, { query: { procedure, carrier, plan_type } })
);

server.registerTool(
  "list_carriers",
  {
    description: "All insurance carrier keys supported by the coverage tools (aetna, cigna, bcbs, medicare, ...). Works on the Free plan — also a good API-key sanity check.",
    inputSchema: {},
  },
  () => callApi("GET", "/v1/coverage/carriers")
);

server.registerTool(
  "analyze_bill",
  {
    description:
      "Detect anomalies in medical bill line items (Pro plan): duplicate charges, unbundling, quantity errors, screening-to-diagnostic reclassification. Returns a risk score, flags, and a consumer-language summary. Stateless — send only codes and amounts, never patient identity fields.",
    inputSchema: {
      line_items: z.array(
        z.object({
          cpt: z.string().optional().describe("CPT code, e.g. '45378'"),
          hcpcs: z.string().optional(),
          description: z.string().optional(),
          billed: z.number().optional().describe("Billed amount in dollars"),
          allowed: z.number().optional(),
          member_responsibility: z.number().optional(),
          quantity: z.number().int().optional(),
        })
      ).max(100).describe("Up to 100 line items from the bill"),
    },
  },
  ({ line_items }) => callApi("POST", "/v1/bill-analysis", { body: { line_items } })
);

// ---------------------------------------------------------------------------
const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`costkits-mcp ready (${API_BASE}${API_KEY ? ", key set" : ", no key — only demo_estimate will work"})`);
