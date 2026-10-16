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
import { logToolCall, makeRateLimiter } from "./hosting.js";

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

export async function handler(event) {
  const method = event.requestContext?.http?.method || "GET";
  const path = event.rawPath || "/";

  if (path === "/healthz") return json(200, { ok: true });
  if (path !== "/mcp") return json(404, { error: "not found" });
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
    const server = createServer({ apiBase: API_BASE, apiKey: await getApiKey(), hosted: true, onToolCall: logToolCall });
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
