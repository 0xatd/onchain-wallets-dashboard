import { describe, it, expect } from "vitest";
import { suggestWallets, findTransferPairCandidates } from "../walletSuggestions";
import type { Transaction, Wallet } from "../../../shared/schema";

const wallet = (overrides: Partial<Wallet> = {}): Wallet => ({
  id: overrides.id || "w1",
  userId: "u1",
  address: overrides.address || "0xme",
  chain: overrides.chain || "ethereum",
  label: null,
  entityType: "personal",
  isActive: true,
  createdAt: new Date(),
} as Wallet);

const tx = (overrides: Partial<Transaction> = {}): Transaction => ({
  id: overrides.id || "t" + Math.random(),
  walletId: overrides.walletId || "w1",
  txHash: overrides.txHash || ("0x" + Math.random().toString(16).slice(2)),
  chain: overrides.chain || "ethereum",
  timestamp: overrides.timestamp || new Date("2024-01-01"),
  blockNumber: 1,
  tokenIn: null,
  tokenInAmount: null,
  tokenInSymbol: null,
  tokenOut: null,
  tokenOutAmount: null,
  tokenOutSymbol: null,
  classification: "unknown",
  classificationConfidence: null,
  needsReview: false,
  userClassified: false,
  contractAddress: null,
  methodName: null,
  counterpartyAddress: null,
  basisSource: null,
  basisEvidenceUrl: null,
  basisSetBy: null,
  basisSetAt: null,
  basisNotes: null,
  gasFee: null,
  gasFeeUsd: null,
  priceAtTime: null,
  valueUsd: null,
  isSpam: false,
  isDust: false,
  createdAt: new Date(),
  ...overrides,
} as Transaction);

describe("suggestWallets", () => {
  it("ranks bidirectional, repeated counterparties higher than one-offs", () => {
    const wallets = [wallet({ address: "0xme" })];
    const txs: Transaction[] = [
      // Bidirectional with 0xforgot — 5 interactions, $5k each
      tx({ counterpartyAddress: "0xforgot", tokenOutSymbol: "ETH", tokenOutAmount: "1", valueUsd: "5000" }),
      tx({ counterpartyAddress: "0xforgot", tokenInSymbol: "ETH", tokenInAmount: "1", valueUsd: "5000" }),
      tx({ counterpartyAddress: "0xforgot", tokenOutSymbol: "USDC", tokenOutAmount: "100", valueUsd: "100" }),
      tx({ counterpartyAddress: "0xforgot", tokenInSymbol: "USDC", tokenInAmount: "100", valueUsd: "100" }),
      tx({ counterpartyAddress: "0xforgot", tokenOutSymbol: "ETH", tokenOutAmount: "0.5", valueUsd: "1500" }),
      // One-off send to 0xrecipient
      tx({ counterpartyAddress: "0xrecipient", tokenOutSymbol: "ETH", tokenOutAmount: "0.1", valueUsd: "300" }),
    ];
    const suggestions = suggestWallets(txs, wallets);
    expect(suggestions.length).toBeGreaterThanOrEqual(1);
    expect(suggestions[0].address).toBe("0xforgot");
    expect(suggestions[0].bidirectional).toBe(true);
    expect(suggestions[0].score).toBeGreaterThan(0.4);
    // 0xrecipient should be filtered out (one-off, no bidirectional, low score)
    const recipient = suggestions.find(s => s.address === "0xrecipient");
    expect(recipient).toBeUndefined();
  });

  it("excludes addresses already in the user's wallet list", () => {
    const wallets = [wallet({ address: "0xMe" }), wallet({ id: "w2", address: "0xKnown" })];
    const txs = [
      tx({ counterpartyAddress: "0xknown", tokenOutSymbol: "ETH", tokenOutAmount: "1", valueUsd: "5000" }),
      tx({ counterpartyAddress: "0xknown", tokenInSymbol: "ETH", tokenInAmount: "1", valueUsd: "5000" }),
    ];
    const suggestions = suggestWallets(txs, wallets);
    expect(suggestions.find(s => s.address === "0xknown")).toBeUndefined();
  });

  it("excludes known DEX router addresses", () => {
    const wallets = [wallet({ address: "0xme" })];
    const txs = [
      tx({ counterpartyAddress: "0x7a250d5630b4cf539739df2c5dacb4c659f2488d", tokenOutSymbol: "ETH", tokenOutAmount: "1", valueUsd: "5000" }),
      tx({ counterpartyAddress: "0x7a250d5630b4cf539739df2c5dacb4c659f2488d", tokenInSymbol: "USDC", tokenInAmount: "5000", valueUsd: "5000" }),
    ];
    const suggestions = suggestWallets(txs, wallets);
    expect(suggestions).toHaveLength(0);
  });

  it("rewards multi-chain presence with extra confidence", () => {
    const wallets = [wallet({ address: "0xme" })];
    const txs = [
      tx({ chain: "ethereum", counterpartyAddress: "0xforgot", tokenOutSymbol: "ETH", tokenOutAmount: "1", valueUsd: "1000" }),
      tx({ chain: "ethereum", counterpartyAddress: "0xforgot", tokenInSymbol: "ETH", tokenInAmount: "1", valueUsd: "1000" }),
      tx({ chain: "polygon", counterpartyAddress: "0xforgot", tokenOutSymbol: "MATIC", tokenOutAmount: "100", valueUsd: "100" }),
    ];
    const s = suggestWallets(txs, wallets);
    expect(s[0].chains.sort()).toEqual(["ethereum", "polygon"]);
    expect(s[0].reasons.some(r => r.includes("2 chains"))).toBe(true);
  });
});

