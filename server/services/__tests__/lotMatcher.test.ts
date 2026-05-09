import { describe, it, expect } from "vitest";
import { matchDisposal, type LotInput, type DisposalInput } from "../lotMatcher";

const lot = (id: string, acquiredAt: string, amount: string, basis: string): LotInput => ({
  id,
  acquiredAt: new Date(acquiredAt),
  amount,
  remainingAmount: amount,
  costBasisUsd: basis,
});

const disposal = (amount: string, proceedsUsd: string, disposedAt: string): DisposalInput => ({
  transactionId: "tx-1",
  token: "0xeth",
  tokenSymbol: "ETH",
  amount,
  proceedsUsd,
  disposedAt: new Date(disposedAt),
});

describe("matchDisposal", () => {
  it("FIFO: consumes oldest lot first", () => {
    const lots = [
      lot("a", "2023-01-01", "1", "1000"),  // basis $1000/ETH
      lot("b", "2023-06-01", "1", "1500"),  // basis $1500/ETH
    ];
    const r = matchDisposal(lots, disposal("1", "2000", "2023-09-01"), "fifo");
    expect(r.disposals).toHaveLength(1);
    expect(r.disposals[0].taxLotId).toBe("a");
    expect(r.disposals[0].costBasisUsd).toBe("1000.00");
    expect(r.disposals[0].gainLossUsd).toBe("1000.00");
    expect(r.unmatched).toBe("0");
  });

  it("LIFO: consumes newest lot first", () => {
    const lots = [
      lot("a", "2023-01-01", "1", "1000"),
      lot("b", "2023-06-01", "1", "1500"),
    ];
    const r = matchDisposal(lots, disposal("1", "2000", "2023-09-01"), "lifo");
    expect(r.disposals[0].taxLotId).toBe("b");
    expect(r.disposals[0].costBasisUsd).toBe("1500.00");
    expect(r.disposals[0].gainLossUsd).toBe("500.00");
  });

  it("HIFO: picks the highest cost-per-unit lot to minimize gain", () => {
    const lots = [
      lot("a", "2023-01-01", "1", "1000"),  // $1000/ETH
      lot("b", "2023-02-01", "1", "2200"),  // $2200/ETH (highest)
      lot("c", "2023-03-01", "1", "1500"),  // $1500/ETH
    ];
    const r = matchDisposal(lots, disposal("1", "2000", "2023-09-01"), "hifo");
    expect(r.disposals[0].taxLotId).toBe("b");
    expect(r.disposals[0].gainLossUsd).toBe("-200.00"); // realized loss, as intended
  });

  it("specific_id: respects provided lot order", () => {
    const lots = [
      lot("a", "2023-01-01", "1", "1000"),
      lot("b", "2023-06-01", "1", "1500"),
    ];
    const r = matchDisposal(lots, disposal("1", "2000", "2023-09-01"), "specific_id", ["b", "a"]);
    expect(r.disposals[0].taxLotId).toBe("b");
  });

  it("splits a disposal across multiple lots when one isn't enough", () => {
    const lots = [
      lot("a", "2023-01-01", "0.5", "500"),
      lot("b", "2023-06-01", "0.5", "1000"),
    ];
    const r = matchDisposal(lots, disposal("1", "2000", "2023-09-01"), "fifo");
    expect(r.disposals).toHaveLength(2);
    expect(r.disposals[0].taxLotId).toBe("a");
    expect(r.disposals[1].taxLotId).toBe("b");
    // Proceeds split proportionally: 0.5 / 1.0 of $2000 = $1000 each.
    expect(r.disposals[0].proceedsUsd).toBe("1000.00");
    expect(r.disposals[1].proceedsUsd).toBe("1000.00");
    expect(r.disposals[0].gainLossUsd).toBe("500.00");
    expect(r.disposals[1].gainLossUsd).toBe("0.00");
  });

  it("reports unmatched amount when lots are insufficient", () => {
    const lots = [lot("a", "2023-01-01", "0.3", "300")];
    const r = matchDisposal(lots, disposal("1", "2000", "2023-09-01"), "fifo");
    expect(r.unmatched).not.toBe("0");
    expect(parseFloat(r.unmatched)).toBeCloseTo(0.7, 6);
  });

  it("classifies short-term vs long-term correctly", () => {
    const lots = [
      lot("st", "2024-01-01", "1", "1000"),
      lot("lt", "2022-01-01", "1", "1000"),
    ];
    const stResult = matchDisposal([lots[0]], disposal("1", "1500", "2024-06-01"), "fifo");
    expect(stResult.disposals[0].isShortTerm).toBe(true);
    const ltResult = matchDisposal([lots[1]], disposal("1", "1500", "2024-06-01"), "fifo");
    expect(ltResult.disposals[0].isShortTerm).toBe(false);
  });

  it("emits lot updates with the correct remaining amounts", () => {
    const lots = [lot("a", "2023-01-01", "2", "2000")];
    const r = matchDisposal(lots, disposal("1.25", "1500", "2023-09-01"), "fifo");
    expect(r.lotUpdates).toHaveLength(1);
    expect(parseFloat(r.lotUpdates[0].newRemainingAmount)).toBeCloseTo(0.75, 8);
  });
});
