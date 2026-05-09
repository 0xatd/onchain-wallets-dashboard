#!/usr/bin/env node
/**
 * Open Crypto Tax — MCP server.
 *
 * Wraps the HTTP API so AI agents (Claude Desktop, Claude Code, etc.) can:
 *   • list wallets and transactions
 *   • find transactions missing cost basis
 *   • propose fixes (cost basis, classification, transfer pairing) that the
 *     human approves in-app before anything mutates.
 *
 * Configure with env:
 *   OPEN_CRYPTO_TAX_URL    e.g. https://localhost:5000  (no trailing slash)
 *   OPEN_CRYPTO_TAX_TOKEN  the octt_* token issued from the Settings page
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const BASE_URL = (process.env.OPEN_CRYPTO_TAX_URL || "http://localhost:5000").replace(/\/$/, "");
const TOKEN = process.env.OPEN_CRYPTO_TAX_TOKEN;

if (!TOKEN) {
  console.error("[open-crypto-tax-mcp] OPEN_CRYPTO_TAX_TOKEN env var is required.");
  process.exit(1);
}

async function api(path: string, init: RequestInit = {}): Promise<any> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      "Authorization": `Bearer ${TOKEN}`,
      "Content-Type": "application/json",
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let body: any;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${path}: ${typeof body === "string" ? body : JSON.stringify(body)}`);
  }
  return body;
}

const tools = [
  {
    name: "get_work_queue",
    description: "Get the prioritized list of things that need an agent's attention: missing cost basis, transactions needing review, pending proposals.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_wallets",
    description: "List all wallets the user has connected.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_transactions",
    description: "List transactions, with optional filters.",
    inputSchema: {
      type: "object",
      properties: {
        chain: { type: "string", description: "Chain filter (e.g. ethereum)" },
        classification: { type: "string", description: "Classification filter (e.g. swap, airdrop)" },
        needs_review: { type: "boolean" },
      },
    },
  },
  {
    name: "list_missing_basis",
    description: "List transactions with disposals where cost basis is unknown — your primary work item.",
    inputSchema: {
      type: "object",
      properties: { limit: { type: "integer", minimum: 1, maximum: 500 } },
    },
  },
  {
    name: "propose_cost_basis",
    description: "Propose a cost basis (USD) for a specific transaction. Requires evidence (URL or notes). The proposal is queued for the user to approve.",
    inputSchema: {
      type: "object",
      required: ["transaction_id", "cost_basis_usd", "reasoning"],
      properties: {
        transaction_id: { type: "string" },
        cost_basis_usd: { type: "number" },
        reasoning: { type: "string", description: "Why this number — e.g. 'Coinbase historical price for ETH on 2023-04-15'" },
        evidence_url: { type: "string", description: "Link to the source (Etherscan, CoinGecko, exchange CSV row, etc.)" },
        confidence: { type: "number", minimum: 0, maximum: 1 },
        idempotency_key: { type: "string" },
      },
    },
  },
  {
    name: "propose_classification",
    description: "Propose a classification (swap, airdrop, stake, etc.) for a transaction.",
    inputSchema: {
      type: "object",
      required: ["transaction_id", "classification", "reasoning"],
      properties: {
        transaction_id: { type: "string" },
        classification: { type: "string" },
        reasoning: { type: "string" },
        confidence: { type: "number", minimum: 0, maximum: 1 },
        idempotency_key: { type: "string" },
      },
    },
  },
  {
    name: "propose_transfer_pair",
    description: "Mark two transactions as a self-transfer pair (out from wallet A → in to wallet B). Both legs become non-taxable.",
    inputSchema: {
      type: "object",
      required: ["out_tx_id", "in_tx_id", "reasoning"],
      properties: {
        out_tx_id: { type: "string" },
        in_tx_id: { type: "string" },
        reasoning: { type: "string" },
        confidence: { type: "number", minimum: 0, maximum: 1 },
      },
    },
  },
  {
    name: "list_proposals",
    description: "List proposals (defaults to pending).",
    inputSchema: {
      type: "object",
      properties: { status: { type: "string", enum: ["pending", "applied", "rejected", "failed", "approved"] } },
    },
  },
  {
    name: "get_audit_log",
    description: "Read the append-only audit log of every state change.",
    inputSchema: { type: "object", properties: { limit: { type: "integer" } } },
  },
  {
    name: "get_tax_report",
    description: "Get the tax-year summary (gains, losses, income).",
    inputSchema: {
      type: "object",
      properties: { year: { type: "integer" } },
    },
  },
  {
    name: "export_all",
    description: "Export everything (wallets, transactions, lots, disposals) as JSON. Use this to load the full dataset into context.",
    inputSchema: { type: "object", properties: { year: { type: "integer" } } },
  },
];

const server = new Server(
  { name: "open-crypto-tax", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args = {} } = req.params;
  const a = args as Record<string, any>;

  const respond = (data: unknown) => ({
    content: [{ type: "text", text: typeof data === "string" ? data : JSON.stringify(data, null, 2) }],
  });

  try {
    switch (name) {
      case "get_work_queue":
        return respond(await api("/api/agent/work"));

      case "list_wallets":
        return respond(await api("/api/wallets"));

      case "list_transactions": {
        const qs = new URLSearchParams();
        if (a.chain) qs.set("chain", a.chain);
        if (a.classification) qs.set("classification", a.classification);
        if (a.needs_review) qs.set("needsReview", "true");
        const q = qs.toString() ? `?${qs}` : "";
        return respond(await api(`/api/transactions${q}`));
      }

      case "list_missing_basis": {
        const q = a.limit ? `?limit=${a.limit}` : "";
        return respond(await api(`/api/transactions/missing-basis${q}`));
      }

      case "propose_cost_basis":
        return respond(await api("/api/agent/propose", {
          method: "POST",
          body: JSON.stringify({
            action: "set_cost_basis",
            target_type: "transaction",
            target_id: a.transaction_id,
            payload: { cost_basis_usd: a.cost_basis_usd, evidence_url: a.evidence_url },
            reasoning: a.reasoning,
            evidence_url: a.evidence_url,
            confidence: a.confidence,
            idempotency_key: a.idempotency_key,
          }),
        }));

      case "propose_classification":
        return respond(await api("/api/agent/propose", {
          method: "POST",
          body: JSON.stringify({
            action: "classify_transaction",
            target_type: "transaction",
            target_id: a.transaction_id,
            payload: { classification: a.classification },
            reasoning: a.reasoning,
            confidence: a.confidence,
            idempotency_key: a.idempotency_key,
          }),
        }));

      case "propose_transfer_pair":
        return respond(await api("/api/agent/propose", {
          method: "POST",
          body: JSON.stringify({
            action: "link_transfer_pair",
            target_type: "transaction",
            payload: { out_tx_id: a.out_tx_id, in_tx_id: a.in_tx_id },
            reasoning: a.reasoning,
            confidence: a.confidence,
          }),
        }));

      case "list_proposals": {
        const q = a.status ? `?status=${a.status}` : "?status=pending";
        return respond(await api(`/api/proposals${q}`));
      }

      case "get_audit_log": {
        const q = a.limit ? `?limit=${a.limit}` : "";
        return respond(await api(`/api/audit${q}`));
      }

      case "get_tax_report": {
        const q = a.year ? `?year=${a.year}` : "";
        return respond(await api(`/api/reports/summary${q}`));
      }

      case "export_all": {
        const q = a.year ? `?year=${a.year}` : "";
        return respond(await api(`/api/export/json${q}`));
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (err: any) {
    return {
      isError: true,
      content: [{ type: "text", text: `Error: ${err.message || String(err)}` }],
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`[open-crypto-tax-mcp] connected to ${BASE_URL}`);
