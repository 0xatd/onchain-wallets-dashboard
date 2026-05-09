/**
 * Etherscan-family fallback importer.
 *
 * Uses the Etherscan V2 multichain API (one API key, many chains via chainid).
 * Fills the gap when Alchemy isn't configured. Coverage is narrower than
 * Alchemy (no internal-tx aggregation across both directions) but enough to
 * pull a wallet's normal + ERC-20 transfer history.
 *
 * Configure with ETHERSCAN_API_KEY.
 */
import type { InsertTransaction } from "../../shared/schema";

const ETHERSCAN_BASE = "https://api.etherscan.io/v2/api";

const CHAIN_IDS: Record<string, number> = {
  ethereum: 1,
  polygon: 137,
  arbitrum: 42161,
  optimism: 10,
  base: 8453,
  avalanche: 43114,
  bsc: 56,
};

export const ETHERSCAN_SUPPORTED_CHAINS = Object.keys(CHAIN_IDS);

export function isEtherscanConfigured(): boolean {
  return !!process.env.ETHERSCAN_API_KEY;
}

type NormalTx = {
  blockNumber: string;
  timeStamp: string;
  hash: string;
  from: string;
  to: string;
  value: string;
  gasUsed: string;
  gasPrice: string;
  isError: string;
  contractAddress: string;
  functionName?: string;
  methodId?: string;
};

type Erc20Tx = NormalTx & {
  tokenName: string;
  tokenSymbol: string;
  tokenDecimal: string;
};

async function call(chainId: number, params: Record<string, string>): Promise<any> {
  const qs = new URLSearchParams({
    chainid: String(chainId),
    apikey: process.env.ETHERSCAN_API_KEY || "",
    ...params,
  });
  const res = await fetch(`${ETHERSCAN_BASE}?${qs.toString()}`);
  if (!res.ok) throw new Error(`Etherscan ${res.status}`);
  return res.json();
}

function fromWei(value: string, decimals = 18): string {
  if (!value) return "0";
  // Avoid BigInt-to-Number precision loss: do a string division.
  const padded = value.padStart(decimals + 1, "0");
  const whole = padded.slice(0, padded.length - decimals) || "0";
  const frac = padded.slice(padded.length - decimals).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole;
}

