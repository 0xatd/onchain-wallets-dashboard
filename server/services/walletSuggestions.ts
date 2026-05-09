/**
 * Wallet discovery — find addresses that look like forgotten wallets of yours.
 *
 * Heuristics on the user's existing transaction set:
 *   1. Counterparty appears across multiple of your transactions
 *   2. Bidirectional flow (you sent to AND received from them) is a stronger
 *      signal than one-way — pure incoming might be airdrops, pure outgoing
 *      might be a payment recipient.
 *   3. Significant USD volume implies "worth investigating".
 *   4. Skip addresses already in the user's wallet list, the null address,
 *      known DEX routers, and known token contracts.
 *
 * Returned scores are 0..1; higher = more likely to be your forgotten wallet.
 *
 * Transfer-pair candidates: pairs of unclassified transactions across the
 * user's already-known wallets where one is a send and the other is a
 * matching receive — strong "this is a self-transfer, mark accordingly"
 * signal. Used to clean up double-counted disposals.
 */
import type { Transaction, Wallet } from "../../shared/schema";

// Known router/aggregator addresses we never want to suggest as wallets.
// Populated lazily from alchemy.ts via static export.
const KNOWN_NON_WALLET_ADDRESSES = new Set<string>([
  "0x0000000000000000000000000000000000000000",
  "0x000000000000000000000000000000000000dead",
  // Uniswap / aggregators
  "0x7a250d5630b4cf539739df2c5dacb4c659f2488d",
  "0xe592427a0aece92de3edee1f18e0157c05861564",
  "0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45",
  "0xef1c6e67703c7bd7107eed8303fbe6ec2554bf6b",
  "0x1111111254eeb25477b68fb85ed929f73a960582",
  "0x1111111254fb6c44bac0bed2854e76f90643097d",
  "0xdef1c0ded9bec7f1a1670819833240f027b25eff",
  "0xd9e1ce17f2641f24ae83637ab66a2cca9c378b9f",
]);

export type WalletSuggestion = {
  address: string;
  chains: string[];
  txCount: number;
  sentToCount: number;       // # of times you sent to them
  receivedFromCount: number; // # of times they sent to you
  totalValueUsd: number;
  firstSeen: string;
  lastSeen: string;
  bidirectional: boolean;
  /** Heuristic confidence 0..1 that this is a forgotten wallet of yours. */
  score: number;
  /** Human-readable reasons fed to the agent so it can articulate the case. */
  reasons: string[];
  /** Sample transactions (ids) that include this counterparty. */
  sampleTxIds: string[];
};

function n(s: string | null | undefined): number {
  if (!s) return 0;
  const v = parseFloat(s);
  return isNaN(v) ? 0 : v;
}

export function suggestWallets(
  transactions: Transaction[],
  knownWallets: Wallet[],
): WalletSuggestion[] {
  const knownAddrs = new Set(knownWallets.map(w => w.address.toLowerCase()));
  const tokenContracts = new Set<string>();
  for (const tx of transactions) {
    if (tx.tokenIn) tokenContracts.add(tx.tokenIn.toLowerCase());
    if (tx.tokenOut) tokenContracts.add(tx.tokenOut.toLowerCase());
    if (tx.contractAddress) tokenContracts.add(tx.contractAddress.toLowerCase());
  }

  type Acc = {
    address: string;
    chains: Set<string>;
    txCount: number;
    sentTo: number;
    receivedFrom: number;
    totalValueUsd: number;
    firstSeen: Date;
    lastSeen: Date;
    sampleTxIds: string[];
  };
  const map = new Map<string, Acc>();

  for (const tx of transactions) {
    const cp = tx.counterpartyAddress?.toLowerCase();
    if (!cp) continue;
    if (knownAddrs.has(cp)) continue;
    if (KNOWN_NON_WALLET_ADDRESSES.has(cp)) continue;
    if (tokenContracts.has(cp)) continue; // ERC-20 contract, not a wallet

    const ts = tx.timestamp ? new Date(tx.timestamp) : new Date();
    const acc = map.get(cp) || {
      address: cp,
      chains: new Set<string>(),
      txCount: 0,
      sentTo: 0,
      receivedFrom: 0,
      totalValueUsd: 0,
      firstSeen: ts,
      lastSeen: ts,
      sampleTxIds: [],
    };
    acc.chains.add(tx.chain);
    acc.txCount += 1;
    acc.totalValueUsd += n(tx.valueUsd);
    if (ts < acc.firstSeen) acc.firstSeen = ts;
    if (ts > acc.lastSeen) acc.lastSeen = ts;
    if (acc.sampleTxIds.length < 5) acc.sampleTxIds.push(tx.id);
    // tokenOut populated => we sent something out
    if (tx.tokenOut || tx.tokenOutSymbol) acc.sentTo += 1;
    if (tx.tokenIn || tx.tokenInSymbol) acc.receivedFrom += 1;
    map.set(cp, acc);
  }

  const suggestions: WalletSuggestion[] = Array.from(map.values()).map(acc => {
    const reasons: string[] = [];
    let score = 0;

    // Volume signal — log-scaled so $10 doesn't equal $10k.
    const volSignal = Math.min(0.4, Math.log10(1 + acc.totalValueUsd) / 12);
    if (acc.totalValueUsd > 0) {
      reasons.push(`${acc.totalValueUsd.toFixed(2)} USD total flow`);
    }
    score += volSignal;

    // Frequency signal — multiple interactions implies relationship, not one-off.
    if (acc.txCount >= 2) {
      const freqSignal = Math.min(0.25, acc.txCount / 40);
      score += freqSignal;
      reasons.push(`${acc.txCount} transactions over ${chronoSpread(acc.firstSeen, acc.lastSeen)}`);
    }

    // Bidirectional signal — strongest single hint of self-ownership.
    const bidirectional = acc.sentTo > 0 && acc.receivedFrom > 0;
    if (bidirectional) {
      score += 0.3;
      reasons.push("bidirectional flow (you both sent to and received from this address)");
    } else if (acc.sentTo > 0) {
      reasons.push(`you sent ${acc.sentTo} time${acc.sentTo > 1 ? "s" : ""} to this address`);
    } else if (acc.receivedFrom > 0) {
      reasons.push(`you received ${acc.receivedFrom} time${acc.receivedFrom > 1 ? "s" : ""} from this address`);
    }

    // Multi-chain presence signal — same EOA on >1 chain is strong.
    if (acc.chains.size >= 2) {
      score += 0.15;
      reasons.push(`active on ${acc.chains.size} chains: ${Array.from(acc.chains).join(", ")}`);
    }

    score = Math.min(1, score);

    return {
      address: acc.address,
      chains: Array.from(acc.chains),
      txCount: acc.txCount,
      sentToCount: acc.sentTo,
      receivedFromCount: acc.receivedFrom,
      totalValueUsd: Number(acc.totalValueUsd.toFixed(2)),
      firstSeen: acc.firstSeen.toISOString(),
      lastSeen: acc.lastSeen.toISOString(),
      bidirectional,
      score: Number(score.toFixed(3)),
      reasons,
      sampleTxIds: acc.sampleTxIds,
    };
  });

  // Filter out one-off, one-direction interactions — those are payment
  // recipients, not forgotten wallets. A real forgotten-wallet candidate
  // either has bidirectional flow, multiple interactions, or significant
  // volume.
  const filtered = suggestions.filter(s =>
    s.bidirectional ||
    s.txCount >= 3 ||
    (s.txCount >= 2 && s.score >= 0.2) ||
    s.totalValueUsd >= 5000,
  );

  filtered.sort((a, b) => b.score - a.score);
  return filtered;
}

