/**
 * CSV importer with exchange presets.
 *
 * The endpoint accepts already-parsed rows (so we don't need a multipart
 * parser server-side; the browser does the parsing). Rows are mapped against
 * provider presets for Coinbase / Robinhood plus a generic fallback.
 *
 * Exports are informational worksheets only. Anything ambiguous is marked
 * needsReview so users verify before relying on the data.
 */
import type { InsertTransaction } from "../../shared/schema";

export type CsvRow = Record<string, string>;
export type CsvImportSource = "generic" | "coinbase" | "robinhood";

type NormalizedRow = {
  timestamp?: string;
  type?: string;
  asset?: string;
  amount?: string;
  totalUsd?: string;
  fee?: string;
  externalId?: string;
  notes?: string;
};

const TIMESTAMP_KEYS = ["timestamp", "date", "datetime", "time", "transaction date", "executed at", "trade date"];
const TYPE_KEYS = ["type", "transaction type", "activity", "transaction kind", "side", "action"];
const ASSET_KEYS = ["asset", "token", "currency", "symbol", "coin", "instrument"];
const AMOUNT_KEYS = ["amount", "quantity", "size", "qty", "quantity transacted", "asset quantity"];
const TOTAL_KEYS = ["total", "value", "proceeds", "subtotal", "cost", "total (inclusive of fees)", "usd amount", "usd subtotal", "amount usd", "net amount"];
const FEE_KEYS = ["fee", "fees", "spread", "transaction fee", "commission", "regulatory fee"];
const HASH_KEYS = ["tx hash", "hash", "id", "transaction id", "transaction hash", "trade id", "order id", "reference id"];

const TYPE_MAP: Record<string, string> = {
  buy: "swap",
  bought: "swap",
  sell: "swap",
  sold: "swap",
  trade: "swap",
  convert: "swap",
  conversion: "swap",
  send: "self_transfer",
  sent: "self_transfer",
  receive: "self_transfer",
  received: "self_transfer",
  withdrawal: "self_transfer",
  withdraw: "self_transfer",
  deposit: "self_transfer",
  reward: "reward",
  rewards: "reward",
  staking: "stake",
  "staking income": "reward",
  airdrop: "airdrop",
  income: "income",
  interest: "interest",
  dividend: "income",
  fee: "expense",
};

function normalizeKey(key: string): string {
  return key.toLowerCase().trim().replace(/\s+/g, " ").replace(/[()]/g, "").replace(/:/g, "");
}

function byKey(row: CsvRow): Record<string, string> {
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [normalizeKey(k), String(v ?? "").trim()]));
}

function pick(row: CsvRow, keys: string[]): string | undefined {
  const norm = byKey(row);
  for (const k of keys) {
    const v = norm[normalizeKey(k)];
    if (v && String(v).trim()) return String(v).trim();
  }
  return undefined;
}

