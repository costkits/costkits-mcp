#!/usr/bin/env node
// CostKits MCP server — hosted streamable-HTTP entrypoint (ChatGPT app / remote MCP clients).
//
// Stateless: every POST /mcp gets a fresh server + transport, so it runs
// unchanged on a single process, behind a load balancer, or in Lambda.
// Uses ONE server-side CostKits API key (COSTKITS_API_KEY); callers never see it.
// Public pricing data only: PHI-adjacent tools are withheld (see tools.js).
//
// Env: COSTKITS_API_KEY (required), COSTKITS_API_BASE, COSTKITS_SITE_BASE,
//      PORT (default 8787), RATE_LIMIT_PER_MIN (default 60 per client IP)

import { createServer as createHttpServer } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "./tools.js";
import { logToolCall, makeRateLimiter } from "./hosting.js";

const PORT = Number(process.env.PORT || 8787);
const API_BASE = process.env.COSTKITS_API_BASE || "https://api.costkits.com";
const API_KEY = process.env.COSTKITS_API_KEY || null;
const RATE_LIMIT = Number(process.env.RATE_LIMIT_PER_MIN || 60);
const MAX_BODY_BYTES = 256 * 1024;

if (!API_KEY) console.error("WARNING: COSTKITS_API_KEY not set — only demo_estimate will work");

const rateLimited = makeRateLimiter(RATE_LIMIT);

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) { reject(Object.assign(new Error("too large"), { status: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined); }
      catch { reject(Object.assign(new Error("invalid json"), { status: 400 })); }
    });
    req.on("error", reject);
  });
}

const httpServer = createHttpServer(async (req, res) => {
  const { pathname } = new URL(req.url, "http://localhost");

  if (pathname === "/healthz") return send(res, 200, { ok: true });

  if (pathname !== "/mcp") return send(res, 404, { error: "not found" });

  // Stateless mode has no server->client stream or sessions to delete.
  if (req.method !== "POST") {
    return send(res, 405, { jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null }, { Allow: "POST" });
  }

  const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown").toString().split(",")[0].trim();
  if (rateLimited(ip)) return send(res, 429, { error: "rate limited" }, { "Retry-After": "60" });

  try {
    const body = await readBody(req);
    const server = createServer({ apiBase: API_BASE, apiKey: API_KEY, hosted: true, onToolCall: logToolCall });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => { transport.close(); server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  } catch (err) {
    if (!res.headersSent) {
      const status = err.status || 500;
      send(res, status, { jsonrpc: "2.0", error: { code: -32603, message: status === 500 ? "Internal server error" : err.message }, id: null });
    }
    if (!err.status) console.error("mcp request failed:", err.message);
  }
});

httpServer.listen(PORT, () => console.error(`costkits-mcp hosted on :${PORT}/mcp (${API_BASE}${API_KEY ? ", key set" : ", no key"})`));
