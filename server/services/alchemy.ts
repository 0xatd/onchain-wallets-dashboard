import type { InsertTransaction } from "../../shared/schema";

const ALCHEMY_NETWORK_MAP: Record<string, string> = {
  ethereum: "eth-mainnet",
  polygon: "polygon-mainnet",
  arbitrum: "arb-mainnet",
  optimism: "opt-mainnet",
  base: "base-mainnet",
};

export const ALCHEMY_SUPPORTED_CHAINS = Object.keys(ALCHEMY_NETWORK_MAP);

interface AlchemyTransfer {
  blockNum: string;
  hash: string;
  from: string;
  to: string;
  value: number | null;
  asset: string | null;
  category: string;
  rawContract: {
    address: string | null;
    decimal: string | null;
    value: string | null;
  };
  metadata: {
    blockTimestamp: string;
  };
}

interface AlchemyResponse {
  result: {
    transfers: AlchemyTransfer[];
    pageKey?: string;
  };
}

interface AggregatedTx {
  hash: string;
  blockNum: string;
  timestamp: string;
  transfers: AlchemyTransfer[];
  tokensIn: { address: string | null; symbol: string | null; amount: string }[];
  tokensOut: { address: string | null; symbol: string | null; amount: string }[];
  hasNft: boolean;
  nftMint: boolean;
  isInternal: boolean;
  contractInteraction: boolean;
}

export function isAlchemyConfigured(): boolean {
  return !!process.env.ALCHEMY_API_KEY;
}

export function getAlchemyApiUrl(chain: string): string | null {
  const network = ALCHEMY_NETWORK_MAP[chain];
  if (!network) return null;
  return `https://${network}.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`;
}

const KNOWN_DEX_ROUTERS = new Set([
  "0x7a250d5630b4cf539739df2c5dacb4c659f2488d", // Uniswap V2 Router
  "0xe592427a0aece92de3edee1f18e0157c05861564", // Uniswap V3 Router
  "0x68b3465833fb72a70ecdf485e0e4c7bd8665fc45", // Uniswap Universal Router
  "0xef1c6e67703c7bd7107eed8303fbe6ec2554bf6b", // Universal Router
  "0x1111111254eeb25477b68fb85ed929f73a960582", // 1inch V5 Router
  "0xdef1c0ded9bec7f1a1670819833240f027b25eff", // 0x Exchange Proxy
  "0xd9e1ce17f2641f24ae83637ab66a2cca9c378b9f", // SushiSwap Router
]);

const NULL_ADDRESS = "0x0000000000000000000000000000000000000000";

function classifyAggregatedTx(tx: AggregatedTx, walletAddress: string): string {
  const wallet = walletAddress.toLowerCase();
  const hasIn = tx.tokensIn.length > 0;
  const hasOut = tx.tokensOut.length > 0;
  
  // Self-transfer detection
  if (tx.transfers.length === 1) {
    const t = tx.transfers[0];
    if (t.from.toLowerCase() === t.to?.toLowerCase()) {
      return "self_transfer";
    }
    // Simple single-direction transfer
    if (t.from.toLowerCase() === wallet || t.to?.toLowerCase() === wallet) {
      return "transfer";
    }
  }
  
  // NFT transactions
  if (tx.hasNft) {
    if (tx.nftMint) {
      return "nft_mint";
    }
    return "nft_sale";
  }
  
  // Check if DEX router is involved (strong indicator of swap)
  const interactedWithDex = tx.transfers.some(t => 
    KNOWN_DEX_ROUTERS.has(t.from.toLowerCase()) || 
    KNOWN_DEX_ROUTERS.has(t.to?.toLowerCase() || "")
  );
  
  // Swap detection: tokens going in AND out with DIFFERENT symbols
  if (hasIn && hasOut) {
    const inSymbols = new Set(tx.tokensIn.map(t => t.symbol?.toLowerCase()).filter(Boolean));
    const outSymbols = new Set(tx.tokensOut.map(t => t.symbol?.toLowerCase()).filter(Boolean));
    
    // Check for distinct tokens (not just same token in both directions)
    const hasDistinctTokens = inSymbols.size > 0 && outSymbols.size > 0 &&
      Array.from(inSymbols).some(s => !outSymbols.has(s));
    
    if (hasDistinctTokens) {
      return "swap";
    }
    
    // DEX router + bidirectional = swap even if same symbol (wrapped tokens)
    if (interactedWithDex) {
      return "swap";
    }
    
    // Same token in both directions without DEX = likely internal movement
    return "transfer";
  }
  
  // Airdrop: tokens received from null address
  if (hasIn && !hasOut) {
    const fromNullAddr = tx.transfers.some(t => 
      t.from.toLowerCase() === NULL_ADDRESS && t.to?.toLowerCase() === wallet
    );
    if (fromNullAddr) {
      return "airdrop";
    }
    
    // Internal transaction often indicates rewards/income
    if (tx.isInternal) {
      return "reward";
    }
    
    // Simple incoming transfer
    return "transfer";
  }
  
  // Pure outgoing transfer
  if (hasOut && !hasIn) {
    return "transfer";
  }
  
  // No token movement - likely approval or failed tx
  if (!hasIn && !hasOut) {
    if (tx.transfers.length > 0) {
      return "contract_interaction";
    }
  }
  
  // Unknown - needs human review
  return "unknown";
}

function shouldNeedReview(classification: string): boolean {
  return classification === "unknown" || classification === "contract_interaction";
}

function getConfidence(classification: string): string {
  switch (classification) {
    case "swap": return "0.8";
    case "transfer": return "0.9";
    case "airdrop": return "0.7";
    case "nft_mint": return "0.9";
    case "nft_sale": return "0.7";
    case "self_transfer": return "0.95";
    case "reward": return "0.6";
    default: return "0.0";
  }
}