function parseTimestamp(s: string): Date | null {
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function cleanMoney(value?: string): string | undefined {
  if (!value) return undefined;
  const cleaned = String(value).replace(/[$,]/g, "").trim();
  if (!cleaned || cleaned === "-") return undefined;
  const parenMatch = cleaned.match(/^\((.*)\)$/);
  return parenMatch ? `-${parenMatch[1]}` : cleaned;
}

function cleanAmount(value?: string): string | undefined {
  if (!value) return undefined;
  return String(value).replace(/[,]/g, "").trim() || undefined;
}

function normalizeType(raw?: string): string {
  return (raw || "").toLowerCase().trim().replace(/_/g, " ");
}

function isSellType(typeRaw: string): boolean {
  return ["sell", "sold"].includes(typeRaw) || typeRaw.includes("sell");
}

function isBuyType(typeRaw: string): boolean {
  return ["buy", "bought", "convert", "conversion", "trade"].includes(typeRaw) || typeRaw.includes("buy");
}

function isSendType(typeRaw: string): boolean {
  return ["send", "sent", "withdraw", "withdrawal"].includes(typeRaw) || typeRaw.includes("send") || typeRaw.includes("withdraw");
}

function isReceiveType(typeRaw: string): boolean {
  return ["receive", "received", "deposit"].includes(typeRaw) || typeRaw.includes("receive") || typeRaw.includes("deposit");
}

function genericRow(row: CsvRow): NormalizedRow {
  return {
    timestamp: pick(row, TIMESTAMP_KEYS),
    type: pick(row, TYPE_KEYS),
    asset: pick(row, ASSET_KEYS),
    amount: pick(row, AMOUNT_KEYS),
    totalUsd: pick(row, TOTAL_KEYS),
    fee: pick(row, FEE_KEYS),
    externalId: pick(row, HASH_KEYS),
  };
}

function coinbaseRow(row: CsvRow): NormalizedRow {
  const norm = byKey(row);
  return {
    timestamp: pick(row, ["Timestamp", "Transaction Date", "Date", "Time", ...TIMESTAMP_KEYS]),
    type: pick(row, ["Transaction Type", "Type", "Side", "Action", ...TYPE_KEYS]),
    asset: pick(row, ["Asset", "Asset Symbol", "Currency", "Crypto", "Coin", ...ASSET_KEYS]),
    amount: pick(row, ["Quantity Transacted", "Quantity", "Amount", "Asset Quantity", ...AMOUNT_KEYS]),
    totalUsd: pick(row, ["Total (inclusive of fees)", "Total", "Subtotal", "USD Subtotal", "USD Amount", "Amount USD", "Value", ...TOTAL_KEYS]),
    fee: pick(row, ["Fees", "Fee", "Spread", "Coinbase Fee", ...FEE_KEYS]),
    externalId: pick(row, ["Transaction ID", "Order ID", "Trade ID", "Reference ID", "ID", ...HASH_KEYS]),
    notes: norm.notes || norm.description,
  };
}

function robinhoodRow(row: CsvRow): NormalizedRow {
  const norm = byKey(row);
  const activity = pick(row, ["Activity", "Trans Code", "Transaction Type", "Type", "Side", "Action", ...TYPE_KEYS]);
  const inferredType = activity || (norm.description?.toLowerCase().includes("sell") ? "sell" : norm.description?.toLowerCase().includes("buy") ? "buy" : undefined);
  return {
    timestamp: pick(row, ["Date", "Activity Date", "Process Date", "Trade Date", "Created At", ...TIMESTAMP_KEYS]),
    type: inferredType,
    asset: pick(row, ["Instrument", "Symbol", "Currency", "Asset", "Crypto", ...ASSET_KEYS]),
    amount: pick(row, ["Quantity", "Amount", "Asset Quantity", "Qty", ...AMOUNT_KEYS]),
    totalUsd: pick(row, ["Amount", "Net Amount", "Total", "Value", "Proceeds", "Cost", "Price", ...TOTAL_KEYS]),
    fee: pick(row, ["Fees", "Fee", "Regulatory Fee", ...FEE_KEYS]),
    externalId: pick(row, ["ID", "Transaction ID", "Reference ID", "Order ID", ...HASH_KEYS]),
    notes: norm.description || norm.notes,
  };
}

function normalizeRow(row: CsvRow, source: CsvImportSource): NormalizedRow {
  if (source === "coinbase") return coinbaseRow(row);
  if (source === "robinhood") return robinhoodRow(row);
  return genericRow(row);
}

export type CsvImportSummary = {
  imported: number;
  skipped: number;
  errors: { row: number; reason: string }[];
  source: CsvImportSource;
  needsReview: number;
  recognized: number;
};

export type CsvImportPreview = CsvImportSummary & {
  duplicates?: number;
  sample: {
    row: number;
    timestamp: string;
    type: string;
    asset?: string;
    amount?: string;
    valueUsd?: string;
    classification: string | null;
    needsReview: boolean;
  }[];
  warnings: string[];
};

/**
 * Convert raw CSV rows into InsertTransaction values bound to a wallet.
 * Caller writes them via storage.createTransaction in a loop.
 */
export function rowsToTransactions(rows: CsvRow[], walletId: string, chain: string, source: CsvImportSource = "generic"): {
  transactions: InsertTransaction[];
  summary: CsvImportSummary;
} {
  const transactions: InsertTransaction[] = [];
  const errors: { row: number; reason: string }[] = [];
  let skipped = 0;
  let needsReview = 0;
  let recognized = 0;

  rows.forEach((row, i) => {
    try {
      const normalized = normalizeRow(row, source);
      const tsRaw = normalized.timestamp;
      if (!tsRaw) { errors.push({ row: i + 1, reason: "missing timestamp column" }); skipped++; return; }
      const timestamp = parseTimestamp(tsRaw);
      if (!timestamp) { errors.push({ row: i + 1, reason: `unparseable timestamp: ${tsRaw}` }); skipped++; return; }

      const typeRaw = normalizeType(normalized.type);
      const classification = TYPE_MAP[typeRaw] || (typeRaw.includes("reward") ? "reward" : typeRaw.includes("airdrop") ? "airdrop" : "unknown");
      const isSell = isSellType(typeRaw);
      const isBuy = isBuyType(typeRaw);
      const isSend = isSendType(typeRaw);
      const isReceive = isReceiveType(typeRaw);

      const asset = normalized.asset?.trim();
      const amount = cleanAmount(normalized.amount);
      const totalUsd = cleanMoney(normalized.totalUsd);
      const fee = cleanMoney(normalized.fee) || normalized.fee || null;
      const externalId = normalized.externalId || `${timestamp.toISOString()}-${typeRaw || "unknown"}-${asset || "asset"}-${amount || "amount"}-${totalUsd || "value"}`;
      const hash = `csv-${source}-${walletId}-${externalId}`;

      const movement = asset && amount ? { token: asset, symbol: asset.toUpperCase(), amount } : null;
      const rowNeedsReview = classification === "unknown" || !totalUsd || !movement || (!isBuy && !isSell && !isSend && !isReceive && classification === "swap");
      if (rowNeedsReview) needsReview++;
      if (classification !== "unknown" && movement) recognized++;

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
        classificationConfidence: classification === "unknown" ? "0.30" : source === "generic" ? "0.75" : "0.90",
        needsReview: rowNeedsReview,
        valueUsd: totalUsd || null,
        gasFee: fee,
        basisSource: totalUsd ? `${source}-csv-import` : null,
        basisSetBy: totalUsd ? "csv" : null,
        basisSetAt: totalUsd ? new Date() : null,
        basisNotes: normalized.notes || `Imported from ${source} CSV. Verify before relying on this record.`,
      };

      transactions.push(tx);
    } catch (err: any) {
      errors.push({ row: i + 1, reason: err.message || String(err) });
      skipped++;
    }
  });

  return {
    transactions,
    summary: { imported: transactions.length, skipped, errors, source, needsReview, recognized },
  };
}

