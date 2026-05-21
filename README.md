# Open Crypto Tax

**Free, self-hosted, AI-agent-friendly crypto records organizer.**

Connect your wallets, fix the missing-cost-basis problem, and produce a clean, structured dataset for your own review, your AI agent, or a qualified tax professional.

> **Important:** This is informational software only. It is not tax, legal, accounting, investment, financial, or compliance advice; it does not determine filing obligations; and exports are draft worksheets, not official tax forms. Verify everything with a qualified professional before filing or making decisions.

> Originally built to find missing cost basis in my own taxes. Saved me a lot of money when I handed it to Claude to review. Open-sourcing it so you can do the same.

- 🪙 **Aggregate** wallets across Ethereum, Bitcoin, Solana, Polygon, Arbitrum, Optimism, Base, Avalanche, BSC.
- 🔎 **Find** every disposal where cost basis is unknown — the headline workflow.
- 🕵️ **Discover forgotten wallets** by analyzing counterparties across your existing transactions. Bidirectional flow + multi-chain presence + repeated interaction = a wallet you probably own and forgot. Adding one usually unlocks a stack of missing-basis problems at once.
- 🤖 **Agent-native**: an MCP server + REST API + JSON export. Claude proposes fixes; you approve in-app.
- 🧾 **Review-ready**: draft Form 8949/Schedule D-style worksheets, income summaries, plus a structured JSON export your accountant or LLM can parse.
- 🔒 **Self-hosted**: read-only wallet tracking. Your keys never leave your wallet. MIT-licensed.

---

## Quick start (local, no Firebase)

The fastest path is local-auth mode (single user, no Google Cloud setup).

```bash
git clone <this-repo>
cd onchain-wallets-dashboard
cp .env.example .env       # then edit DATABASE_URL etc.
docker compose up          # starts Postgres + the app at http://localhost:5000
```

Then visit http://localhost:5000. You're already "logged in" as the local user. Add a wallet on the **Wallets** page, sync it, and watch your transactions appear.

### Using your AI agent

1. Go to **Settings → Agent API Tokens** and create one (e.g. `claude-desktop`, scopes `read` + `basis:propose`).
2. Build the MCP server: `cd mcp && npm install && npm run build`.
3. Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

   ```json
   {
     "mcpServers": {
       "open-crypto-tax": {
         "command": "node",
         "args": ["/absolute/path/to/onchain-wallets-dashboard/mcp/dist/index.js"],
         "env": {
           "OPEN_CRYPTO_TAX_URL": "http://localhost:5000",
           "OPEN_CRYPTO_TAX_TOKEN": "octt_..."
         }
       }
     }
   }
   ```

4. In Claude, ask: *"What transactions are missing cost basis? Look up historical prices and propose fixes."* Claude reads your data via the MCP tools and submits proposals. Approve them on the **Agent Proposals** page.

---

## Manual install (no Docker)

You need: Node 20+, PostgreSQL 14+.

```bash
npm install
cp .env.example .env
# edit DATABASE_URL to point at your Postgres

npm run db:push     # apply schema
npm run dev         # http://localhost:5000
```

---

## Configuration

Everything is environment-variable driven. See `.env.example` for the full list. Key ones:

| Variable | Required | Purpose |
|----------|----------|---------|
| `DATABASE_URL` | yes | Postgres connection string |
| `SESSION_SECRET` | yes (prod) | Session cookie secret |
| `AUTH_MODE` | no | `local` (default if no Firebase) or `firebase` |
| `LOCAL_USER_ID` | no | User id when `AUTH_MODE=local` (default `local-user`) |
| `ALCHEMY_API_KEY` | no | Required to sync EVM wallet transactions |
| `FIREBASE_PROJECT_ID` | iff `AUTH_MODE=firebase` | Multi-user auth |
| `FIREBASE_SERVICE_ACCOUNT` | iff `AUTH_MODE=firebase` | Service account JSON |
| `TELEGRAM_BOT_TOKEN` | no | Push notifications + classify-by-reply |

---

## How "agent fixes it all" works

```
┌─────────┐   propose      ┌──────────┐   approve     ┌──────────┐
│ Agent   │ ─────────────► │ Proposal │ ─────────────►│ Applied  │
│ (MCP)   │                │  queue   │ ◄─────────── │ + audit  │
└─────────┘                └──────────┘   reject      └──────────┘
```

- The agent **never** mutates state directly. It calls `POST /api/agent/propose`.
- A `proposals` row is created with `actor`, `action`, `payload`, `reasoning`, `confidence`, and `evidence_url`.
- You approve or reject on the **Agent Proposals** page (or auto-approve fires if the token is configured for it and confidence ≥ threshold).
- Approval applies the change and writes a row to the append-only `audit_log`.
- Every cost basis your agent fills in carries `basis_source`, `basis_evidence_url`, `basis_set_by` — so you and your accountant can trace where the number came from.

---

## API

Self-describing OpenAPI 3.1 spec at `/api/openapi.json`. The agent-relevant endpoints:

- `GET  /api/agent/work` — prioritized work queue
- `POST /api/agent/propose` — submit a proposal (idempotent via `idempotency_key`, supports `dry_run`)
- `GET  /api/proposals` — list proposals
- `POST /api/proposals/:id/approve` — apply
- `POST /api/proposals/:id/reject` — reject
- `GET  /api/audit` — append-only audit log
- `GET  /api/transactions/missing-basis` — every disposal lacking basis
- `GET  /api/export/json` — full structured dump

Agents authenticate with `Authorization: Bearer octt_...` tokens issued in Settings.

---

## Project layout

```
client/        React + Vite + Tailwind + Radix UI + wouter
server/        Express + Drizzle ORM
  agentRoutes.ts        agent + proposal + audit endpoints
  services/proposalApplier.ts  applies approved proposals
  auth/agentToken.ts    API-token auth middleware
  openapi.ts            self-describing OpenAPI spec
shared/schema.ts        Drizzle schema (single source of truth)
mcp/           Standalone MCP server that wraps the HTTP API
```

---

## Status

Working today: wallet aggregation (Alchemy + **Etherscan V2 fallback**), transaction sync, classification + custom rules, **FIFO/LIFO/HIFO/specific-ID** cost-basis matching, Form 8949/Schedule D CSV exports, **agent proposal workflow + audit log**, **MCP server**, **JSON export**, **OpenAPI spec**, **local-auth mode**, **generic CSV importer** (Coinbase/Kraken/Binance/Robinhood-shaped), **forgotten-wallet discovery + transfer-pair candidate detection**, **Vitest** tests for the math-critical pieces.

Planned (PRs welcome — see [CONTRIBUTING.md](CONTRIBUTING.md)):
- Wash-sale detection
- Native Solana / Bitcoin sync
- Per-exchange importer presets (auto-detect Coinbase header, etc.)
- More tests around the proposal applier and the agent token middleware

---

## Security

See [SECURITY.md](SECURITY.md). TL;DR: report vulnerabilities privately. Don't commit `.env`. API tokens are stored as SHA-256 hashes; the plain value is shown exactly once.

---

## License

[MIT](LICENSE).
