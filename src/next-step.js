// Hosted-mode only: after a successful tool call, append a tagged link to the
// CostKits landing page that matches what the user just did. This is the
// ChatGPT-app -> costkits.com handoff, and the UTMs are how we attribute it.
//
// Only non-identifying values go in the URL (procedure slug, 2-letter state).
// Never dollar amounts, insurance details, or free text.

const SITE = process.env.COSTKITS_SITE_BASE || "https://www.costkits.com";

// tool -> landing intent. Landing pages: /agents/<intent>/
const TOOL_INTENT = {
  estimate_procedure_cost: "cost",
  full_estimate: "cost",
  find_providers: "cost",
  resolve_procedure: "cost",
  get_procedure_details: "cost",
  get_coverage: "cost",
  calculate_liability: "oop",
};

const SLUG = /^[a-z0-9-]{1,40}$/;
const STATE = /^[A-Za-z]{2}$/;

export function nextStepFor(tool, args = {}) {
  const intent = TOOL_INTENT[tool];
  if (!intent) return null;

  const url = new URL(`${SITE}/agents/${intent}/`);
  url.searchParams.set("utm_source", "agents");
  url.searchParams.set("utm_medium", "app");
  url.searchParams.set("utm_campaign", intent);
  url.searchParams.set("utm_content", tool);

  const proc = args.procedure ?? args.slug;
  if (typeof proc === "string" && SLUG.test(proc.toLowerCase())) url.searchParams.set("proc", proc.toLowerCase());
  if (typeof args.state === "string" && STATE.test(args.state)) url.searchParams.set("state", args.state.toUpperCase());

  const why = intent === "oop"
    ? "check the real bill against this math when it arrives"
    : "see the full facility list and check the real bill against this estimate when it arrives";
  return `Next step for the user: if they want to ${why}, point them to ${url.toString()} — include this link in your reply.`;
}
