/**
 * Generic CSV importer.
 *
 * The endpoint accepts already-parsed rows (so we don't need a multipart
 * parser server-side; the browser does the parsing). Rows are mapped against
 * a flexible schema that covers the common shapes from Coinbase, Kraken,
 * Binance, Robinhood, etc. — anything missing comes through as needsReview.
 *
 * Required columns (any of):
 *   timestamp / date / datetime
 *   type / transaction type / activity
 *
 * Optional but recommended:
 *   asset / token / currency / symbol
 *   amount / quantity / size
 *   price / spot price / unit price
 *   total / value / proceeds / cost (USD)
 *   fee / fees
 *   side / direction (buy/sell)
 *   tx hash / hash / id
 */
import type { InsertTransaction } from "../../shared/schema";

export type CsvRow = Record<string, string>;

const TIMESTAMP_KEYS = ["timestamp", "date", "datetime", "time", "transaction date", "executed at"];
const TYPE_KEYS = ["type", "transaction type", "activity", "transaction kind", "side"];
const ASSET_KEYS = ["asset", "token", "currency", "symbol", "coin"];
const AMOUNT_KEYS = ["amount", "quantity", "size", "qty", "quantity transacted"];
const TOTAL_KEYS = ["total", "value", "proceeds", "subtotal", "cost", "total (inclusive of fees)", "usd amount", "usd subtotal"];
const FEE_KEYS = ["fee", "fees", "spread", "transaction fee"];
const HASH_KEYS = ["tx hash", "hash", "id", "transaction id", "transaction hash"];

const TYPE_MAP: Record<string, string> = {
  buy: "swap",
  sell: "swap",
  trade: "swap",
  convert: "swap",
  send: "self_transfer",
  receive: "self_transfer",
  withdrawal: "self_transfer",
  deposit: "self_transfer",
  reward: "reward",
  staking: "stake",
  "staking income": "reward",
  airdrop: "airdrop",
  income: "income",
  interest: "interest",
};

function pick(row: CsvRow, keys: string[]): string | undefined {
  const norm = Object.fromEntries(Object.entries(row).map(([k, v]) => [k.toLowerCase().trim(), v]));
  for (const k of keys) {
    const v = norm[k];
    if (v && String(v).trim()) return String(v).trim();
  }
  return undefined;
}

function parseTimestamp(s: string): Date | null {
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

export type CsvImportSummary = {
  imported: number;
  skipped: number;
  errors: { row: number; reason: string }[];
};

/**
 * Convert raw CSV rows into InsertTransaction values bound to a wallet.
 * Caller writes them via storage.createTransaction in a loop.
 */
export function rowsToTransactions(rows: CsvRow[], walletId: string, chain: string): {
  transactions: InsertTransaction[];
  summary: CsvImportSummary;
} {
  const transactions: InsertTransaction[] = [];
  const errors: { row: number; reason: string }[] = [];
  let skipped = 0;

  rows.forEach((row, i) => {
    try {
      const tsRaw = pick(row, TIMESTAMP_KEYS);
      if (!tsRaw) { errors.push({ row: i, reason: "missing timestamp column" }); skipped++; return; }
      const timestamp = parseTimestamp(tsRaw);
      if (!timestamp) { errors.push({ row: i, reason: `unparseable timestamp: ${tsRaw}` }); skipped++; return; }

      const typeRaw = pick(row, TYPE_KEYS)?.toLowerCase() || "";
      const classification = TYPE_MAP[typeRaw] || "unknown";
      const isSell = typeRaw === "sell";
      const isBuy = typeRaw === "buy" || typeRaw === "convert" || typeRaw === "trade";
      const isSend = typeRaw === "send" || typeRaw === "withdrawal";
      const isReceive = typeRaw === "receive" || typeRaw === "deposit";

      const asset = pick(row, ASSET_KEYS);
      const amount = pick(row, AMOUNT_KEYS);
      const totalUsd = pick(row, TOTAL_KEYS);
      const fee = pick(row, FEE_KEYS);
      const hash = pick(row, HASH_KEYS) || `csv-${walletId}-${i}-${tsRaw}`;

      const movement = asset && amount ? { token: asset, symbol: asset.toUpperCase(), amount } : null;

      const tx: InsertTransaction = {
        walletId,
        txHash: hash,
        chain,
        timestamp,
        tokenIn: (isBuy || isReceive) && movement ? movement.token : null,
        tokenInSymbol: (isBuy || isReceive) && movement ? movement.symbol : null,
        tokenInAmount: (isBuy || isReceive) && movement ? movement.amount : null,
        tokenOut: (isSell || isSend) && movement ? movement.token : null,
        tokenOutSymbol: (isSell || isSend) && movement ? movement.symbol : null,
        tokenOutAmount: (isSell || isSend) && movement ? movement.amount : null,
        classification,
        classificationConfidence: classification === "unknown" ? "0.30" : "0.85",
        needsReview: classification === "unknown" || !totalUsd,
        valueUsd: totalUsd ? totalUsd.replace(/[$,]/g, "") : null,
        gasFee: fee || null,
        basisSource: totalUsd ? "csv-import" : null,
        basisSetBy: totalUsd ? "csv" : null,
        basisSetAt: totalUsd ? new Date() : null,
      };

      transactions.push(tx);
    } catch (err: any) {
      errors.push({ row: i, reason: err.message || String(err) });
      skipped++;
    }
  });

  return {
    transactions,
    summary: { imported: transactions.length, skipped, errors },
  };
}
