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

// Request/response log: one JSON line per HTTP request, for diagnosing what a client (ChatGPT, Claude...) actually
// sent and got back. Structure only: the JSON-RPC method, tool name, argument KEY names (never values), status,
// sizes and timing, and for errors a short message with digits masked. No bodies, IPs, or query text.
const clip = (s, n) => String(s).slice(0, n);

function uaClass(ua = "") {
  const u = ua.toLowerCase();
  if (/openai|chatgpt|oai/.test(u)) return "openai";
  if (/claude|anthropic/.test(u)) return "anthropic";
  if (/cursor/.test(u)) return "cursor";
  if (/node|undici|python|curl|postman/.test(u)) return "script";
  return "other";
}

function summarizeRequest(bodyText) {
  try {
    const msg = JSON.parse(bodyText);
    const one = Array.isArray(msg) ? msg[0] : msg;
    return {
      batch: Array.isArray(msg) ? msg.length : undefined,
      rpc: one?.method ?? null,
      tool: one?.method === "tools/call" && typeof one?.params?.name === "string" ? clip(one.params.name, 60) : null,
      arg_keys: one?.method === "tools/call" && one?.params?.arguments ? Object.keys(one.params.arguments).slice(0, 20) : null,
    };
  } catch {
    return { rpc: "unparseable" };
  }
}

function summarizeResponse(bodyText) {
  try {
    const msg = JSON.parse(bodyText);
    const out = {};
    if (msg.error) {
      out.rpc_error = msg.error.code;
      out.rpc_error_msg = clip(String(msg.error.message ?? "").replace(/\d/g, "#"), 100);
    }
    const r = msg.result;
    if (r?.tools) out.tools_listed = r.tools.length;
    if (r && "isError" in r) {
      out.tool_error = !!r.isError;
      if (r.isError) out.tool_error_msg = clip(String(r.content?.[0]?.text ?? "").replace(/\d/g, "#"), 100);
    }
    return out;
  } catch {
    return {};
  }
}

export function logRequest({ method, path, profile, status, ms, headers = {}, requestBody = "", responseBody = "" }) {
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    evt: "request",
    method,
    path: clip(path, 80),
    profile: profile ?? null,
    status,
    ms,
    ua: uaClass(headers["user-agent"]),
    ua_raw: clip(headers["user-agent"] ?? "", 60),
    bytes_in: Buffer.byteLength(requestBody),
    bytes_out: Buffer.byteLength(responseBody),
    ...(requestBody ? summarizeRequest(requestBody) : {}),
    ...(responseBody && path !== "/.well-known/openai-apps-challenge" ? summarizeResponse(responseBody) : {}),
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
