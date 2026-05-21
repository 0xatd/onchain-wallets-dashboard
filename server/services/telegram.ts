import type { Transaction, TelegramLink } from "../../shared/schema";

const TELEGRAM_API_BASE = "https://api.telegram.org/bot";

export function isTelegramConfigured(): boolean {
  return !!process.env.TELEGRAM_BOT_TOKEN;
}

function getApiUrl(method: string): string {
  return `${TELEGRAM_API_BASE}${process.env.TELEGRAM_BOT_TOKEN}/${method}`;
}

export function generateVerificationCode(): string {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

export async function sendMessage(chatId: string, text: string, options?: {
  parseMode?: "HTML" | "Markdown";
  replyMarkup?: object;
}): Promise<boolean> {
  if (!isTelegramConfigured()) {
    console.warn("Telegram not configured, skipping message");
    return false;
  }

  try {
    const response = await fetch(getApiUrl("sendMessage"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: options?.parseMode || "HTML",
        reply_markup: options?.replyMarkup,
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      console.error("Telegram API error:", error);
      return false;
    }

    return true;
  } catch (error) {
    console.error("Failed to send Telegram message:", error);
    return false;
  }
}

export async function sendTransactionReviewNotification(
  chatId: string,
  transaction: Transaction
): Promise<boolean> {
  const truncateAddress = (addr: string | null) => 
    addr ? `${addr.slice(0, 8)}...${addr.slice(-6)}` : "Unknown";

  const formatAmount = (amount: string | null, symbol: string | null) => 
    amount && symbol ? `${parseFloat(amount).toFixed(4)} ${symbol}` : "N/A";

  const message = `
<b>New Transaction Needs Review</b>

<b>Chain:</b> ${transaction.chain.toUpperCase()}
<b>Hash:</b> <code>${truncateAddress(transaction.txHash)}</code>
<b>Date:</b> ${new Date(transaction.timestamp).toLocaleDateString()}

${transaction.tokenInSymbol ? `<b>Received:</b> ${formatAmount(transaction.tokenInAmount, transaction.tokenInSymbol)}` : ""}
${transaction.tokenOutSymbol ? `<b>Sent:</b> ${formatAmount(transaction.tokenOutAmount, transaction.tokenOutSymbol)}` : ""}

<b>What was this transaction?</b>
Reply with one of: swap, income, airdrop, stake, unstake, nft_mint, expense, self_transfer

Or reply: <code>classify ${transaction.id} [type]</code>
  `.trim();

  return sendMessage(chatId, message, {
    parseMode: "HTML",
    replyMarkup: {
      inline_keyboard: [
        [
          { text: "Swap", callback_data: `classify:${transaction.id}:swap` },
          { text: "Income", callback_data: `classify:${transaction.id}:income` },
          { text: "Airdrop", callback_data: `classify:${transaction.id}:airdrop` },
        ],
        [
          { text: "Stake", callback_data: `classify:${transaction.id}:stake` },
          { text: "Unstake", callback_data: `classify:${transaction.id}:unstake` },
          { text: "Expense", callback_data: `classify:${transaction.id}:expense` },
        ],
        [
          { text: "Self Transfer", callback_data: `classify:${transaction.id}:self_transfer` },
          { text: "NFT Mint", callback_data: `classify:${transaction.id}:nft_mint` },
        ],
      ],
    },
  });
}

export async function sendWelcomeMessage(chatId: string): Promise<boolean> {
  const message = `
<b>Welcome to Open Crypto Tax</b>

Your Telegram account is now linked. You'll receive notifications when:

- New transactions are synced that need classification
- Transactions are flagged for review

<b>Quick Commands:</b>
• Reply with a classification (swap, income, airdrop, etc.) to classify the last transaction
• Use <code>classify [txId] [type]</code> to classify a specific transaction
• Use <code>status</code> to see pending review count

Informational tool only — not tax, legal, accounting, investment, financial, or compliance advice. Verify records with a qualified professional before filing or making decisions.
  `.trim();

  return sendMessage(chatId, message, { parseMode: "HTML" });
}

export async function sendVerificationSuccess(chatId: string): Promise<boolean> {
  return sendMessage(chatId, 
    "Your account has been successfully verified! You'll now receive transaction notifications here.",
    { parseMode: "HTML" }
  );
}

interface TelegramUpdate {
  update_id: number;
  message?: {
    message_id: number;
    from: {
      id: number;
      username?: string;
      first_name?: string;
    };
    chat: {
      id: number;
      type: string;
    };
    text?: string;
  };
  callback_query?: {
    id: string;
    from: {
      id: number;
      username?: string;
    };
    message?: {
      chat: {
        id: number;
      };
    };
    data?: string;
  };
}

export interface ProcessedUpdate {
  type: "verification" | "classification" | "command" | "unknown";
  chatId: string;
  userId?: number;
  username?: string;
  verificationCode?: string;
  transactionId?: string;
  classification?: string;
  command?: string;
  callbackQueryId?: string;
}

export function parseUpdate(update: TelegramUpdate): ProcessedUpdate | null {
  if (update.callback_query) {
    const data = update.callback_query.data;
    const chatId = update.callback_query.message?.chat.id.toString();
    
    if (!chatId || !data) return null;
    
    if (data.startsWith("classify:")) {
      const [, transactionId, classification] = data.split(":");
      return {
        type: "classification",
        chatId,
        userId: update.callback_query.from.id,
        username: update.callback_query.from.username,
        transactionId,
        classification,
        callbackQueryId: update.callback_query.id,
      };
    }
  }
  
  if (update.message?.text) {
    const text = update.message.text.trim();
    const chatId = update.message.chat.id.toString();
    const userId = update.message.from.id;
    const username = update.message.from.username;
    
    if (text.match(/^[A-Z0-9]{6}$/)) {
      return {
        type: "verification",
        chatId,
        userId,
        username,
        verificationCode: text,
      };
    }
    
    if (text.toLowerCase().startsWith("classify ")) {
      const parts = text.split(" ");
      if (parts.length >= 3) {
        return {
          type: "classification",
          chatId,
          userId,
          username,
          transactionId: parts[1],
          classification: parts[2].toLowerCase(),
        };
      }
    }
    
    const validClassifications = [
      "swap", "income", "airdrop", "stake", "unstake", 
      "nft_mint", "expense", "self_transfer", "reward", "interest"
    ];
    
    if (validClassifications.includes(text.toLowerCase())) {
      return {
        type: "classification",
        chatId,
        userId,
        username,
        classification: text.toLowerCase(),
      };
    }
    
    if (text.startsWith("/") || ["status", "help"].includes(text.toLowerCase())) {
      return {
        type: "command",
        chatId,
        userId,
        username,
        command: text.toLowerCase().replace("/", ""),
      };
    }
  }
  
  return null;
}

export async function answerCallbackQuery(
  callbackQueryId: string, 
  text?: string
): Promise<boolean> {
  if (!isTelegramConfigured()) return false;
  
  try {
    const response = await fetch(getApiUrl("answerCallbackQuery"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        callback_query_id: callbackQueryId,
        text: text || "Done!",
      }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export async function getWebhookInfo(): Promise<{ url: string } | null> {
  if (!isTelegramConfigured()) return null;
  
  try {
    const response = await fetch(getApiUrl("getWebhookInfo"));
    if (!response.ok) return null;
    const data = await response.json();
    return data.result;
  } catch {
    return null;
  }
}

export async function setWebhook(url: string): Promise<boolean> {
  if (!isTelegramConfigured()) return false;
  
  try {
    const response = await fetch(getApiUrl("setWebhook"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    
    if (!response.ok) {
      const error = await response.json();
      console.error("Failed to set webhook:", error);
      return false;
    }
    
    return true;
  } catch (error) {
    console.error("Error setting webhook:", error);
    return false;
  }
}

export async function deleteWebhook(): Promise<boolean> {
  if (!isTelegramConfigured()) return false;
  
  try {
    const response = await fetch(getApiUrl("deleteWebhook"), {
      method: "POST",
    });
    return response.ok;
  } catch {
    return false;
  }
}