function chronoSpread(a: Date, b: Date): string {
  const days = Math.max(1, Math.round((b.getTime() - a.getTime()) / 86400_000));
  if (days < 31) return `${days} days`;
  if (days < 365) return `${Math.round(days / 30)} months`;
  return `${(days / 365).toFixed(1)} years`;
}

// ---------- Transfer-pair candidates ----------

export type TransferPairCandidate = {
  outTxId: string;
  inTxId: string;
  symbol: string;
  amount: string;
  outWalletId: string | null;
  inWalletId: string | null;
  timeDeltaSeconds: number;
  confidence: number;
};

/**
 * Find pairs of unclassified transactions across the user's wallets that
 * look like a self-transfer: one wallet sends X tokens, another wallet
 * receives ~the same amount within a short window.
 *
 * Pure: takes the user's transaction list and emits candidate pairs.
 */
export function findTransferPairCandidates(
  transactions: Transaction[],
  opts: { windowSeconds?: number; tolerance?: number } = {},
): TransferPairCandidate[] {
  const windowSeconds = opts.windowSeconds ?? 60 * 30; // 30min default
  const tolerance = opts.tolerance ?? 0.005; // 0.5% — covers gas-on-bridge slippage
  const candidates: TransferPairCandidate[] = [];

  const sends = transactions.filter(t =>
    t.tokenOutSymbol && t.tokenOutAmount && (t.classification === "unknown" || t.classification === null) && !t.userClassified
  );
  const receives = transactions.filter(t =>
    t.tokenInSymbol && t.tokenInAmount && (t.classification === "unknown" || t.classification === null) && !t.userClassified
  );

  for (const out of sends) {
    const outAmount = n(out.tokenOutAmount);
    if (outAmount <= 0) continue;
    const outTime = new Date(out.timestamp).getTime();

    for (const incoming of receives) {
      if (incoming.id === out.id) continue;
      if (incoming.walletId === out.walletId) continue;
      if (incoming.tokenInSymbol !== out.tokenOutSymbol) continue;

      const inAmount = n(incoming.tokenInAmount);
      const diff = Math.abs(inAmount - outAmount) / outAmount;
      if (diff > tolerance) continue;

      const inTime = new Date(incoming.timestamp).getTime();
      const dt = Math.abs(inTime - outTime) / 1000;
      if (dt > windowSeconds) continue;

      // Confidence based on tightness of match.
      const amountMatch = 1 - Math.min(1, diff / tolerance);
      const timeMatch = 1 - Math.min(1, dt / windowSeconds);
      const confidence = Number(((amountMatch * 0.6) + (timeMatch * 0.4)).toFixed(3));

      candidates.push({
        outTxId: out.id,
        inTxId: incoming.id,
        symbol: out.tokenOutSymbol!,
        amount: out.tokenOutAmount!,
        outWalletId: out.walletId,
        inWalletId: incoming.walletId,
        timeDeltaSeconds: Math.round(dt),
        confidence,
      });
    }
  }

  candidates.sort((a, b) => b.confidence - a.confidence);
  return candidates;
}