describe("findTransferPairCandidates", () => {
  it("pairs an outgoing tx and a matching incoming tx across two wallets", () => {
    const txs = [
      tx({
        id: "out1", walletId: "w1",
        timestamp: new Date("2024-03-01T12:00:00Z"),
        tokenOutSymbol: "ETH", tokenOutAmount: "1.5",
      }),
      tx({
        id: "in1", walletId: "w2",
        timestamp: new Date("2024-03-01T12:05:00Z"),
        tokenInSymbol: "ETH", tokenInAmount: "1.5",
      }),
    ];
    const pairs = findTransferPairCandidates(txs);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].outTxId).toBe("out1");
    expect(pairs[0].inTxId).toBe("in1");
    expect(pairs[0].confidence).toBeGreaterThan(0.5);
  });

  it("ignores pairs on the same wallet", () => {
    const txs = [
      tx({ id: "a", walletId: "w1", tokenOutSymbol: "ETH", tokenOutAmount: "1" }),
      tx({ id: "b", walletId: "w1", tokenInSymbol: "ETH", tokenInAmount: "1" }),
    ];
    expect(findTransferPairCandidates(txs)).toHaveLength(0);
  });

  it("ignores pairs outside the time window", () => {
    const txs = [
      tx({
        id: "out", walletId: "w1",
        timestamp: new Date("2024-03-01T12:00:00Z"),
        tokenOutSymbol: "ETH", tokenOutAmount: "1",
      }),
      tx({
        id: "in", walletId: "w2",
        timestamp: new Date("2024-03-02T12:00:00Z"), // 24h later
        tokenInSymbol: "ETH", tokenInAmount: "1",
      }),
    ];
    expect(findTransferPairCandidates(txs)).toHaveLength(0);
  });

  it("ignores pairs already classified by the user", () => {
    const txs = [
      tx({
        id: "a", walletId: "w1", classification: "swap", userClassified: true,
        tokenOutSymbol: "ETH", tokenOutAmount: "1",
      }),
      tx({
        id: "b", walletId: "w2", tokenInSymbol: "ETH", tokenInAmount: "1",
      }),
    ];
    expect(findTransferPairCandidates(txs)).toHaveLength(0);
  });

  it("tolerates small amount differences within tolerance (gas-on-bridge)", () => {
    const txs = [
      tx({ id: "a", walletId: "w1", timestamp: new Date("2024-01-01T00:00:00Z"), tokenOutSymbol: "USDC", tokenOutAmount: "1000" }),
      tx({ id: "b", walletId: "w2", timestamp: new Date("2024-01-01T00:01:00Z"), tokenInSymbol: "USDC", tokenInAmount: "999.5" }),
    ];
    const pairs = findTransferPairCandidates(txs);
    expect(pairs).toHaveLength(1);
  });
});
