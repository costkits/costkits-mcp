#!/usr/bin/env node
// CostKits MCP — stdio shim for the hosted CostKits MCP server.
//
// No API key needed. This process forwards tool listing and tool calls to the
// hosted streamable-HTTP endpoint (src/http.js, deployed at COSTKITS_MCP_URL),
// so npm / Claude Desktop users get exactly the same tools as the ChatGPT app.
// MCP clients that support remote servers can skip this package and connect to
// the URL directly.

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { readFileSync } from "node:fs";

const PKG_VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
const REMOTE_URL = process.env.COSTKITS_MCP_URL || "https://mcp.costkits.com/mcp";

const upstream = new Client({ name: "costkits-mcp-shim", version: PKG_VERSION });
await upstream.connect(new StreamableHTTPClientTransport(new URL(REMOTE_URL)));

const server = new Server(
  { name: "costkits", version: PKG_VERSION },
  { capabilities: { tools: {} } }
);
server.setRequestHandler(ListToolsRequestSchema, async () => upstream.listTools());
server.setRequestHandler(CallToolRequestSchema, async (req) =>
  upstream.callTool({ name: req.params.name, arguments: req.params.arguments ?? {} })
);

await server.connect(new StdioServerTransport());
console.error(`costkits-mcp ready (forwarding to ${REMOTE_URL})`);
