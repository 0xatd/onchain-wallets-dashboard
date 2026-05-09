import { storage } from "../storage";
import type { Proposal } from "../../shared/schema";

export class ProposalApplyError extends Error {
  constructor(message: string) { super(message); }
}

/**
 * Apply an approved proposal. Wraps the actual mutation and writes an audit
 * log entry capturing before/after state. Idempotency is enforced by the
 * caller (status check + `idempotency_key` on the proposal row).
 */
export async function applyProposal(p: Proposal): Promise<{ ok: true; result: any } | { ok: false; error: string }> {
  const payload = (p.payload || {}) as Record<string, any>;

  try {
    switch (p.action) {
      case "set_cost_basis": {
        if (p.targetType !== "transaction" || !p.targetId) {
          throw new ProposalApplyError("set_cost_basis requires targetType=transaction and targetId");
        }
        const before = await storage.getTransaction(p.targetId, p.userId);
        if (!before) throw new ProposalApplyError("Transaction not found");
        const valueUsd = String(payload.cost_basis_usd ?? payload.value_usd ?? "");
        if (!valueUsd) throw new ProposalApplyError("payload.cost_basis_usd required");
        const updated = await storage.updateTransaction(p.targetId, {
          valueUsd,
          basisSource: payload.source ?? p.actor,
          basisEvidenceUrl: payload.evidence_url ?? p.evidenceUrl ?? undefined,
          basisSetBy: p.actor,
          basisSetAt: new Date(),
          basisNotes: payload.notes ?? p.reasoning ?? undefined,
        } as any);
        await storage.appendAudit({
          userId: p.userId,
          actor: p.actor,
          action: "set_cost_basis",
          targetType: "transaction",
          targetId: p.targetId,
          before: before as any,
          after: updated as any,
          metadata: { proposalId: p.id, confidence: p.confidence },
        });
        return { ok: true, result: updated };
      }

      case "classify_transaction": {
        if (p.targetType !== "transaction" || !p.targetId) {
          throw new ProposalApplyError("classify_transaction requires targetType=transaction and targetId");
        }
        const classification = String(payload.classification || "");
        if (!classification) throw new ProposalApplyError("payload.classification required");
        const before = await storage.getTransaction(p.targetId, p.userId);
        const updated = await storage.classifyTransaction(p.targetId, classification, p.userId);
        if (!updated) throw new ProposalApplyError("Transaction not found");
        await storage.appendAudit({
          userId: p.userId,
          actor: p.actor,
          action: "classify_transaction",
          targetType: "transaction",
          targetId: p.targetId,
          before: before as any,
          after: updated as any,
          metadata: { proposalId: p.id, confidence: p.confidence, reasoning: p.reasoning },
        });
        return { ok: true, result: updated };
      }

      case "mark_reviewed": {
        if (p.targetType !== "transaction" || !p.targetId) {
          throw new ProposalApplyError("mark_reviewed requires targetType=transaction and targetId");
        }
        const before = await storage.getTransaction(p.targetId, p.userId);
        if (!before) throw new ProposalApplyError("Transaction not found");
        const updated = await storage.updateTransaction(p.targetId, { needsReview: false } as any);
        await storage.appendAudit({
          userId: p.userId,
          actor: p.actor,
          action: "mark_reviewed",
          targetType: "transaction",
          targetId: p.targetId,
          before: before as any,
          after: updated as any,
          metadata: { proposalId: p.id },
        });
        return { ok: true, result: updated };
      }

      case "link_transfer_pair": {
        // Mark both legs as self_transfer; useful when an agent identifies
        // an outgoing tx on wallet A pairs with an incoming tx on wallet B.
        const outId = String(payload.out_tx_id || "");
        const inId = String(payload.in_tx_id || "");
        if (!outId || !inId) throw new ProposalApplyError("payload.out_tx_id and payload.in_tx_id required");
        const out = await storage.getTransaction(outId, p.userId);
        const incoming = await storage.getTransaction(inId, p.userId);
        if (!out || !incoming) throw new ProposalApplyError("One or both transactions not found");
        await storage.classifyTransaction(outId, "self_transfer", p.userId);
        await storage.classifyTransaction(inId, "self_transfer", p.userId);
        await storage.appendAudit({
          userId: p.userId,
          actor: p.actor,
          action: "link_transfer_pair",
          targetType: "transaction",
          targetId: outId,
          before: { out, in: incoming } as any,
          after: null,
          metadata: { proposalId: p.id, pairedWith: inId },
        });
        return { ok: true, result: { outId, inId } };
      }

      case "create_tax_lot": {
        const lot = await storage.createTaxLot({
          walletId: payload.wallet_id,
          transactionId: payload.transaction_id,
          token: payload.token,
          tokenSymbol: payload.token_symbol,
          amount: String(payload.amount),
          remainingAmount: String(payload.remaining_amount ?? payload.amount),
          costBasisUsd: String(payload.cost_basis_usd),
          acquiredAt: new Date(payload.acquired_at),
        } as any);
        await storage.appendAudit({
          userId: p.userId,
          actor: p.actor,
          action: "create_tax_lot",
          targetType: "tax_lot",
          targetId: lot.id,
          before: null,
          after: lot as any,
          metadata: { proposalId: p.id },
        });
        return { ok: true, result: lot };
      }

      case "merge_duplicate_txs": {
        // Soft handling — just flag the duplicate as spam to keep it out of reports.
        const keepId = String(payload.keep_tx_id || "");
        const dropId = String(payload.drop_tx_id || "");
        if (!keepId || !dropId) throw new ProposalApplyError("payload.keep_tx_id and payload.drop_tx_id required");
        const before = await storage.getTransaction(dropId, p.userId);
        if (!before) throw new ProposalApplyError("drop transaction not found");
        const updated = await storage.updateTransaction(dropId, { isSpam: true } as any);
        await storage.appendAudit({
          userId: p.userId,
          actor: p.actor,
          action: "merge_duplicate_txs",
          targetType: "transaction",
          targetId: dropId,
          before: before as any,
          after: updated as any,
          metadata: { proposalId: p.id, mergedInto: keepId },
        });
        return { ok: true, result: { keepId, dropId } };
      }

      default:
        throw new ProposalApplyError(`Unknown proposal action: ${p.action}`);
    }
  } catch (err: any) {
    return { ok: false, error: err.message || String(err) };
  }
}
