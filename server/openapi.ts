// Hand-written OpenAPI 3.1 spec. Kept intentionally small — the agent-facing
// endpoints are the focus. Update when adding new agent surfaces.

export const openApiSpec = {
  openapi: "3.1.0",
  info: {
    title: "Open Crypto Tax",
    version: "1.0.0",
    description:
      "Self-hosted, FOSS crypto tax aggregator. AI agents connect via API tokens, propose fixes (cost basis, classification), and a human approves. Every change is audited.",
    license: { name: "MIT" },
  },
  servers: [{ url: "/", description: "Self-hosted instance" }],
  components: {
    securitySchemes: {
      ApiToken: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "octt_*",
        description: "User-issued API token. Create one at /settings.",
      },
    },
    schemas: {
      Proposal: {
        type: "object",
        properties: {
          id: { type: "string" },
          actor: { type: "string" },
          action: { type: "string", enum: ["set_cost_basis", "classify_transaction", "link_transfer_pair", "merge_duplicate_txs", "create_tax_lot", "mark_reviewed"] },
          target_type: { type: "string" },
          target_id: { type: "string", nullable: true },
          payload: { type: "object", additionalProperties: true },
          reasoning: { type: "string", nullable: true },
          confidence: { type: "number", minimum: 0, maximum: 1, nullable: true },
          status: { type: "string", enum: ["pending", "approved", "rejected", "applied", "failed"] },
          created_at: { type: "string", format: "date-time" },
        },
      },
      Transaction: {
        type: "object",
        additionalProperties: true,
        properties: {
          id: { type: "string" },
          tx_hash: { type: "string" },
          chain: { type: "string" },
          timestamp: { type: "string", format: "date-time" },
          token_in_symbol: { type: "string", nullable: true },
          token_out_symbol: { type: "string", nullable: true },
          value_usd: { type: "string", nullable: true },
          classification: { type: "string", nullable: true },
          basis_source: { type: "string", nullable: true },
        },
      },
    },
  },
  security: [{ ApiToken: [] }],
  paths: {
    "/api/health": {
      get: { summary: "Health check", security: [], responses: { "200": { description: "OK" } } },
    },
    "/api/agent/work": {
      get: {
        summary: "Prioritized work queue for agents",
        description: "Returns transactions missing cost basis, transactions needing review, and pending proposals. The agent's main entry point.",
        responses: { "200": { description: "Work queue" } },
      },
    },
    "/api/agent/propose": {
      post: {
        summary: "Submit a proposed change",
        description: "Agents never mutate state directly — they propose. The user approves (or auto-approve fires for high-confidence proposals from trusted tokens).",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["action", "target_type"],
                properties: {
                  action: { type: "string", enum: ["set_cost_basis", "classify_transaction", "link_transfer_pair", "merge_duplicate_txs", "create_tax_lot", "mark_reviewed"] },
                  target_type: { type: "string" },
                  target_id: { type: "string" },
                  payload: { type: "object", additionalProperties: true },
                  reasoning: { type: "string" },
                  evidence_url: { type: "string", format: "uri" },
                  confidence: { type: "number", minimum: 0, maximum: 1 },
                  idempotency_key: { type: "string" },
                  dry_run: { type: "boolean" },
                },
              },
            },
          },
        },
        responses: { "201": { description: "Proposal queued (or applied if auto-approve fired)" } },
      },
    },
    "/api/proposals": {
      get: { summary: "List proposals", parameters: [{ name: "status", in: "query", schema: { type: "string" } }], responses: { "200": { description: "OK" } } },
    },
    "/api/proposals/{id}/approve": {
      post: { summary: "Approve and apply a pending proposal", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Applied" } } },
    },
    "/api/proposals/{id}/reject": {
      post: { summary: "Reject a pending proposal", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "Rejected" } } },
    },
    "/api/audit": {
      get: { summary: "Append-only audit log of every state change", responses: { "200": { description: "OK" } } },
    },
    "/api/transactions/missing-basis": {
      get: { summary: "Transactions where cost basis is unknown", responses: { "200": { description: "OK" } } },
    },
    "/api/wallets/suggestions": {
      get: {
        summary: "Discover potentially-forgotten wallets",
        description: "Analyzes counterparty addresses across the user's known transactions and ranks ones that look like wallets the user owns (bidirectional flow, multi-chain, repeated interaction). Each result has a 0..1 confidence score and human-readable reasons.",
        responses: { "200": { description: "Suggestions" } },
      },
    },
    "/api/wallets/suggestions/{address}/dismiss": {
      post: {
        summary: "Mark an address as not-yours so we stop suggesting it",
        parameters: [{ name: "address", in: "path", required: true, schema: { type: "string" } }],
        responses: { "204": { description: "Dismissed" } },
      },
    },
    "/api/transactions/transfer-pair-candidates": {
      get: {
        summary: "Unclassified transactions that look like self-transfers between two known wallets",
        responses: { "200": { description: "OK" } },
      },
    },
    "/api/export/json": {
      get: { summary: "Full structured export — wallets, transactions, lots, disposals, settings", responses: { "200": { description: "OK" } } },
    },
    "/api/import/csv": {
      post: {
        summary: "Import already-parsed CSV rows into a wallet",
        description: "Browser parses the CSV, server maps rows to transactions. Works with Coinbase / Kraken / Binance / Robinhood-shaped exports.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["wallet_id", "rows"],
                properties: {
                  wallet_id: { type: "string" },
                  rows: { type: "array", items: { type: "object", additionalProperties: { type: "string" } } },
                },
              },
            },
          },
        },
        responses: { "200": { description: "Import summary" } },
      },
    },
    "/api/transactions": {
      get: { summary: "List transactions (filterable)", responses: { "200": { description: "OK" } } },
    },
    "/api/wallets": {
      get: { summary: "List wallets", responses: { "200": { description: "OK" } } },
    },
    "/api/reports/summary": {
      get: { summary: "Tax-year summary (gains, losses, income)", parameters: [{ name: "year", in: "query", schema: { type: "integer" } }], responses: { "200": { description: "OK" } } },
    },
  },
} as const;
