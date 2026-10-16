// Pieces shared by the two hosted entrypoints (http.js for a plain Node process,
// lambda.js for AWS Lambda): PII-free usage logging and a per-client limiter.

// Usage log: one JSON line per tool call. No free text, no insurance numbers.
// procedure is logged only when it is slug-shaped; state only when 2 letters.
export function logToolCall({ tool, args = {}, ok, ms, profile }) {
  const raw = args.procedure ?? args.slug;
  const proc = typeof raw === "string" ? raw.toLowerCase() : null;
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    evt: "tool_call",
    profile: profile || "funnel",
    tool,
    ok,
    ms,
    procedure: proc && /^[a-z0-9-]{1,40}$/.test(proc) ? proc : null,
    state: typeof args.state === "string" && /^[A-Za-z]{2}$/.test(args.state) ? args.state.toUpperCase() : null,
  }));
}

// Fixed-window per-client limiter. In-memory, so it is per process / per Lambda
// container: a courtesy limit, not a global cap. The global cap is Lambda
// reserved concurrency plus the account-level controls documented in
// shared/marketing/agent-distribution/.
export function makeRateLimiter(perMinute) {
  const hits = new Map();
  return function rateLimited(client) {
    const minute = Math.floor(Date.now() / 60000);
    const rec = hits.get(client);
    if (!rec || rec.minute !== minute) {
      hits.set(client, { minute, n: 1 });
      if (hits.size > 10000) for (const [k, v] of hits) if (v.minute !== minute) hits.delete(k);
      return false;
    }
    return ++rec.n > perMinute;
  };
}
