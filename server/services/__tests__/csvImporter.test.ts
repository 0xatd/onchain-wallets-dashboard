import { describe, it, expect } from "vitest";
import { rowsToTransactions } from "../csvImporter";

describe("rowsToTransactions", () => {
  it("maps Coinbase-style rows to buy = tokenIn", () => {
    const rows = [{
      Timestamp: "2024-03-12T14:00:00Z",
      "Transaction Type": "Buy",
      Asset: "ETH",
      "Quantity Transacted": "0.5",
      Total: "1500.00",
      Fees: "5.00",
    }];
    const { transactions } = rowsToTransactions(rows, "w1", "ethereum");
    expect(transactions).toHaveLength(1);
    const tx = transactions[0];
    expect(tx.tokenInSymbol).toBe("ETH");
    expect(tx.tokenInAmount).toBe("0.5");
    expect(tx.tokenOut).toBeNull();
    expect(tx.classification).toBe("swap");
    expect(tx.valueUsd).toBe("1500.00");
    expect(tx.basisSource).toBe("csv-import");
    expect(tx.needsReview).toBe(false);
  });

  it("maps a sell to tokenOut", () => {
    const rows = [{
      timestamp: "2024-04-01",
      type: "Sell",
      asset: "BTC",
      quantity: "0.1",
      total: "$6,500.00",
    }];
    const { transactions } = rowsToTransactions(rows, "w1", "bitcoin");
    expect(transactions[0].tokenOutSymbol).toBe("BTC");
    expect(transactions[0].valueUsd).toBe("6500.00");
  });

  it("flags rows for review when no USD total is provided", () => {
    const rows = [{
      date: "2024-05-01",
      activity: "Receive",
      symbol: "USDC",
      amount: "200",
    }];
    const { transactions } = rowsToTransactions(rows, "w1", "ethereum");
    expect(transactions[0].needsReview).toBe(true);
    expect(transactions[0].basisSource).toBeNull();
  });

  it("skips rows with missing/unparseable timestamps", () => {
    const rows = [
      { type: "buy", asset: "ETH", amount: "1", total: "100" },
      { date: "not-a-date", type: "buy", asset: "ETH", amount: "1", total: "100" },
    ];
    const { transactions, summary } = rowsToTransactions(rows, "w1", "ethereum");
    expect(transactions).toHaveLength(0);
    expect(summary.skipped).toBe(2);
    expect(summary.errors).toHaveLength(2);
  });
});