export function previewCsvImport(rows: CsvRow[], walletId: string, chain: string, source: CsvImportSource = "generic"): CsvImportPreview {
  const { transactions, summary } = rowsToTransactions(rows, walletId, chain, source);
  const warnings = [
    "CSV imports are informational records only, not tax/legal/accounting advice.",
    "Verify CSV exports against your exchange account and any official tax documents before filing.",
  ];

  if (summary.needsReview > 0) warnings.push(`${summary.needsReview} imported rows will be marked needs-review because fields were missing or ambiguous.`);
  if (source === "robinhood") warnings.push("Robinhood CSV formats vary by export type; preview carefully before importing.");
  if (source === "coinbase") warnings.push("Coinbase may split trades, conversions, fees, deposits, and withdrawals across multiple export rows.");

  return {
    ...summary,
    sample: transactions.slice(0, 10).map((tx, idx) => ({
      row: idx + 1,
      timestamp: tx.timestamp instanceof Date ? tx.timestamp.toISOString() : String(tx.timestamp),
      type: String(tx.classification || "unknown"),
      asset: tx.tokenInSymbol || tx.tokenOutSymbol || undefined,
      amount: tx.tokenInAmount || tx.tokenOutAmount || undefined,
      valueUsd: tx.valueUsd || undefined,
      classification: tx.classification || null,
      needsReview: Boolean(tx.needsReview),
    })),
    warnings,
  };
}
