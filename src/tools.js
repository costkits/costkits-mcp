// CostKits MCP tool definitions, shared by the stdio entrypoint (server.js)
// and the hosted streamable-HTTP entrypoint (http.js, used for the ChatGPT app).

import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { nextStepFor } from "./next-step.js";
import { PROFILES } from "./profiles.js";
import { screenFinancialAssistance } from "./assistance.js";

const PKG_VERSION = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf8")
).version;

// Tools withheld from the hosted ChatGPT app. analyze_bill takes line items
// from a patient's bill (PHI-adjacent) and is Pro-plan; v1 of the hosted app
// serves public pricing data only. Bill analysis happens in the CostKits app.
const HOSTED_MAX_PROVIDERS = 5;  // per call; hosted find_providers is capped
const HOSTED_EXCLUDED_TOOLS = new Set(["analyze_bill"]);

/**
 * @param {object} opts
 * @param {string} [opts.apiBase]
 * @param {string|null} [opts.apiKey]
 * @param {string} [opts.profile]  hosted tool profile (see profiles.js); default 'funnel' = all tools
 * @param {boolean} [opts.hosted]   hosted mode: drop PHI-adjacent tools, append
 *                                  a tagged CostKits next-step link to results
 * @param {(evt: object) => void} [opts.onToolCall]  PII-free usage callback
 */
