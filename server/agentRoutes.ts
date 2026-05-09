import type { Express, Request, Response } from "express";
import { z } from "zod";
import { storage } from "./storage";
import { isAuthenticated } from "./auth";
import { requireApiToken, generateApiToken } from "./auth/agentToken";
import { applyProposal } from "./services/proposalApplier";
import { PROPOSAL_ACTIONS, API_TOKEN_SCOPES } from "../shared/schema";

const getUserId = (req: any): string => req.user?.claims?.sub;

// Proposals from agents are accepted on this schema. We're permissive on
// payload (jsonb) since action handlers validate their own shapes.
const proposalSchema = z.object({
  action: z.enum(PROPOSAL_ACTIONS),
  target_type: z.string().min(1),
  target_id: z.string().optional(),
  payload: z.record(z.any()).default({}),
  reasoning: z.string().optional(),
  evidence_url: z.string().url().optional(),
  confidence: z.number().min(0).max(1).optional(),
  idempotency_key: z.string().optional(),
  dry_run: z.boolean().optional(),
});

export function registerAgentRoutes(app: Express) {
  // ---------- API token management (requires session/Firebase auth) ----------
  app.get("/api/agent/tokens", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const tokens = await storage.listApiTokens(userId);
      // Never return token hashes.
      res.json(tokens.map(t => ({
        id: t.id,
        name: t.name,
        prefix: t.tokenPrefix,
        scopes: t.scopes,
        autoApprove: t.autoApprove,
        autoApproveThreshold: t.autoApproveThreshold,
        createdAt: t.createdAt,
        lastUsedAt: t.lastUsedAt,
        expiresAt: t.expiresAt,
        revokedAt: t.revokedAt,
      })));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to list tokens" });
    }
  });

  app.post("/api/agent/tokens", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const body = z.object({
        name: z.string().min(1).max(100),
        scopes: z.array(z.enum(API_TOKEN_SCOPES)).default(["read"]),
        autoApprove: z.boolean().optional(),
        autoApproveThreshold: z.number().min(0).max(1).optional(),
        expiresInDays: z.number().int().positive().max(3650).optional(),
      }).parse(req.body);

      const { plain, hash, prefix } = generateApiToken();
      const expiresAt = body.expiresInDays
        ? new Date(Date.now() + body.expiresInDays * 86400_000)
        : undefined;

      const token = await storage.createApiToken(userId, body.name, hash, prefix, body.scopes, {
        autoApprove: body.autoApprove,
        autoApproveThreshold: body.autoApproveThreshold !== undefined ? String(body.autoApproveThreshold) : undefined,
        expiresAt,
      });
      // IMPORTANT: return plain token ONCE.
      res.status(201).json({
        id: token.id,
        name: token.name,
        token: plain,
        prefix: token.tokenPrefix,
        scopes: token.scopes,
        warning: "Store this token now. It will not be shown again.",
      });
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ error: "Invalid input", details: err.errors });
      console.error(err);
      res.status(500).json({ error: "Failed to create token" });
    }
  });

  app.delete("/api/agent/tokens/:id", isAuthenticated, async (req, res) => {
    try {
      await storage.revokeApiToken(req.params.id as string, getUserId(req));
      res.status(204).send();
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to revoke token" });
    }
  });

  // ---------- Agent endpoints (accept either session OR API token) ----------
  // We use isAuthenticated, which already accepts octt_* tokens.

  // Prioritized work queue for agents.
  app.get("/api/agent/work", isAuthenticated, async (req, res) => {
    try {
      const work = await storage.getAgentWork(getUserId(req));
      res.json(work);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to fetch agent work" });
    }
  });

  // Submit a proposal. If the actor is an API token with auto-approve and
  // confidence meets threshold, it's applied immediately. Otherwise queued.
  app.post("/api/agent/propose", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const parsed = proposalSchema.parse(req.body);
      const apiToken = (req as any).apiToken as { id: string; name: string; autoApprove?: boolean; autoApproveThreshold?: string | null } | undefined;

      const actor = apiToken ? `agent:${apiToken.name}` : `user:${userId}`;
      const actorType = apiToken ? "agent" : "user";

      // Idempotency: return prior proposal if one exists for this key.
      if (parsed.idempotency_key) {
        const existing = await storage.getProposalByIdempotencyKey(userId, parsed.idempotency_key);
        if (existing) return res.status(200).json({ proposal: existing, idempotent: true });
      }

      // Dry run — just validate & echo.
      if (parsed.dry_run) {
        return res.json({
          dry_run: true,
          would_create: {
            action: parsed.action,
            target_type: parsed.target_type,
            target_id: parsed.target_id,
            payload: parsed.payload,
            actor,
          },
        });
      }

      const proposal = await storage.createProposal({
        userId,
        actor,
        actorType,
        action: parsed.action,
        targetType: parsed.target_type,
        targetId: parsed.target_id,
        payload: parsed.payload as any,
        reasoning: parsed.reasoning,
        evidenceUrl: parsed.evidence_url,
        confidence: parsed.confidence !== undefined ? String(parsed.confidence) : undefined,
        idempotencyKey: parsed.idempotency_key,
        status: "pending",
      } as any);

      // Auto-approve path.
      const threshold = apiToken?.autoApproveThreshold ? Number(apiToken.autoApproveThreshold) : null;
      const conf = parsed.confidence ?? null;
      const eligible =
        apiToken?.autoApprove === true &&
        threshold !== null &&
        conf !== null &&
        conf >= threshold;

      if (eligible) {
        const result = await applyProposal(proposal);
        const updated = await storage.updateProposalStatus(proposal.id, userId, {
          status: result.ok ? "applied" : "failed",
          decidedBy: actor,
          decidedAt: new Date(),
          appliedAt: result.ok ? new Date() : undefined,
          errorMessage: result.ok ? null : result.error,
        } as any);
        return res.status(201).json({ proposal: updated, applied: result.ok, error: result.ok ? undefined : result.error });
      }

      res.status(201).json({ proposal, applied: false });
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ error: "Invalid proposal", details: err.errors });
      console.error(err);
      res.status(500).json({ error: "Failed to submit proposal" });
    }
  });

  app.get("/api/proposals", isAuthenticated, async (req, res) => {
    try {
      const status = (req.query.status as string) || undefined;
      const list = await storage.listProposals(getUserId(req), status);
      res.json(list);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to list proposals" });
    }
  });

  app.post("/api/proposals/:id/approve", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const p = await storage.getProposal(req.params.id as string, userId);
      if (!p) return res.status(404).json({ error: "Not found" });
      if (p.status !== "pending") return res.status(409).json({ error: `Proposal is ${p.status}` });

      const result = await applyProposal(p);
      const updated = await storage.updateProposalStatus(p.id, userId, {
        status: result.ok ? "applied" : "failed",
        decidedBy: `user:${userId}`,
        decidedAt: new Date(),
        appliedAt: result.ok ? new Date() : undefined,
        errorMessage: result.ok ? null : result.error,
      } as any);
      res.json({ proposal: updated, applied: result.ok, error: result.ok ? undefined : result.error });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to approve proposal" });
    }
  });

  app.post("/api/proposals/:id/reject", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const updated = await storage.updateProposalStatus(req.params.id as string, userId, {
        status: "rejected",
        decidedBy: `user:${userId}`,
        decidedAt: new Date(),
      } as any);
      if (!updated) return res.status(404).json({ error: "Not found" });
      res.json(updated);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to reject proposal" });
    }
  });

  app.get("/api/audit", isAuthenticated, async (req, res) => {
    try {
      const limit = Math.min(parseInt((req.query.limit as string) || "200", 10), 1000);
      const log = await storage.listAudit(getUserId(req), limit);
      res.json(log);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to read audit log" });
    }
  });

  // Missing-cost-basis endpoint — the headline workflow.
  app.get("/api/transactions/missing-basis", isAuthenticated, async (req, res) => {
    try {
      const limit = Math.min(parseInt((req.query.limit as string) || "100", 10), 500);
      const txs = await storage.getTransactionsMissingBasis(getUserId(req), limit);
      res.json(txs);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to fetch missing-basis transactions" });
    }
  });

  // CSV import — accepts already-parsed rows and a target wallet id.
  app.post("/api/import/csv", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const body = z.object({
        wallet_id: z.string(),
        rows: z.array(z.record(z.string())).min(1),
      }).parse(req.body);

      const wallet = await storage.getWallet(body.wallet_id, userId);
      if (!wallet) return res.status(404).json({ error: "Wallet not found" });

      const { rowsToTransactions } = await import("./services/csvImporter");
      const { transactions, summary } = rowsToTransactions(body.rows, wallet.id, wallet.chain);

      let imported = 0;
      let dupes = 0;
      for (const tx of transactions) {
        const existing = await storage.getTransactionByHash(tx.txHash, userId);
        if (existing) { dupes++; continue; }
        await storage.createTransaction(tx);
        imported++;
      }
      await storage.appendAudit({
        userId,
        actor: `user:${userId}`,
        action: "csv_import",
        targetType: "wallet",
        targetId: wallet.id,
        before: null,
        after: { imported, dupes, summary } as any,
        metadata: { rowCount: body.rows.length },
      });
      res.json({ imported, duplicates: dupes, skipped: summary.skipped, errors: summary.errors });
    } catch (err: any) {
      if (err instanceof z.ZodError) return res.status(400).json({ error: "Invalid CSV import body", details: err.errors });
      console.error(err);
      res.status(500).json({ error: "CSV import failed" });
    }
  });

  // Structured JSON export of everything an agent might need.
  app.get("/api/export/json", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const year = req.query.year ? parseInt(req.query.year as string, 10) : undefined;
      const [wallets, txs, lots, settings] = await Promise.all([
        storage.getWallets(userId),
        storage.getTransactions({ userId }),
        storage.getTaxLots(),
        storage.getSettings(userId),
      ]);
      const disposalsList = await storage.getDisposals(year, userId);
      const userLotIds = new Set(lots.filter(l => wallets.some(w => w.id === l.walletId)).map(l => l.id));
      res.json({
        version: "1.0",
        generated_at: new Date().toISOString(),
        settings,
        wallets,
        transactions: txs,
        tax_lots: lots.filter(l => userLotIds.has(l.id)),
        disposals: disposalsList,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to export" });
    }
  });
}
