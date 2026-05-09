/**
 * Cost-basis lot matching.
 *
 * Pure functions over arrays of lots and disposal events. The storage layer
 * passes in the user's lots; we return:
 *   - disposal records to insert
 *   - lot updates (remainingAmount decreases)
 *
 * Methods supported:
 *   fifo         oldest acquisition first
 *   lifo         newest acquisition first
 *   hifo         highest cost basis per unit first (minimizes gain)
 *   specific_id  caller supplies an explicit lot order
 *
 * Long-term threshold: held > 365 days. Day-of-acquisition counts as held.
 */
import type { LotMethod } from "../../shared/schema";

export type LotInput = {
  id: string;
  acquiredAt: Date;
  amount: string;          // total acquired
  remainingAmount: string; // unconsumed
  costBasisUsd: string;    // total basis for `amount`
};

export type DisposalInput = {
  transactionId: string | null;
  token: string;
  tokenSymbol: string;
  amount: string;          // disposed quantity
  proceedsUsd: string;     // total proceeds
  disposedAt: Date;
};

export type DisposalRecord = {
  taxLotId: string;
  transactionId: string | null;
  token: string;
  tokenSymbol: string;
  amount: string;
  proceedsUsd: string;
  costBasisUsd: string;
  gainLossUsd: string;
  isShortTerm: boolean;
  disposedAt: Date;
};

export type LotUpdate = {
  id: string;
  newRemainingAmount: string;
};

export type MatchResult = {
  disposals: DisposalRecord[];
  lotUpdates: LotUpdate[];
  unmatched: string; // amount we couldn't cover (string decimal)
};

const DAY_MS = 24 * 60 * 60 * 1000;
const LONG_TERM_DAYS = 365;

function n(s: string): number { return parseFloat(s); }
function fix(x: number, dp = 18): string { return x.toFixed(dp).replace(/\.?0+$/, "") || "0"; }
function money(x: number): string { return x.toFixed(2); }

function orderLots(lots: LotInput[], method: LotMethod, specificOrder?: string[]): LotInput[] {
  const usable = lots.filter(l => n(l.remainingAmount) > 0);
  switch (method) {
    case "fifo":
      return usable.sort((a, b) => a.acquiredAt.getTime() - b.acquiredAt.getTime());
    case "lifo":
      return usable.sort((a, b) => b.acquiredAt.getTime() - a.acquiredAt.getTime());
    case "hifo": {
      const perUnit = (l: LotInput) => n(l.costBasisUsd) / n(l.amount);
      return usable.sort((a, b) => perUnit(b) - perUnit(a));
    }
    case "specific_id": {
      if (!specificOrder?.length) return usable;
      const idx = new Map(specificOrder.map((id, i) => [id, i] as const));
      return usable.sort((a, b) => (idx.get(a.id) ?? 1e9) - (idx.get(b.id) ?? 1e9));
    }
  }
}

/**
 * Match a single disposal against a pool of lots. The caller is responsible
 * for filtering lots to the same token first.
 */
export function matchDisposal(
  lots: LotInput[],
  disposal: DisposalInput,
  method: LotMethod,
  specificOrder?: string[],
): MatchResult {
  const ordered = orderLots(lots, method, specificOrder);
  let remaining = n(disposal.amount);
  if (remaining <= 0) return { disposals: [], lotUpdates: [], unmatched: "0" };

  const totalProceeds = n(disposal.proceedsUsd);
  const totalAmount = n(disposal.amount);
  // Per-unit proceeds, used to allocate proceeds across multiple lots.
  const proceedsPerUnit = totalAmount > 0 ? totalProceeds / totalAmount : 0;

  const disposals: DisposalRecord[] = [];
  const updates: LotUpdate[] = [];

  for (const lot of ordered) {
    if (remaining <= 0) break;
    const lotRemaining = n(lot.remainingAmount);
    if (lotRemaining <= 0) continue;

    const consume = Math.min(lotRemaining, remaining);
    const lotTotal = n(lot.amount);
    const basisPerUnit = lotTotal > 0 ? n(lot.costBasisUsd) / lotTotal : 0;

    const consumedBasis = basisPerUnit * consume;
    const consumedProceeds = proceedsPerUnit * consume;
    const gainLoss = consumedProceeds - consumedBasis;
    const heldDays = (disposal.disposedAt.getTime() - lot.acquiredAt.getTime()) / DAY_MS;
    const isShortTerm = heldDays <= LONG_TERM_DAYS;

    disposals.push({
      taxLotId: lot.id,
      transactionId: disposal.transactionId,
      token: disposal.token,
      tokenSymbol: disposal.tokenSymbol,
      amount: fix(consume),
      proceedsUsd: money(consumedProceeds),
      costBasisUsd: money(consumedBasis),
      gainLossUsd: money(gainLoss),
      isShortTerm,
      disposedAt: disposal.disposedAt,
    });

    updates.push({ id: lot.id, newRemainingAmount: fix(lotRemaining - consume) });
    remaining -= consume;
  }

  return {
    disposals,
    lotUpdates: updates,
    unmatched: remaining > 0 ? fix(remaining) : "0",
  };
}
