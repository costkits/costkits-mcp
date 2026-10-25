# CostKits MCP Server

Give Claude, ChatGPT, Cursor, and other MCP clients access to live US healthcare cost data.

CostKits provides procedure cost estimates, patient out-of-pocket calculations, provider pricing, and insurance coverage rules using hospital-transparency and CMS data rather than model memory.

> Ask healthcare cost questions in natural language. CostKits supplies the structured data and calculations.

[![npm](https://img.shields.io/npm/v/@costkits/costkits-mcp)](https://www.npmjs.com/package/@costkits/costkits-mcp)
[![MCP](https://img.shields.io/badge/Model_Context_Protocol-compatible-1E40AF)](https://modelcontextprotocol.io)
[![MCP Registry](https://img.shields.io/badge/MCP_Registry-listed-1E40AF)](https://registry.modelcontextprotocol.io/?search=costkits)
[![LightNow capabilities](https://lightnow.ai/badge/io.github.costkits/costkits-mcp)](https://lightnow.ai/servers/io.github.costkits/costkits-mcp)
[![Glama](https://glama.ai/mcp/servers/nui5hkst51/badge)](https://glama.ai/mcp/servers/nui5hkst51)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

A hosted [Model Context Protocol](https://modelcontextprotocol.io) server. **No API key, no signup.** It powers the CostKits app in ChatGPT and works with any MCP client that supports remote servers.

## What can an agent do with CostKits?

Ask questions such as:

- "What would a colonoscopy cost in Connecticut?"
- "How much would I owe if I have $500 left on my deductible and 20% coinsurance?"
- "Compare MRI prices from providers near Dallas."
- "Does this procedure commonly require prior authorization?"
- "Resolve 'knee scan' to the correct procedure and estimate the cost."

The MCP server selects the appropriate CostKits API tools and returns structured healthcare cost data the model can explain to the user.

```text
User question
    ↓
MCP client
    ↓
CostKits MCP tool
    ↓
CostKits healthcare cost API
    ↓
Structured estimate, provider pricing, coverage rule, or bill-analysis result
```

## Connect

**Remote (recommended):** add the server URL in any client that supports remote MCP servers (ChatGPT, Claude, Cursor, and others):

```text
https://mcp.costkits.com/mcp
```

**Claude Desktop via npm:** the package is a thin shim that forwards to the hosted server.

```json
{
  "mcpServers": {
    "costkits": {
      "command": "npx",
      "args": ["-y", "@costkits/costkits-mcp"]
    }
  }
}
```

## Available tools

| Tool | What it does |
|------|--------------|
| `resolve_procedure` | Match a plain-language procedure name to a supported procedure |
| `list_procedures` | The procedure catalog with CPT codes |
| `get_procedure_details` | Billing rules, cost drivers, and which separate bills to expect |
| `estimate_procedure_cost` | Cost range in a state, with expected out-of-pocket if you give plan details |
| `full_estimate` | Procedure, cost, providers, and liability in one call |
| `calculate_liability` | Deductible, coinsurance, and out-of-pocket math for a dollar amount |
| `find_providers` | Providers with observed hospital-transparency prices (up to 10 per call) |
| `get_provider` | Public profile for one provider by NPI |
| `get_coverage` | Prior auth, cost-sharing, and frequency rules by carrier |
| `list_carriers` | Supported insurance carriers |
| `demo_estimate` | Sample estimate, for checking your connection |

For bill review, use the [CostKits app](https://www.costkits.com/). Bill analysis is not available through this server.

## Privacy and data handling

These tools do not need patient names, member IDs, dates of birth, or medical-record identifiers, and you should not send them. Requests are logged without free text, only the tool, procedure, and state.

## Local development

```bash
npm install
npm run start:http   # hosted server on :8787, set COSTKITS_API_KEY for a server-side key
npm run smoke        # stdio shim against a local hosted server
npm run smoke:http   # hosted server contract
```

| Env var | Used by | Purpose |
|---------|---------|---------|
| `COSTKITS_MCP_URL` | stdio shim | Override the hosted URL (default `https://mcp.costkits.com/mcp`) |
| `COSTKITS_API_KEY` | hosted server | Server-side key for the CostKits backend |
| `COSTKITS_API_BASE` | hosted server | Backend base URL |
| `RATE_LIMIT_PER_MIN` | hosted server | Per-IP limit (default 60) |

## Links

[costkits.com](https://www.costkits.com) · [Interactive demo](https://www.costkits.com/api/demo/)

## About CostKits

CostKits is a healthcare cost-transparency platform built by [John Caruso, FSA, MAAA](https://www.costkits.com/about/), a healthcare actuary with more than 20 years of experience in insurance pricing, medical billing systems, and healthcare cost analytics.

This MCP server gives AI assistants and agents access to CostKits cost data.

[Methodology](https://www.costkits.com/methodology/)

## License

[MIT](./LICENSE)
