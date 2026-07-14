# CostKits MCP Server

Give Claude, ChatGPT, Cursor, and other MCP clients access to live US healthcare cost data.

CostKits provides procedure cost estimates, patient out-of-pocket calculations, provider pricing, insurance coverage rules, and medical bill analysis using hospital-transparency and CMS data rather than model memory.

> Ask healthcare cost questions in natural language. CostKits supplies the structured data and calculations.

[![npm](https://img.shields.io/npm/v/@costkits/costkits-mcp)](https://www.npmjs.com/package/@costkits/costkits-mcp)
[![MCP](https://img.shields.io/badge/Model_Context_Protocol-compatible-1E40AF)](https://modelcontextprotocol.io)
[![MCP Registry](https://img.shields.io/badge/MCP_Registry-listed-1E40AF)](https://registry.modelcontextprotocol.io/?search=costkits)
[![smithery badge](https://smithery.ai/badge/@costkits/costkits-mcp)](https://smithery.ai/servers/costkits/costkits-mcp)
[![Glama](https://glama.ai/mcp/servers/nui5hkst51/badge)](https://glama.ai/mcp/servers/nui5hkst51)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)

A thin [Model Context Protocol](https://modelcontextprotocol.io) server for the [CostKits API](https://github.com/costkits/costkits-api).

## What can an agent do with CostKits?

Ask questions such as:

- "What would a colonoscopy cost in Connecticut?"
- "How much would I owe if I have $500 left on my deductible and 20% coinsurance?"
- "Compare MRI prices from providers near Dallas."
- "Does this procedure commonly require prior authorization?"
- "Do these medical bill line items show possible duplicate or unbundled charges?"
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

## Quick start with Claude Desktop

### 1. Get a free API key

Create a key at [costkits.com/api-keys](https://www.costkits.com/api-keys/).

You can test the installation without a key using the `demo_estimate` tool.

### 2. Add the MCP server

Add this to `claude_desktop_config.json` (Settings → Developer → Edit Config):

```json
{
  "mcpServers": {
    "costkits": {
      "command": "npx",
      "args": ["-y", "@costkits/costkits-mcp"],
      "env": {
        "COSTKITS_API_KEY": "ck_your_key_here"
      }
    }
  }
}
```

### 3. Restart Claude Desktop

Restart Claude Desktop so it reloads the MCP configuration.

### 4. Try a prompt

> What would a colonoscopy cost me in Connecticut if I have $500 left on my deductible and 20% coinsurance?

The server uses MCP stdio transport and can be used with compatible MCP clients. A tested configuration example is provided for Claude Desktop in [`examples/claude-desktop-config.json`](./examples/claude-desktop-config.json).

## Available tools

### Cost estimation

| Tool | Purpose | Plan |
|---|---|---|
| `demo_estimate` | Return a sample estimate and verify connectivity | None |
| `resolve_procedure` | Convert free text into a supported procedure | Builder |
| `estimate_procedure_cost` | Estimate procedure cost by geography | Builder |
| `calculate_liability` | Calculate patient responsibility from benefit inputs | Builder |
| `full_estimate` | Combine procedure, cost, provider, and liability data | Builder |

### Provider pricing

| Tool | Purpose | Plan |
|---|---|---|
| `find_providers` | Find providers with observed negotiated prices | Builder |
| `get_provider` | Retrieve a provider profile by NPI | Builder |

### Procedure and coverage intelligence

| Tool | Purpose | Plan |
|---|---|---|
| `list_procedures` | List supported procedures and CPT codes | Builder |
| `get_procedure_details` | Retrieve billing bundles and procedure facts | Builder |
| `get_coverage` | Retrieve prior auth, cost-sharing, frequency, and trigger rules | Builder (triggers: Pro) |
| `list_carriers` | List supported carrier identifiers | Free |

### Bill analysis

| Tool | Purpose | Plan |
|---|---|---|
| `analyze_bill` | Flag possible duplicate, unbundled, or suspicious bill items | Pro |

Plans and pricing: [costkits-api → plans-and-pricing](https://github.com/costkits/costkits-api/blob/main/docs/plans-and-pricing.md).

## Designed for reliable agent workflows

- **Self-correcting errors** — API errors include an `agent_hint` that tells the model what to call next. A typo'd procedure name becomes a resolve-and-retry, not a dead end.
- **Transparent estimates** — responses include estimate ranges (p25/p50/p75), data sources, data vintage, and model version.
- **Structured procedure resolution** — agents can translate user language into supported procedure identifiers before estimating costs.
- **Minimal sensitive data** — bill analysis requires codes and amounts, not names, member IDs, or dates of birth.
- **Deterministic insurance math** — deductible, coinsurance, copay, and out-of-pocket calculations are performed by the API rather than improvised by the model.

## Privacy and data handling

CostKits tools do not require patient names, member IDs, dates of birth, or medical-record identifiers.

For bill analysis, send only the billing codes, descriptions, and amounts needed for analysis. Do not send protected health information.

## Configuration

| Env var | Required | Default | Purpose |
|---------|----------|---------|---------|
| `COSTKITS_API_KEY` | For all tools except `demo_estimate` | — | Your `ck_...` key |
| `COSTKITS_API_BASE` | No | `https://api.costkits.com` | Override for testing |

## Local development

Requirements:

- Node.js 18 or later
- npm
- A CostKits API key for non-demo tools

```bash
git clone https://github.com/costkits/costkits-mcp
cd costkits-mcp
npm install
npm run smoke     # spawns the server and calls demo_estimate over real MCP stdio
```

Run locally:

```bash
COSTKITS_API_KEY=ck_your_key_here npm start
```

## Registry information

- **Package:** `@costkits/costkits-mcp`
- **Category:** Healthcare / Finance / Data
- **Transport:** stdio
- **Authentication:** CostKits API key
- **Public demo tool:** `demo_estimate`
- **Source:** [github.com/costkits/costkits-mcp](https://github.com/costkits/costkits-mcp)

## Links

[CostKits API docs & examples](https://github.com/costkits/costkits-api) · [costkits.com](https://www.costkits.com) · [Interactive demo](https://www.costkits.com/api/demo/) · [Get an API key](https://www.costkits.com/api-keys/)

## About CostKits

CostKits is a healthcare cost-transparency platform built by [John Caruso, FSA, MAAA](https://www.costkits.com/about/), a healthcare actuary with more than 20 years of experience in insurance pricing, medical billing systems, and healthcare cost analytics.

This MCP server exposes the [CostKits API](https://github.com/costkits/costkits-api) as tools for AI assistants and agents.

[Methodology](https://www.costkits.com/methodology/) · [API documentation](https://www.costkits.com/api/)

## License

[MIT](./LICENSE)