export async function fetchTransactionsViaEtherscan(
  walletAddress: string,
  chain: string,
  walletId: string,
): Promise<{ transactions: InsertTransaction[]; error?: string }> {
  if (!isEtherscanConfigured()) {
    return { transactions: [], error: "Etherscan API key not configured. Add ETHERSCAN_API_KEY to your environment." };
  }
  const chainId = CHAIN_IDS[chain];
  if (!chainId) {
    return {
      transactions: [],
      error: `Chain ${chain} is not supported by the Etherscan fallback. Supported: ${ETHERSCAN_SUPPORTED_CHAINS.join(", ")}`,
    };
  }

  try {
    const addr = walletAddress.toLowerCase();
    const [normalRes, tokenRes] = await Promise.all([
      call(chainId, { module: "account", action: "txlist", address: addr, startblock: "0", endblock: "99999999", sort: "desc" }),
      call(chainId, { module: "account", action: "tokentx", address: addr, startblock: "0", endblock: "99999999", sort: "desc" }),
    ]);

    const normal: NormalTx[] = Array.isArray(normalRes?.result) ? normalRes.result : [];
    const tokens: Erc20Tx[] = Array.isArray(tokenRes?.result) ? tokenRes.result : [];

    // Group by tx hash. Token transfers take priority for tokenIn/tokenOut.
    type Acc = {
      hash: string;
      timestamp: Date;
      blockNumber: number;
      tokenIn?: { address: string; symbol: string; amount: string };
      tokenOut?: { address: string; symbol: string; amount: string };
      gasFeeEth?: string;
      contractAddress?: string;
      methodName?: string;
      from?: string;
      to?: string;
      counterparty?: string;
    };
    const NULL_ADDR = "0x0000000000000000000000000000000000000000";
    const map = new Map<string, Acc>();

    for (const tx of normal) {
      if (tx.isError === "1") continue;
      const hash = tx.hash.toLowerCase();
      const value = tx.value || "0";
      const acc: Acc = map.get(hash) || {
        hash,
        timestamp: new Date(parseInt(tx.timeStamp, 10) * 1000),
        blockNumber: parseInt(tx.blockNumber, 10),
      };
      acc.timestamp = new Date(parseInt(tx.timeStamp, 10) * 1000);
      acc.blockNumber = parseInt(tx.blockNumber, 10);
      acc.from = tx.from;
      acc.to = tx.to;
      acc.contractAddress = tx.contractAddress || acc.contractAddress;
      acc.methodName = tx.functionName?.split("(")[0] || acc.methodName;
      // Counterparty: the side that isn't us. Skip null/contract-creation.
      const fromLc = tx.from?.toLowerCase();
      const toLc = tx.to?.toLowerCase();
      const cp = fromLc === addr ? toLc : toLc === addr ? fromLc : null;
      if (cp && cp !== NULL_ADDR && cp !== "") acc.counterparty = acc.counterparty || cp;
      // Native value movement
      if (value !== "0") {
        const native = { address: "native", symbol: chain === "polygon" ? "MATIC" : chain === "bsc" ? "BNB" : chain === "avalanche" ? "AVAX" : "ETH", amount: fromWei(value, 18) };
        if (tx.from.toLowerCase() === addr) acc.tokenOut = native;
        if (tx.to.toLowerCase() === addr) acc.tokenIn = native;
      }
      // Gas fee (only the originator pays)
      if (tx.from.toLowerCase() === addr) {
        const gp = BigInt(tx.gasPrice || "0");
        const gu = BigInt(tx.gasUsed || "0");
        acc.gasFeeEth = fromWei((gp * gu).toString(), 18);
      }
      map.set(hash, acc);
    }

    for (const tx of tokens) {
      const hash = tx.hash.toLowerCase();
      const acc: Acc = map.get(hash) || {
        hash,
        timestamp: new Date(parseInt(tx.timeStamp, 10) * 1000),
        blockNumber: parseInt(tx.blockNumber, 10),
      };
      acc.timestamp = acc.timestamp || new Date(parseInt(tx.timeStamp, 10) * 1000);
      acc.contractAddress = tx.contractAddress || acc.contractAddress;
      const decimals = parseInt(tx.tokenDecimal, 10) || 18;
      const movement = { address: tx.contractAddress, symbol: tx.tokenSymbol, amount: fromWei(tx.value, decimals) };
      const fromLc = tx.from.toLowerCase();
      const toLc = tx.to.toLowerCase();
      if (fromLc === addr) acc.tokenOut = movement;
      if (toLc === addr) acc.tokenIn = movement;
      const cp = fromLc === addr ? toLc : toLc === addr ? fromLc : null;
      if (cp && cp !== NULL_ADDR) acc.counterparty = acc.counterparty || cp;
      map.set(hash, acc);
    }

    const transactions: InsertTransaction[] = Array.from(map.values()).map(acc => ({
      walletId,
      txHash: acc.hash,
      chain,
      timestamp: acc.timestamp,
      blockNumber: acc.blockNumber,
      tokenIn: acc.tokenIn?.address || null,
      tokenInSymbol: acc.tokenIn?.symbol || null,
      tokenInAmount: acc.tokenIn?.amount || null,
      tokenOut: acc.tokenOut?.address || null,
      tokenOutSymbol: acc.tokenOut?.symbol || null,
      tokenOutAmount: acc.tokenOut?.amount || null,
      classification: "unknown",
      classificationConfidence: "0.30",
      needsReview: true,
      contractAddress: acc.contractAddress || null,
      methodName: acc.methodName || null,
      counterpartyAddress: acc.counterparty || null,
      gasFee: acc.gasFeeEth || null,
    }) as InsertTransaction);

    return { transactions };
  } catch (err: any) {
    return { transactions: [], error: err.message || "Etherscan fallback failed" };
  }
}
