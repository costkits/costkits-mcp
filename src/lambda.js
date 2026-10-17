// CostKits MCP — AWS Lambda entrypoint (Function URL, payload format 2.0).
//
// Stateless, same contract as http.js: POST /mcp, GET /healthz. Uses the
// web-standard transport so the Lambda event maps to a Request/Response pair.
//
// Env: COSTKITS_API_KEY_SECRET_ID (Secrets Manager id holding the backend key;
//      preferred) or COSTKITS_API_KEY, COSTKITS_API_BASE, COSTKITS_SITE_BASE,
//      RATE_LIMIT_PER_MIN (default 60 per client IP, per container)

import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { createServer } from "./tools.js";
import { logToolCall, logRequest, makeRateLimiter } from "./hosting.js";
import { PROFILES } from "./profiles.js";

const API_BASE = process.env.COSTKITS_API_BASE || "https://api.costkits.com";
const MAX_BODY_BYTES = 256 * 1024;
const rateLimited = makeRateLimiter(Number(process.env.RATE_LIMIT_PER_MIN || 60));

// Resolved once per container (cold start), not per request.
let apiKeyPromise;
function getApiKey() {
  apiKeyPromise ??= (async () => {
    const secretId = process.env.COSTKITS_API_KEY_SECRET_ID;
    if (!secretId) return process.env.COSTKITS_API_KEY || null;
    const { SecretsManagerClient, GetSecretValueCommand } = await import("@aws-sdk/client-secrets-manager");
    const out = await new SecretsManagerClient({}).send(new GetSecretValueCommand({ SecretId: secretId }));
    const raw = out.SecretString || "";
    try { return JSON.parse(raw).COSTKITS_API_KEY ?? raw; } catch { return raw.trim(); }
  })();
  return apiKeyPromise;
}

const json = (statusCode, body, headers = {}) => ({
  statusCode,
  headers: { "content-type": "application/json", ...headers },
  body: JSON.stringify(body),
});

// Wraps routing so every request (except health checks) gets one structural log line.
export async function handler(event) {
  const started = Date.now();
  const res = await route(event);
  const path = event.rawPath || "/";
  if (path !== "/healthz") {
    const pm = path.match(/^\/p\/([a-z0-9-]+)\/mcp$/);
    const raw = event.body ? (event.isBase64Encoded ? Buffer.from(event.body, "base64").toString() : event.body) : "";
    try {
      logRequest({
        method: event.requestContext?.http?.method || "GET",
        path, profile: pm ? pm[1] : path === "/mcp" ? "funnel" : null,
        status: res.statusCode, ms: Date.now() - started, headers: event.headers || {},
        requestBody: raw.length <= MAX_BODY_BYTES ? raw : "", responseBody: res.body || "",
      });
    } catch { /* logging must never break a request */ }
  }
  return res;
}

async function route(event) {
  const method = event.requestContext?.http?.method || "GET";
  const path = event.rawPath || "/";

  if (path === "/healthz") return json(200, { ok: true });

  // OpenAI domain-verification challenge (plain text token from the plugin portal).
  // Each plugin gets its own hostname and its own token. CloudFront does not forward Host to a Lambda URL, so a
  // viewer-request function copies it into x-viewer-host. OPENAI_APPS_CHALLENGES = JSON {"host": "token"};
  // OPENAI_APPS_CHALLENGE (single token) remains the answer for mcp.costkits.com / when no host header is present.
  if (path === "/.well-known/openai-apps-challenge") {
    const host = String(event.headers?.["x-viewer-host"] || "").toLowerCase().replace(/:\d+$/, "");
    let map = {};
    try { map = JSON.parse(process.env.OPENAI_APPS_CHALLENGES || "{}"); } catch { /* ignore bad config */ }
    const token = map[host] ?? (!host || host === "mcp.costkits.com" ? process.env.OPENAI_APPS_CHALLENGE : undefined);
    if (token) return { statusCode: 200, headers: { "content-type": "text/plain" }, body: token };
  }

  // /mcp = funnel profile; /p/<profile>/mcp = one profile per directory plugin (see profiles.js).
  let profile = "funnel";
  const m = path.match(/^\/p\/([a-z0-9-]+)\/mcp$/);
  if (m) {
    if (m[1] === "funnel" || !PROFILES[m[1]]) return json(404, { error: "not found" });
    profile = m[1];
  } else if (path !== "/mcp") {
    return json(404, { error: "not found" });
  }
  if (method !== "POST") {
    return json(405, { jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null }, { allow: "POST" });
  }

  const ip = event.requestContext?.http?.sourceIp || "unknown";
  if (rateLimited(ip)) return json(429, { error: "rate limited" }, { "retry-after": "60" });

  const body = event.body ? (event.isBase64Encoded ? Buffer.from(event.body, "base64") : Buffer.from(event.body)) : Buffer.alloc(0);
  if (body.length > MAX_BODY_BYTES) return json(413, { error: "too large" });

  try {
    const request = new Request(`https://${event.requestContext?.domainName || "localhost"}${path}`, {
      method,
      headers: event.headers || {},
      body,
    });
    const server = createServer({ apiBase: API_BASE, apiKey: await getApiKey(), hosted: true, profile, onToolCall: logToolCall });
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    const res = await transport.handleRequest(request);
    const out = {
      statusCode: res.status,
      headers: Object.fromEntries(res.headers),
      body: await res.text(),
    };
    await transport.close();
    await server.close();
    return out;
  } catch (err) {
    console.error("mcp request failed:", err.message);
    return json(500, { jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null });
  }
}
