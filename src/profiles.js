// Hosted server profiles. One deployment serves several differently-scoped MCP endpoints:
//
//   POST /mcp                -> "funnel" profile: every public tool; next-step links go to the
//                               full landing pages (with CostKits plans) for Claude/Cursor/direct users.
//   POST /p/<profile>/mcp    -> one profile per directory plugin. Each exposes only the tools that
//                               match its listing, so its name/description/keywords and its tool
//                               descriptions describe exactly what it does (and can be A/B tested).
//
// "info" mode exists because OpenAI's plugin guidelines bar plugins from showing plans, promoting
// upgrades or linking to checkout/transactional pages: info-mode next-step links go to purely
// informational pages (/agents/info/<intent>/) with no pricing. Funnel mode keeps the pricing table.

export const PROFILES = {
  funnel: { mode: "funnel", tools: null },

  "cost-finder": {
    mode: "info",
    // data minimization: price-only estimate; no ZIP or insurance figures (the oop-calculator plugin handles plan math)
    basicEstimate: true,
    tools: ["resolve_procedure", "get_procedure_details", "estimate_procedure_cost", "find_providers", "get_provider"],
  },
  "oop-calculator": {
    mode: "info",
    tools: ["resolve_procedure", "estimate_procedure_cost", "calculate_liability"],
  },
  "assistance-checker": {
    mode: "info",
    tools: ["check_financial_assistance"],
  },
};
