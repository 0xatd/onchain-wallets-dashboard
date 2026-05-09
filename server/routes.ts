import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertWalletSchema, insertRuleSchema } from "../shared/schema";
import { z } from "zod";
import { setupAuth, registerAuthRoutes, isAuthenticated } from "./auth";
import { registerAgentRoutes } from "./agentRoutes";
import { openApiSpec } from "./openapi";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // Setup auth first
  // Health check endpoint (no auth required)
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  await setupAuth(app);
  registerAuthRoutes(app);

  // OpenAPI spec — published at /api/openapi.json so AI agents can self-describe.
  app.get("/api/openapi.json", (_req, res) => res.json(openApiSpec));

  // Agent + proposal + audit + missing-basis + JSON export endpoints.
  registerAgentRoutes(app);

  // Helper to get userId from request
  const getUserId = (req: any): string => req.user?.claims?.sub;

  // Dashboard stats
  app.get("/api/dashboard/stats", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const stats = await storage.getDashboardStats(userId);
      res.json(stats);
    } catch (error) {
      console.error("Error fetching dashboard stats:", error);
      res.status(500).json({ error: "Failed to fetch dashboard stats" });
    }
  });

  // Wallets
  app.get("/api/wallets", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const wallets = await storage.getWallets(userId);
      res.json(wallets);
    } catch (error) {
      console.error("Error fetching wallets:", error);
      res.status(500).json({ error: "Failed to fetch wallets" });
    }
  });

  app.get("/api/wallets/:id", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const wallet = await storage.getWallet(req.params.id as string, userId);
      if (!wallet) {
        return res.status(404).json({ error: "Wallet not found" });
      }
      res.json(wallet);
    } catch (error) {
      console.error("Error fetching wallet:", error);
      res.status(500).json({ error: "Failed to fetch wallet" });
    }
  });

  app.post("/api/wallets", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const parsed = insertWalletSchema.omit({ userId: true }).parse(req.body);
      const wallet = await storage.createWallet({ ...parsed, userId });
      res.status(201).json(wallet);
    } catch (error) {
      console.error("Error creating wallet:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid wallet data", details: error.errors });
      }
      res.status(500).json({ error: "Failed to create wallet" });
    }
  });

  app.delete("/api/wallets/:id", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      await storage.deleteWallet(req.params.id as string, userId);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting wallet:", error);
      res.status(500).json({ error: "Failed to delete wallet" });
    }
  });

  app.post("/api/wallets/:id/sync", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const walletId = req.params.id as string;
      
      const wallet = await storage.getWallet(walletId, userId);
      if (!wallet) {
        return res.status(404).json({ error: "Wallet not found" });
      }

      const { fetchTransactions, isAlchemyConfigured, ALCHEMY_SUPPORTED_CHAINS } = await import("./services/alchemy");
      const { fetchTransactionsViaEtherscan, isEtherscanConfigured, ETHERSCAN_SUPPORTED_CHAINS } = await import("./services/etherscan");

      const useAlchemy = isAlchemyConfigured() && ALCHEMY_SUPPORTED_CHAINS.includes(wallet.chain);
      const useEtherscan = !useAlchemy && isEtherscanConfigured() && ETHERSCAN_SUPPORTED_CHAINS.includes(wallet.chain);

      if (!useAlchemy && !useEtherscan) {
        return res.status(400).json({
          error: "No sync provider configured for this chain",
          message: `Set ALCHEMY_API_KEY (chains: ${ALCHEMY_SUPPORTED_CHAINS.join(", ")}) or ETHERSCAN_API_KEY (chains: ${ETHERSCAN_SUPPORTED_CHAINS.join(", ")}).`,
        });
      }

      const result = useAlchemy
        ? await fetchTransactions(wallet.address, wallet.chain, walletId)
        : await fetchTransactionsViaEtherscan(wallet.address, wallet.chain, walletId);
      
      if (result.error) {
        return res.status(400).json({ error: result.error });
      }

      let imported = 0;
      let skipped = 0;
      const needsReviewTxs: any[] = [];
      
      for (const tx of result.transactions) {
        const existing = await storage.getTransactionByHash(tx.txHash, userId);
        if (!existing) {
          const created = await storage.createTransaction(tx);
          imported++;
          if (created.needsReview) {
            needsReviewTxs.push(created);
          }
        } else {
          skipped++;
        }
      }

      // Send Telegram notifications for new transactions needing review
      if (needsReviewTxs.length > 0) {
        try {
          const { sendTransactionReviewNotification, isTelegramConfigured } = await import("./services/telegram");
          if (isTelegramConfigured()) {
            const telegramLink = await storage.getTelegramLink(userId);
            if (telegramLink && telegramLink.isVerified && telegramLink.notifyOnReview) {
              // Send notifications for up to 3 transactions to avoid spam
              const toNotify = needsReviewTxs.slice(0, 3);
              for (const tx of toNotify) {
                await sendTransactionReviewNotification(telegramLink.telegramChatId, tx);
              }
              if (needsReviewTxs.length > 3) {
                const { sendMessage } = await import("./services/telegram");
                await sendMessage(
                  telegramLink.telegramChatId, 
                  `...and ${needsReviewTxs.length - 3} more transactions need review. Check the app for the full list.`
                );
              }
            }
          }
        } catch (err) {
          console.error("Error sending Telegram notifications:", err);
        }
      }

      res.json({ 
        status: "sync_complete", 
        walletId,
        imported,
        skipped,
        total: result.transactions.length,
        needsReview: needsReviewTxs.length
      });
    } catch (error) {
      console.error("Error syncing wallet:", error);
      res.status(500).json({ error: "Failed to sync wallet" });
    }
  });

  // Transactions
  app.get("/api/transactions", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const filters: {
        userId: string;
        chain?: string;
        classification?: string;
        needsReview?: boolean;
      } = { userId };

      if (req.query.chain && req.query.chain !== "all") {
        filters.chain = req.query.chain as string;
      }
      if (req.query.classification && req.query.classification !== "all") {
        filters.classification = req.query.classification as string;
      }
      if (req.query.needsReview === "true") {
        filters.needsReview = true;
      }

      const transactions = await storage.getTransactions(filters);
      res.json(transactions);
    } catch (error) {
      console.error("Error fetching transactions:", error);
      res.status(500).json({ error: "Failed to fetch transactions" });
    }
  });

  app.get("/api/transactions/:id", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const transaction = await storage.getTransaction(req.params.id as string, userId);
      if (!transaction) {
        return res.status(404).json({ error: "Transaction not found" });
      }
      res.json(transaction);
    } catch (error) {
      console.error("Error fetching transaction:", error);
      res.status(500).json({ error: "Failed to fetch transaction" });
    }
  });

  app.patch("/api/transactions/:id/classify", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const { classification } = req.body;
      if (!classification) {
        return res.status(400).json({ error: "Classification is required" });
      }
      const transaction = await storage.classifyTransaction(req.params.id as string, classification, userId);
      if (!transaction) {
        return res.status(404).json({ error: "Transaction not found" });
      }
      res.json(transaction);
    } catch (error) {
      console.error("Error classifying transaction:", error);
      res.status(500).json({ error: "Failed to classify transaction" });
    }
  });

  // Classification Rules
  app.get("/api/rules", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const rules = await storage.getRules(userId);
      res.json(rules);
    } catch (error) {
      console.error("Error fetching rules:", error);
      res.status(500).json({ error: "Failed to fetch rules" });
    }
  });

  app.get("/api/rules/:id", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const rule = await storage.getRule(req.params.id as string, userId);
      if (!rule) {
        return res.status(404).json({ error: "Rule not found" });
      }
      res.json(rule);
    } catch (error) {
      console.error("Error fetching rule:", error);
      res.status(500).json({ error: "Failed to fetch rule" });
    }
  });

  app.post("/api/rules", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const parsed = insertRuleSchema.omit({ userId: true }).parse(req.body);
      const rule = await storage.createRule({ ...parsed, userId });
      res.status(201).json(rule);
    } catch (error) {
      console.error("Error creating rule:", error);
      if (error instanceof z.ZodError) {
        return res.status(400).json({ error: "Invalid rule data", details: error.errors });
      }
      res.status(500).json({ error: "Failed to create rule" });
    }
  });

  app.patch("/api/rules/:id", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const rule = await storage.updateRule(req.params.id as string, req.body, userId);
      if (!rule) {
        return res.status(404).json({ error: "Rule not found" });
      }
      res.json(rule);
    } catch (error) {
      console.error("Error updating rule:", error);
      res.status(500).json({ error: "Failed to update rule" });
    }
  });

  app.delete("/api/rules/:id", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      await storage.deleteRule(req.params.id as string, userId);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting rule:", error);
      res.status(500).json({ error: "Failed to delete rule" });
    }
  });

  // Reports
  app.get("/api/reports/summary", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const year = parseInt(req.query.year as string) || new Date().getFullYear();
      const summary = await storage.getReportSummary(year, userId);
      res.json(summary);
    } catch (error) {
      console.error("Error fetching report summary:", error);
      res.status(500).json({ error: "Failed to fetch report summary" });
    }
  });

  app.get("/api/reports/:reportId", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const { reportId } = req.params;
      const year = parseInt(req.query.year as string) || new Date().getFullYear();
      
      const summary = await storage.getReportSummary(year, userId);

      // Generate CSV content based on report type
      let csvContent = "";
      let filename = "";

      switch (reportId) {
        case "form8949":
          csvContent = "Description,Date Acquired,Date Sold,Proceeds,Cost Basis,Gain or Loss\n";
          for (const d of summary.disposals) {
            csvContent += `"${d.tokenSymbol}",` +
              `"${new Date(d.disposedAt).toISOString().split('T')[0]}",` +
              `"${new Date(d.disposedAt).toISOString().split('T')[0]}",` +
              `${d.proceedsUsd},` +
              `${d.costBasisUsd},` +
              `${d.gainLossUsd}\n`;
          }
          filename = `form8949-${year}.csv`;
          break;

        case "schedule-d":
          csvContent = "Category,Short-Term Gain,Short-Term Loss,Long-Term Gain,Long-Term Loss,Net\n";
          csvContent += `"Summary",${summary.shortTermGains},${summary.shortTermLosses},${summary.longTermGains},${summary.longTermLosses},${summary.netGainLoss}\n`;
          filename = `schedule-d-${year}.csv`;
          break;

        case "income":
          csvContent = "Type,Amount USD\n";
          csvContent += `"Total Income",${summary.totalIncome}\n`;
          filename = `income-report-${year}.csv`;
          break;

        default:
          csvContent = "Report Type,Data\n";
          csvContent += `"${reportId}","Generated for ${year}"\n`;
          filename = `${reportId}-${year}.csv`;
      }

      res.setHeader("Content-Type", "text/csv");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(csvContent);
    } catch (error) {
      console.error("Error generating report:", error);
      res.status(500).json({ error: "Failed to generate report" });
    }
  });

  // Settings
  app.get("/api/settings", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const settings = await storage.getSettings(userId);
      res.json(settings || {});
    } catch (error) {
      console.error("Error fetching settings:", error);
      res.status(500).json({ error: "Failed to fetch settings" });
    }
  });

  app.patch("/api/settings", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const settings = await storage.updateSettings(userId, req.body);
      res.json(settings);
    } catch (error) {
      console.error("Error updating settings:", error);
      res.status(500).json({ error: "Failed to update settings" });
    }
  });

  // Telegram Integration
  app.get("/api/telegram/status", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const link = await storage.getTelegramLink(userId);
      const { isTelegramConfigured } = await import("./services/telegram");
      
      res.json({
        configured: isTelegramConfigured(),
        linked: !!link,
        verified: link?.isVerified || false,
        username: link?.telegramUsername || null,
      });
    } catch (error) {
      console.error("Error getting Telegram status:", error);
      res.status(500).json({ error: "Failed to get Telegram status" });
    }
  });

  app.post("/api/telegram/link", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      const { generateVerificationCode, isTelegramConfigured } = await import("./services/telegram");
      
      if (!isTelegramConfigured()) {
        return res.status(400).json({
          error: "Telegram not configured",
          message: "Add TELEGRAM_BOT_TOKEN to your secrets to enable Telegram notifications."
        });
      }

      const existing = await storage.getTelegramLink(userId);
      if (existing && existing.isVerified) {
        return res.status(400).json({ error: "Telegram already linked" });
      }

      const verificationCode = generateVerificationCode();
      
      if (existing) {
        await storage.updateTelegramLink(userId, { verificationCode });
      } else {
        await storage.createTelegramLink({
          userId,
          telegramChatId: "",
          verificationCode,
          isVerified: false,
        });
      }

      res.json({
        verificationCode,
        instructions: "Send this code to the Open Crypto Tax bot on Telegram to verify your account."
      });
    } catch (error) {
      console.error("Error creating Telegram link:", error);
      res.status(500).json({ error: "Failed to create Telegram link" });
    }
  });

  app.delete("/api/telegram/link", isAuthenticated, async (req, res) => {
    try {
      const userId = getUserId(req);
      await storage.deleteTelegramLink(userId);
      res.status(204).send();
    } catch (error) {
      console.error("Error deleting Telegram link:", error);
      res.status(500).json({ error: "Failed to unlink Telegram" });
    }
  });

  // Telegram Webhook (no auth - verified by Telegram)
  app.post("/api/telegram/webhook", async (req, res) => {
    try {
      const { 
        parseUpdate, 
        sendVerificationSuccess, 
        sendWelcomeMessage,
        sendMessage,
        answerCallbackQuery,
        isTelegramConfigured 
      } = await import("./services/telegram");
      
      if (!isTelegramConfigured()) {
        return res.status(200).send("OK");
      }

      const update = req.body;
      const parsed = parseUpdate(update);
      
      if (!parsed) {
        return res.status(200).send("OK");
      }

      if (parsed.type === "verification" && parsed.verificationCode) {
        const link = await storage.getTelegramLinkByVerificationCode(parsed.verificationCode);
        if (link) {
          await storage.updateTelegramLink(link.userId, {
            telegramChatId: parsed.chatId,
            telegramUsername: parsed.username || null,
            isVerified: true,
            verificationCode: null,
          });
          await sendVerificationSuccess(parsed.chatId);
          await sendWelcomeMessage(parsed.chatId);
        } else {
          await sendMessage(parsed.chatId, "Invalid or expired verification code. Please generate a new one from the Open Crypto Tax app.");
        }
      }
      
      if (parsed.type === "classification" && parsed.classification) {
        const link = await storage.getTelegramLinkByChatId(parsed.chatId);
        if (link && link.isVerified) {
          if (parsed.transactionId) {
            const tx = await storage.classifyTransaction(parsed.transactionId, parsed.classification, link.userId);
            if (tx) {
              if (parsed.callbackQueryId) {
                await answerCallbackQuery(parsed.callbackQueryId, `Classified as ${parsed.classification}`);
              }
              await sendMessage(parsed.chatId, `Transaction classified as <b>${parsed.classification}</b>`, { parseMode: "HTML" });
            } else {
              await sendMessage(parsed.chatId, "Transaction not found or you don't have permission to classify it.");
            }
          } else {
            await sendMessage(parsed.chatId, "Please specify a transaction ID: <code>classify [txId] ${parsed.classification}</code>", { parseMode: "HTML" });
          }
        }
      }

      if (parsed.type === "command") {
        const link = await storage.getTelegramLinkByChatId(parsed.chatId);
        if (link && link.isVerified) {
          if (parsed.command === "status" || parsed.command === "start") {
            const stats = await storage.getDashboardStats(link.userId);
            await sendMessage(parsed.chatId, 
              `<b>Your Open Crypto Tax Status</b>

` +
              `Wallets: ${stats.totalWallets}
` +
              `Transactions: ${stats.totalTransactions}
` +
              `<b>Needs Review: ${stats.needsReview}</b>`,
              { parseMode: "HTML" }
            );
          }
          if (parsed.command === "help") {
            await sendMessage(parsed.chatId,
              `<b>Open Crypto Tax Commands</b>

` +
              `<code>status</code> - Show your stats
` +
              `<code>classify [txId] [type]</code> - Classify a transaction
` +
              `
Or just reply with a classification type (swap, income, airdrop, etc.) when prompted!`,
              { parseMode: "HTML" }
            );
          }
        }
      }

      res.status(200).send("OK");
    } catch (error) {
      console.error("Error processing Telegram webhook:", error);
      res.status(200).send("OK");
    }
  });

  return httpServer;
}