export function createServer({ apiBase = "https://api.costkits.com", apiKey = null, hosted = false, profile = "funnel", onToolCall } = {}) {
  const API_BASE = apiBase;
  const API_KEY = apiKey;
  const server = new McpServer({ name: "costkits", version: PKG_VERSION });

  const prof = PROFILES[profile] ?? PROFILES.funnel;
  // Every tool reads only CostKits' own datasets (or does pure math on its inputs); none reaches the open
  // internet or changes anything, so all are closed-world, read-only.

  // Registers a tool; in hosted mode applies the profile's tool list, adds the required behavior
  // annotations (all tools here are read-only), and decorates results with a next-step link.
  function reg(name, config, handler) {
    if (hosted && HOSTED_EXCLUDED_TOOLS.has(name)) return;
    if (hosted && prof.tools && !prof.tools.includes(name)) return;
    config.annotations ??= {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
    };
    if (!hosted) return server.registerTool(name, config, handler);
    return server.registerTool(name, config, async (args, extra) => {
      const started = Date.now();
      const result = await handler(args, extra);
      onToolCall?.({ tool: name, args, ok: !result.isError, ms: Date.now() - started, profile });
      if (!result.isError) {
        const step = nextStepFor(name, args, { mode: prof.mode, profile });
        if (step) result.content.push({ type: "text", text: step });
      }
      return result;
    });
  }

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

  const insuranceShape = {
    plan_type: z.enum(["commercial", "medicare", "medicaid"]).optional()
      .describe("Insurance plan type (default commercial)"),
    deductible_remaining: z.number().optional().describe("Dollars left on the member's deductible"),
    coinsurance_pct: z.number().optional().describe("Coinsurance percentage, e.g. 20 for 20%"),
    oop_remaining: z.number().optional().describe("Dollars left to the member's out-of-pocket max"),
  };

  reg(
    "demo_estimate",
    {
      description:
        "Static sample cost estimate (colonoscopy in Connecticut) from the CostKits API. Works with NO API key — use it to verify connectivity and see the response shape.",
      inputSchema: {},
    },
    () => callApi("GET", "/v1/demo/estimate", { auth: false })
  );

  reg(
    "estimate_procedure_cost",
    {
      description:
        "Returns the typical allowed-amount range (low, median, high) for one medical procedure in one US state, the usual billing components (facility, physician, anesthesia, pathology), and the data vintage. If the user chooses to give their own deductible, coinsurance and out-of-pocket figures, it also returns an estimated patient share. These are estimates of typical prices from hospital price transparency and Medicare data, not quotes. Only the procedure and state are required; ZIP code and plan figures are optional and are used only for this one calculation.",
      inputSchema: {
        procedure: z.string().describe("Procedure slug or plain name, e.g. 'colonoscopy' or 'mri-knee'. A plain name that is not an exact slug can be matched with resolve_procedure."),
        state: z.string().describe("2-letter US state code, e.g. 'CT'. Prices are state-level."),
        zip_code: z.string().optional().describe("Optional 5-digit ZIP, used only to refine the local estimate"),
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

  reg(
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

  reg(
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

  reg(
    "find_providers",
    {
      description: hosted
        ? "Lists up to 5 facilities in one US state that perform a procedure, with name, address and a pricing_status field: 'observed' means a negotiated rate is published in that facility's price transparency data, 'estimated' means only a state-level benchmark applies, 'none' means no price data. Dollar amounts are not returned. The list is partial and is not a ranking or a recommendation."
        : "Find healthcare providers for a procedure in a US state. Each provider has pricing_status: 'observed' (a negotiated rate is published in the facility's hospital transparency data), 'estimated' (state-level benchmark), or 'none'. Set cluster=true for city-level groups with lat/lng.",
      inputSchema: {
        procedure: z.string().describe("Procedure slug or plain name, e.g. 'colonoscopy'"),
        state: z.string().describe("2-letter US state code, e.g. 'CT'"),
        limit: hosted
          ? z.number().int().min(1).max(HOSTED_MAX_PROVIDERS).optional().describe(`Max results, 1 to ${HOSTED_MAX_PROVIDERS} (default ${HOSTED_MAX_PROVIDERS})`)
          : z.number().int().min(1).max(100).optional().describe("Max results (default 25)"),
        ...(hosted ? {} : { cluster: z.boolean().optional().describe("Group by city with lat/lng (default false)") }),
      },
    },
    ({ procedure, state, limit, cluster }) =>
      // Hosted: small pages only, so the public endpoint can't be used to bulk-export provider data.
      callApi("GET", "/v1/providers", hosted
        ? { query: { procedure, state, limit: Math.min(limit ?? HOSTED_MAX_PROVIDERS, HOSTED_MAX_PROVIDERS) } }
        : { query: { procedure, state, limit, cluster } })
  );

  reg(
    "get_provider",
    {
      description: "Public profile for a single provider by 10-digit NPI number: name, specialty, address, entity type.",
      inputSchema: { npi: z.string().describe("10-digit NPI number") },
    },
    ({ npi }) => callApi("GET", `/v1/providers/${encodeURIComponent(npi)}`)
  );

  reg(
    "resolve_procedure",
    {
      description:
        "Maps a free-text procedure name ('knee mri', 'gallbladder removal') to a CostKits catalog slug with a confidence score. Returns best_match and alternatives; best_match is null when the procedure is not in the catalog.",
      inputSchema: { query: z.string().describe("Free-text procedure name") },
    },
    ({ query }) => callApi("GET", "/v1/procedures/resolve", { query: { q: query } })
  );

  reg(
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

  reg(
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
      if (hosted && aspect === "full") aspect = "facts"; // full ontology is not served by the public hosted app
      const suffix = aspect === "full" ? "" : `/${aspect}`;
      return callApi("GET", `/v1/procedure/${encodeURIComponent(slug)}${suffix}`);
    }
  );

  reg(
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
      hosted && aspect === "triggers"
        ? { isError: true, content: [{ type: "text", text: "Coverage triggers are not available in the ChatGPT app. Use aspect 'summary', 'prior-auth', 'cost-sharing' or 'frequency'." }] }
        : callApi("GET", `/v1/coverage/${aspect}`, { query: { procedure, carrier, plan_type } })
  );

  reg(
    "list_carriers",
    {
      description: "All insurance carrier keys supported by the coverage tools (aetna, cigna, bcbs, medicare, ...). Works on the Free plan — also a good API-key sanity check.",
      inputSchema: {},
    },
    () => callApi("GET", "/v1/coverage/carriers")
  );

  reg(
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


  reg(
    "check_financial_assistance",
    {
      description:
        "Screen a household for hospital financial assistance (charity care): returns income as a percent of the federal poverty guidelines, the typical range hospital policies cover, what federal rules (IRS 501(r)) do and do not guarantee, and next steps. Use when a user asks whether they might qualify for help paying a hospital bill. It is a screening estimate, not an eligibility decision: each hospital sets its own limits. Needs household size and annual household income; do not ask for names, account numbers or bill details.",
      inputSchema: {
        household_size: z.number().int().min(1).max(20).describe("Number of people in the household, including the patient"),
        annual_household_income: z.number().min(0).max(10000000).describe("Total annual household income before taxes, in dollars"),
        state: z.string().length(2).optional().describe("2-letter US state code; only Alaska and Hawaii change the poverty guideline"),
      },
    },
    ({ household_size, annual_household_income, state }) => ({
      content: [{ type: "text", text: JSON.stringify(screenFinancialAssistance({ household_size, annual_household_income, state })) }],
    })
  );

  return server;
}
