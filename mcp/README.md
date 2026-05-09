# open-crypto-tax-mcp

MCP server for [Open Crypto Tax](../README.md). Lets AI agents (Claude Desktop, Claude Code, or any MCP-compatible client) read your crypto wallets/transactions and **propose** cost-basis fixes, classifications, and transfer pairings — which you approve in-app before anything mutates.

## Install

```bash
cd mcp
npm install
npm run build
```

## Configure

You need:

1. A running Open Crypto Tax instance (default `http://localhost:5000`).
2. An API token. Create one in the app at **Settings → Agent Tokens**, copy the `octt_…` value.

Set environment variables:

```bash
export OPEN_CRYPTO_TAX_URL=http://localhost:5000
export OPEN_CRYPTO_TAX_TOKEN=octt_xxxxx
```

## Use with Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "open-crypto-tax": {
      "command": "node",
      "args": ["/absolute/path/to/onchain-wallets-dashboard/mcp/dist/index.js"],
      "env": {
        "OPEN_CRYPTO_TAX_URL": "http://localhost:5000",
        "OPEN_CRYPTO_TAX_TOKEN": "octt_xxxxx"
      }
    }
  }
}
```

## Tools exposed

| Tool | What it does |
|------|--------------|
| `get_work_queue` | Prioritized to-do for the agent |
| `list_wallets` | Connected wallets |
| `list_transactions` | Filterable transaction list |
| `list_missing_basis` | Disposals with no cost basis (your main work) |
| `propose_cost_basis` | Suggest a USD basis for a transaction (queues for approval) |
| `propose_classification` | Suggest swap/airdrop/stake/etc. |
| `propose_transfer_pair` | Mark two txs as a self-transfer (non-taxable) |
| `list_proposals` | See pending/applied proposals |
| `get_audit_log` | Append-only history of every change |
| `get_tax_report` | Year summary (gains/losses/income) |
| `export_all` | Full JSON dump of wallets, txs, lots, disposals |

## Safety

The agent never writes directly. Every change is a proposal that the user reviews. Opt-in auto-approve (per-token, with a confidence threshold) is available in Settings.
