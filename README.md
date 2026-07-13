# costkits-mcp

Give Claude, ChatGPT, or any MCP client **live US healthcare cost data** — procedure cost estimates, provider pricing, insurance coverage rules, and medical bill analysis, grounded in real hospital transparency and CMS data instead of model priors.

A thin [Model Context Protocol](https://modelcontextprotocol.io) server for the [CostKits API](https://github.com/costkits/costkits-api).

## Quick start (Claude Desktop)

Add to your `claude_desktop_config.json` (Settings → Developer → Edit Config):

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

Get a free key at [costkits.com/api-keys/](https://www.costkits.com/api-keys/). No key yet? The server still runs — the `demo_estimate` tool works with no key at all, so you can verify the wiring first.

Restart Claude Desktop, then ask:

> *"What would a colonoscopy cost me in Connecticut if I have $500 left on my deductible and 20% coinsurance?"*

Works the same with any MCP client (Claude Code, ChatGPT desktop, Cursor, ...) — see [`examples/claude-desktop-config.json`](./examples/claude-desktop-config.json).

## Tools

| Tool | What the model gets | Plan |
|------|--------------------|------|
| `demo_estimate` | Static sample estimate — connectivity check | none |
| `resolve_procedure` | Free text → canonical procedure slug | Builder |
| `estimate_procedure_cost` | Cost range + patient out-of-pocket for a procedure/state | Builder |
| `calculate_liability` | Exact insurance math for a known allowed amount | Builder |
| `full_estimate` | Ontology + cost + providers + liability in one call | Builder |
| `find_providers` | Providers with real negotiated prices (`pricing_status: observed`) | Builder |
| `get_provider` | Single provider profile by NPI | Builder |
| `list_procedures` | The 30-procedure catalog with CPT codes | Builder |
| `get_procedure_details` | LLM-ready facts, billing bundle, or full ontology | Builder |
| `get_coverage` | Coverage rules by aspect: summary, prior-auth, cost-sharing, frequency, triggers | Builder (triggers: Pro) |
| `list_carriers` | Supported carrier keys — also a key sanity check | Free |
| `analyze_bill` | Anomaly flags + risk score for bill line items | Pro |

Plans and pricing: [costkits-api → plans-and-pricing](https://github.com/costkits/costkits-api/blob/main/docs/plans-and-pricing.md).

## Why this API behaves well in agent loops

- **Self-correcting errors.** Every API error carries an `agent_hint` ("Call GET /v1/procedures/resolve?q=... Closest matches: mri-knee, x-ray"). This server surfaces the hint to the model verbatim, so a typo'd procedure name becomes a resolve-and-retry, not a dead end.
- **Ranges, sources, vintages.** Responses include p25/p50/p75, `data_sources`, and `data_vintage` — everything the model needs to answer responsibly instead of confidently.
- **Stateless bill analysis.** `analyze_bill` needs only codes and amounts. Don't send names, member IDs, or birth dates; the API neither needs nor stores them.

## Configuration

| Env var | Required | Default | Purpose |
|---------|----------|---------|---------|
| `COSTKITS_API_KEY` | For all tools except `demo_estimate` | — | Your `ck_...` key |
| `COSTKITS_API_BASE` | No | `https://api.costkits.com` | Override for testing |

## Local development

```bash
git clone https://github.com/costkits/costkits-mcp && cd costkits-mcp
npm install
npm run smoke     # spawns the server and calls demo_estimate over real MCP stdio
```

## Publishing / releasing a new version

This package is listed on both npm and the [official MCP Registry](https://registry.modelcontextprotocol.io) (`io.github.costkits/costkits-mcp`). They are separate systems — publishing to npm does **not** automatically update the MCP Registry entry.

To ship a new version:

1. Bump `version` in **both** `package.json` and `server.json` (must match exactly), and keep `mcpName` in `package.json` in sync with `name` in `server.json`.
2. `npm publish --access public` (requires npm browser OTP approval — must be run interactively, not from CI without a token).
3. Publish the new version to the MCP Registry:
   ```bash
   gh workflow run publish-mcp.yml --repo costkits/costkits-mcp
   ```
   or push a `vX.Y.Z` tag, which triggers the same workflow (`.github/workflows/publish-mcp.yml`).

Notes:
- The workflow authenticates via **GitHub Actions OIDC** (`mcp-publisher login github-oidc`), not personal GitHub login. Do not use `mcp-publisher login github` + `mcp-publisher publish` from a local machine for this org-owned repo — it hits a [known registry bug](https://github.com/modelcontextprotocol/registry/issues/398) requiring your GitHub org membership to be public, which we don't want to keep on.
- MCP Registry versions are **immutable** once published — there's no delete/edit, only publishing a new version string.
- Registry entries other than the official one (e.g. Smithery, mcp.so, Cursor's directory, Glama) are independent third-party services — some poll the official registry, some require separate manual/API submission. Publishing here does not guarantee they pick it up; check each one if visibility there matters.

## Links

[CostKits API docs & examples](https://github.com/costkits/costkits-api) · [costkits.com](https://www.costkits.com) · [Interactive demo](https://www.costkits.com/api/demo/) · [Get an API key](https://www.costkits.com/api-keys/)

## About CostKits

CostKits is a healthcare cost-transparency platform built and maintained by [John Caruso, FSA, MAAA](https://www.costkits.com/about/) — a healthcare actuary with 20+ years in insurance pricing, medical billing systems, and healthcare cost analytics. This MCP server wraps the same pricing engine behind [costkits.com](https://www.costkits.com)'s consumer tools. See our [data & pricing methodology](https://www.costkits.com/methodology/) for how estimates are sourced.

## License

[MIT](./LICENSE)