export async function fetchTransactions(
  walletAddress: string,
  chain: string,
  walletId: string
): Promise<{ transactions: InsertTransaction[]; error?: string }> {
  if (!isAlchemyConfigured()) {
    return { 
      transactions: [], 
      error: "Alchemy API key not configured. Add ALCHEMY_API_KEY to your secrets." 
    };
  }

  const apiUrl = getAlchemyApiUrl(chain);
  if (!apiUrl) {
    return { 
      transactions: [], 
      error: `Chain ${chain} is not supported by Alchemy. Supported chains: ${ALCHEMY_SUPPORTED_CHAINS.join(", ")}` 
    };
  }

  try {
    const allTransfers: AlchemyTransfer[] = [];
    
    const fetchPage = async (direction: "from" | "to") => {
      const body = {
        id: 1,
        jsonrpc: "2.0",
        method: "alchemy_getAssetTransfers",
        params: [{
          [direction === "from" ? "fromAddress" : "toAddress"]: walletAddress,
          category: ["external", "internal", "erc20", "erc721", "erc1155"],
          withMetadata: true,
          order: "desc",
          maxCount: "0x64",
        }]
      };

      const response = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        throw new Error(`Alchemy API error: ${response.status} ${response.statusText}`);
      }

      const data: AlchemyResponse = await response.json();
      return data.result;
    };

    const [fromResult, toResult] = await Promise.all([
      fetchPage("from"),
      fetchPage("to")
    ]);

    allTransfers.push(...(fromResult.transfers || []));
    allTransfers.push(...(toResult.transfers || []));

    // Group transfers by transaction hash to detect swaps
    const txMap = new Map<string, AggregatedTx>();
    const wallet = walletAddress.toLowerCase();
    
    for (const transfer of allTransfers) {
      const existing = txMap.get(transfer.hash);
      const isOutgoing = transfer.from.toLowerCase() === wallet;
      const isIncoming = transfer.to?.toLowerCase() === wallet;
      const isNft = transfer.category === "erc721" || transfer.category === "erc1155";
      const isMint = transfer.from.toLowerCase() === NULL_ADDRESS;
      
      if (existing) {
        existing.transfers.push(transfer);
        
        if (isIncoming && transfer.value) {
          existing.tokensIn.push({
            address: transfer.rawContract.address,
            symbol: transfer.asset,
            amount: transfer.value.toString()
          });
        }
        if (isOutgoing && transfer.value) {
          existing.tokensOut.push({
            address: transfer.rawContract.address,
            symbol: transfer.asset,
            amount: transfer.value.toString()
          });
        }
        if (isNft) existing.hasNft = true;
        if (isNft && isMint) existing.nftMint = true;
        if (transfer.category === "internal") existing.isInternal = true;
        if (transfer.rawContract.address) existing.contractInteraction = true;
      } else {
        const newTx: AggregatedTx = {
          hash: transfer.hash,
          blockNum: transfer.blockNum,
          timestamp: transfer.metadata.blockTimestamp,
          transfers: [transfer],
          tokensIn: [],
          tokensOut: [],
          hasNft: isNft,
          nftMint: isNft && isMint,
          isInternal: transfer.category === "internal",
          contractInteraction: !!transfer.rawContract.address,
        };
        
        if (isIncoming && transfer.value) {
          newTx.tokensIn.push({
            address: transfer.rawContract.address,
            symbol: transfer.asset,
            amount: transfer.value.toString()
          });
        }
        if (isOutgoing && transfer.value) {
          newTx.tokensOut.push({
            address: transfer.rawContract.address,
            symbol: transfer.asset,
            amount: transfer.value.toString()
          });
        }
        
        txMap.set(transfer.hash, newTx);
      }
    }

    const transactions: InsertTransaction[] = [];
    
    for (const tx of Array.from(txMap.values())) {
      const classification = classifyAggregatedTx(tx, walletAddress);
      const blockNumber = parseInt(tx.blockNum, 16);
      const timestamp = new Date(tx.timestamp);
      
      // Get primary token in/out (first ones if multiple)
      const primaryIn = tx.tokensIn[0];
      const primaryOut = tx.tokensOut[0];
      
      // Find contract address from transfers
      const contractAddr = tx.transfers.find((t: any) => t.rawContract?.address)?.rawContract?.address || null;

      // Calculate approximate USD value (simplified)
      const totalValue = tx.transfers.reduce((sum: number, t: any) => sum + (t.value || 0), 0);
      
      transactions.push({
        walletId,
        txHash: tx.hash,
        chain,
        timestamp,
        blockNumber,
        tokenIn: primaryIn?.address || null,
        tokenInAmount: primaryIn?.amount || null,
        tokenInSymbol: primaryIn?.symbol || null,
        tokenOut: primaryOut?.address || null,
        tokenOutAmount: primaryOut?.amount || null,
        tokenOutSymbol: primaryOut?.symbol || null,
        classification,
        classificationConfidence: getConfidence(classification),
        needsReview: shouldNeedReview(classification),
        userClassified: false,
        contractAddress: contractAddr,
        methodName: null,
        gasFee: null,
        gasFeeUsd: null,
        priceAtTime: null,
        valueUsd: totalValue > 0 ? totalValue.toFixed(2) : null,
        isSpam: false,
        isDust: totalValue > 0 && totalValue < 1,
      });
    }

    return { transactions };
  } catch (error) {
    console.error("Error fetching from Alchemy:", error);
    return { 
      transactions: [], 
      error: error instanceof Error ? error.message : "Failed to fetch transactions from Alchemy" 
    };
  }
}
