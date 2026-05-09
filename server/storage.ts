import { eq, desc, and, or, sql, inArray, isNull } from "drizzle-orm";
import { db } from "./db";
import {
  wallets,
  transactions,
  classificationRules,
  taxLots,
  disposals,
  settings,
  telegramLinks,
  proposals,
  auditLog,
  apiTokens,
  dismissedWallets,
  type InsertWallet,
  type Wallet,
  type InsertTransaction,
  type Transaction,
  type InsertRule,
  type ClassificationRule,
  type InsertTaxLot,
  type TaxLot,
  type InsertDisposal,
  type Disposal,
  type InsertSettings,
  type Settings,
  type DashboardStats,
  type InsertTelegramLink,
  type TelegramLink,
  type Proposal,
  type InsertProposal,
  type AuditLogEntry,
  type ApiToken,
} from "../shared/schema";

export interface IStorage {
  // Wallets
  getWallets(userId: string): Promise<Wallet[]>;
  getWallet(id: string, userId: string): Promise<Wallet | undefined>;
  createWallet(wallet: InsertWallet): Promise<Wallet>;
  deleteWallet(id: string, userId: string): Promise<void>;

  // Transactions
  getTransactions(filters: { 
    userId: string;
    chain?: string; 
    classification?: string;
    needsReview?: boolean;
    walletId?: string;
  }): Promise<Transaction[]>;
  getTransaction(id: string, userId: string): Promise<Transaction | undefined>;
  getTransactionByHash(txHash: string, userId: string): Promise<Transaction | undefined>;
  createTransaction(tx: InsertTransaction): Promise<Transaction>;
  updateTransaction(id: string, data: Partial<InsertTransaction>): Promise<Transaction | undefined>;
  classifyTransaction(id: string, classification: string, userId: string): Promise<Transaction | undefined>;

  // Rules
  getRules(userId: string): Promise<ClassificationRule[]>;
  getRule(id: string, userId: string): Promise<ClassificationRule | undefined>;
  createRule(rule: InsertRule): Promise<ClassificationRule>;
  updateRule(id: string, data: Partial<InsertRule>, userId: string): Promise<ClassificationRule | undefined>;
  deleteRule(id: string, userId: string): Promise<void>;

  // Tax Lots
  getTaxLots(walletId?: string): Promise<TaxLot[]>;
  getTaxLotsForUserToken(userId: string, token: string): Promise<TaxLot[]>;
  updateTaxLotRemaining(id: string, newRemaining: string): Promise<void>;
  createTaxLot(lot: InsertTaxLot): Promise<TaxLot>;

  // Disposals
  getDisposals(year?: number, userId?: string): Promise<Disposal[]>;
  createDisposal(disposal: InsertDisposal): Promise<Disposal>;

  // Settings
  getSettings(userId: string): Promise<Settings | undefined>;
  updateSettings(userId: string, data: Partial<InsertSettings>): Promise<Settings>;

  // Telegram
  getTelegramLink(userId: string): Promise<TelegramLink | undefined>;
  getTelegramLinkByChatId(chatId: string): Promise<TelegramLink | undefined>;
  getTelegramLinkByVerificationCode(code: string): Promise<TelegramLink | undefined>;
  createTelegramLink(link: InsertTelegramLink): Promise<TelegramLink>;
  updateTelegramLink(userId: string, data: Partial<InsertTelegramLink>): Promise<TelegramLink | undefined>;
  deleteTelegramLink(userId: string): Promise<void>;
  getVerifiedTelegramLinksForNotification(): Promise<TelegramLink[]>;

  // Dashboard
  getDashboardStats(userId: string): Promise<DashboardStats>;

  // Missing cost basis — disposals or transactions where basis is unknown.
  getTransactionsMissingBasis(userId: string, limit?: number): Promise<Transaction[]>;

  // Proposals
  createProposal(p: InsertProposal): Promise<Proposal>;
  getProposal(id: string, userId: string): Promise<Proposal | undefined>;
  getProposalByIdempotencyKey(userId: string, key: string): Promise<Proposal | undefined>;
  listProposals(userId: string, status?: string): Promise<Proposal[]>;
  updateProposalStatus(id: string, userId: string, patch: Partial<Proposal>): Promise<Proposal | undefined>;

  // Audit log
  appendAudit(entry: Omit<AuditLogEntry, "id" | "createdAt">): Promise<AuditLogEntry>;
  listAudit(userId: string, limit?: number): Promise<AuditLogEntry[]>;

  // API tokens
  createApiToken(userId: string, name: string, tokenHash: string, tokenPrefix: string, scopes: string[], opts?: { autoApprove?: boolean; autoApproveThreshold?: string; expiresAt?: Date }): Promise<ApiToken>;
  getApiTokenByHash(tokenHash: string): Promise<ApiToken | undefined>;
  listApiTokens(userId: string): Promise<ApiToken[]>;
  revokeApiToken(id: string, userId: string): Promise<void>;
  touchApiToken(id: string): Promise<void>;

  // Dismissed wallets (suggestions the user said "not mine" to)
  listDismissedWallets(userId: string): Promise<string[]>;
  addDismissedWallet(userId: string, address: string, reason?: string): Promise<void>;

  // Wallet discovery
  getWalletSuggestions(userId: string, limit?: number): Promise<any[]>;
  getTransferPairCandidates(userId: string, limit?: number): Promise<any[]>;

  // Agent work queue
  getAgentWork(userId: string): Promise<{
    missingBasisCount: number;
    needsReviewCount: number;
    pendingProposalsCount: number;
    walletSuggestionsCount: number;
    transferPairCandidatesCount: number;
    missingBasis: Transaction[];
    needsReview: Transaction[];
    pendingProposals: Proposal[];
    walletSuggestions: any[];
    transferPairCandidates: any[];
  }>;

  // Reports
  getReportSummary(year: number, userId: string): Promise<{
    totalDisposals: number;
    shortTermGains: string;
    shortTermLosses: string;
    longTermGains: string;
    longTermLosses: string;
    netGainLoss: string;
    totalIncome: string;
    needsReviewCount: number;
    disposals: Disposal[];
  }>;
}

export class DatabaseStorage implements IStorage {
  // Wallets
  async getWallets(userId: string): Promise<Wallet[]> {
    return await db.select().from(wallets)
      .where(eq(wallets.userId, userId))
      .orderBy(desc(wallets.createdAt));
  }

  async getWallet(id: string, userId: string): Promise<Wallet | undefined> {
    const result = await db.select().from(wallets)
      .where(and(eq(wallets.id, id), eq(wallets.userId, userId)));
    return result[0];
  }

  async createWallet(wallet: InsertWallet): Promise<Wallet> {
    const result = await db.insert(wallets).values(wallet).returning();
    return result[0];
  }

  async deleteWallet(id: string, userId: string): Promise<void> {
    await db.delete(wallets).where(and(eq(wallets.id, id), eq(wallets.userId, userId)));
  }

  // Transactions - Get user's wallet IDs first, then filter transactions by those wallets
  async getTransactions(filters: { 
    userId: string;
    chain?: string; 
    classification?: string;
    needsReview?: boolean;
    walletId?: string;
  }): Promise<Transaction[]> {
    // Get user's wallet IDs
    const userWallets = await db.select({ id: wallets.id })
      .from(wallets)
      .where(eq(wallets.userId, filters.userId));
    
    const walletIds = userWallets.map(w => w.id);
    if (walletIds.length === 0) {
      return [];
    }
    
    const conditions = [inArray(transactions.walletId, walletIds)];
    
    if (filters?.chain && filters.chain !== "all") {
      conditions.push(eq(transactions.chain, filters.chain));
    }
    if (filters?.classification && filters.classification !== "all") {
      conditions.push(eq(transactions.classification, filters.classification));
    }
    if (filters?.needsReview) {
      conditions.push(eq(transactions.needsReview, true));
    }
    if (filters?.walletId) {
      conditions.push(eq(transactions.walletId, filters.walletId));
    }

    return await db.select()
      .from(transactions)
      .where(and(...conditions))
      .orderBy(desc(transactions.timestamp));
  }

  async getTransaction(id: string, userId: string): Promise<Transaction | undefined> {
    // Verify the transaction belongs to the user's wallet
    const userWallets = await db.select({ id: wallets.id })
      .from(wallets)
      .where(eq(wallets.userId, userId));
    
    const walletIds = userWallets.map(w => w.id);
    if (walletIds.length === 0) return undefined;
    
    const result = await db.select().from(transactions)
      .where(and(
        eq(transactions.id, id),
        inArray(transactions.walletId, walletIds)
      ));
    return result[0];
  }

  async getTransactionByHash(txHash: string, userId: string): Promise<Transaction | undefined> {
    const userWallets = await db.select({ id: wallets.id })
      .from(wallets)
      .where(eq(wallets.userId, userId));
    
    const walletIds = userWallets.map(w => w.id);
    if (walletIds.length === 0) return undefined;
    
    const result = await db.select().from(transactions)
      .where(and(
        eq(transactions.txHash, txHash),
        inArray(transactions.walletId, walletIds)
      ));
    return result[0];
  }

  async createTransaction(tx: InsertTransaction): Promise<Transaction> {
    const result = await db.insert(transactions).values(tx).returning();
    return result[0];
  }

  async updateTransaction(id: string, data: Partial<InsertTransaction>): Promise<Transaction | undefined> {
    const result = await db.update(transactions)
      .set(data)
      .where(eq(transactions.id, id))
      .returning();
    return result[0];
  }

  async classifyTransaction(id: string, classification: string, userId: string): Promise<Transaction | undefined> {
    // Verify transaction belongs to user first
    const tx = await this.getTransaction(id, userId);
    if (!tx) return undefined;
    
    const result = await db.update(transactions)
      .set({ 
        classification, 
        needsReview: false, 
        userClassified: true,
        classificationConfidence: "1.0"
      })
      .where(eq(transactions.id, id))
      .returning();
    return result[0];
  }

  // Rules
  async getRules(userId: string): Promise<ClassificationRule[]> {
    return await db.select().from(classificationRules)
      .where(eq(classificationRules.userId, userId))
      .orderBy(desc(classificationRules.priority));
  }

  async getRule(id: string, userId: string): Promise<ClassificationRule | undefined> {
    const result = await db.select().from(classificationRules)
      .where(and(eq(classificationRules.id, id), eq(classificationRules.userId, userId)));
    return result[0];
  }

  async createRule(rule: InsertRule): Promise<ClassificationRule> {
    const result = await db.insert(classificationRules).values(rule).returning();
    return result[0];
  }

  async updateRule(id: string, data: Partial<InsertRule>, userId: string): Promise<ClassificationRule | undefined> {
    const result = await db.update(classificationRules)
      .set(data)
      .where(and(eq(classificationRules.id, id), eq(classificationRules.userId, userId)))
      .returning();
    return result[0];
  }

  async deleteRule(id: string, userId: string): Promise<void> {
    await db.delete(classificationRules).where(
      and(eq(classificationRules.id, id), eq(classificationRules.userId, userId))
    );
  }

  // Tax Lots
  async getTaxLots(walletId?: string): Promise<TaxLot[]> {
    if (walletId) {
      return await db.select().from(taxLots).where(eq(taxLots.walletId, walletId));
    }
    return await db.select().from(taxLots);
  }

  async getTaxLotsForUserToken(userId: string, token: string): Promise<TaxLot[]> {
    const userWallets = await db.select({ id: wallets.id })
      .from(wallets)
      .where(eq(wallets.userId, userId));
    const walletIds = userWallets.map(w => w.id);
    if (walletIds.length === 0) return [];
    return await db.select().from(taxLots)
      .where(and(inArray(taxLots.walletId, walletIds), eq(taxLots.token, token)));
  }

  async updateTaxLotRemaining(id: string, newRemaining: string): Promise<void> {
    await db.update(taxLots).set({ remainingAmount: newRemaining }).where(eq(taxLots.id, id));
  }

  async createTaxLot(lot: InsertTaxLot): Promise<TaxLot> {
    const result = await db.insert(taxLots).values(lot).returning();
    return result[0];
  }

  // Disposals
  async getDisposals(year?: number, userId?: string): Promise<Disposal[]> {
    const conditions = [];
    
    if (year) {
      const startDate = new Date(year, 0, 1);
      const endDate = new Date(year + 1, 0, 1);
      conditions.push(sql`${disposals.disposedAt} >= ${startDate}`);
      conditions.push(sql`${disposals.disposedAt} < ${endDate}`);
    }
    
    if (userId) {
      // Get user's wallet IDs, then their tax lots, then filter disposals
      const userWallets = await db.select({ id: wallets.id })
        .from(wallets)
        .where(eq(wallets.userId, userId));
      
      const walletIds = userWallets.map(w => w.id);
      if (walletIds.length === 0) return [];
      
      const userTaxLots = await db.select({ id: taxLots.id })
        .from(taxLots)
        .where(inArray(taxLots.walletId, walletIds));
      
      const taxLotIds = userTaxLots.map(t => t.id);
      if (taxLotIds.length === 0) return [];
      
      conditions.push(inArray(disposals.taxLotId, taxLotIds));
    }
    
    if (conditions.length > 0) {
      return await db.select()
        .from(disposals)
        .where(and(...conditions))
        .orderBy(desc(disposals.disposedAt));
    }
    
    return await db.select().from(disposals).orderBy(desc(disposals.disposedAt));
  }

  async createDisposal(disposal: InsertDisposal): Promise<Disposal> {
    const result = await db.insert(disposals).values(disposal).returning();
    return result[0];
  }

  // Settings
  async getSettings(userId: string): Promise<Settings | undefined> {
    const result = await db.select().from(settings).where(eq(settings.userId, userId)).limit(1);
    return result[0];
  }

  async updateSettings(userId: string, data: Partial<InsertSettings>): Promise<Settings> {
    const existing = await this.getSettings(userId);
    if (existing) {
      const result = await db.update(settings)
        .set(data)
        .where(eq(settings.userId, userId))
        .returning();
      return result[0];
    }
    const result = await db.insert(settings).values({ ...data, userId }).returning();
    return result[0];
  }

  // Telegram
  async getTelegramLink(userId: string): Promise<TelegramLink | undefined> {
    const result = await db.select().from(telegramLinks).where(eq(telegramLinks.userId, userId)).limit(1);
    return result[0];
  }

  async getTelegramLinkByChatId(chatId: string): Promise<TelegramLink | undefined> {
    const result = await db.select().from(telegramLinks).where(eq(telegramLinks.telegramChatId, chatId)).limit(1);
    return result[0];
  }

  async getTelegramLinkByVerificationCode(code: string): Promise<TelegramLink | undefined> {
    const result = await db.select().from(telegramLinks)
      .where(and(
        eq(telegramLinks.verificationCode, code),
        eq(telegramLinks.isVerified, false)
      ))
      .limit(1);
    return result[0];
  }

  async createTelegramLink(link: InsertTelegramLink): Promise<TelegramLink> {
    const result = await db.insert(telegramLinks).values(link).returning();
    return result[0];
  }

  async updateTelegramLink(userId: string, data: Partial<InsertTelegramLink>): Promise<TelegramLink | undefined> {
    const result = await db.update(telegramLinks)
      .set(data)
      .where(eq(telegramLinks.userId, userId))
      .returning();
    return result[0];
  }

  async deleteTelegramLink(userId: string): Promise<void> {
    await db.delete(telegramLinks).where(eq(telegramLinks.userId, userId));
  }

  async getVerifiedTelegramLinksForNotification(): Promise<TelegramLink[]> {
    return await db.select().from(telegramLinks)
      .where(and(
        eq(telegramLinks.isVerified, true),
        eq(telegramLinks.notifyOnReview, true)
      ));
  }

  // Dashboard
  async getDashboardStats(userId: string): Promise<DashboardStats> {
    const [walletCount] = await db.select({ count: sql<number>`count(*)` })
      .from(wallets)
      .where(eq(wallets.userId, userId));
    
    // Get user's wallets
    const userWallets = await db.select({ id: wallets.id })
      .from(wallets)
      .where(eq(wallets.userId, userId));
    
    const walletIds = userWallets.map(w => w.id);
    
    if (walletIds.length === 0) {
      return {
        totalWallets: 0,
        totalTransactions: 0,
        needsReview: 0,
        totalValueUsd: "0.00",
        realizedGains: "0.00",
        realizedLosses: "0.00",
        unrealizedGains: "0.00",
        chainBreakdown: [],
        classificationBreakdown: [],
        recentTransactions: [],
      };
    }
    
    const [txCount] = await db.select({ count: sql<number>`count(*)` })
      .from(transactions)
      .where(inArray(transactions.walletId, walletIds));
    
    const [reviewCount] = await db.select({ count: sql<number>`count(*)` })
      .from(transactions)
      .where(and(
        inArray(transactions.walletId, walletIds),
        eq(transactions.needsReview, true)
      ));

    const recentTxs = await db.select()
      .from(transactions)
      .where(inArray(transactions.walletId, walletIds))
      .orderBy(desc(transactions.timestamp))
      .limit(5);

    // Calculate gains from user's disposals
    const allDisposals = await this.getDisposals(undefined, userId);
    let totalGains = 0;
    let totalLosses = 0;
    for (const d of allDisposals) {
      const gainLoss = parseFloat(d.gainLossUsd);
      if (gainLoss >= 0) {
        totalGains += gainLoss;
      } else {
        totalLosses += Math.abs(gainLoss);
      }
    }

    // Calculate chain breakdown
    const chainData = await db.select({
      chain: transactions.chain,
      count: sql<number>`count(*)`,
      value: sql<string>`COALESCE(sum(${transactions.valueUsd}), 0)`,
    })
      .from(transactions)
      .where(inArray(transactions.walletId, walletIds))
      .groupBy(transactions.chain);

    // Calculate classification breakdown
    const classificationData = await db.select({
      classification: transactions.classification,
      count: sql<number>`count(*)`,
    })
      .from(transactions)
      .where(inArray(transactions.walletId, walletIds))
      .groupBy(transactions.classification);

    return {
      totalWallets: Number(walletCount.count),
      totalTransactions: Number(txCount.count),
      needsReview: Number(reviewCount.count),
      totalValueUsd: "0.00",
      realizedGains: totalGains.toFixed(2),
      realizedLosses: totalLosses.toFixed(2),
      unrealizedGains: "0.00",
      chainBreakdown: chainData.map(c => ({
        chain: c.chain,
        count: Number(c.count),
        value: c.value || "0",
      })),
      classificationBreakdown: classificationData.map(c => ({
        classification: c.classification || "unknown",
        count: Number(c.count),
      })),
      recentTransactions: recentTxs,
    };
  }

  // Reports
  async getReportSummary(year: number, userId: string): Promise<{
    totalDisposals: number;
    shortTermGains: string;
    shortTermLosses: string;
    longTermGains: string;
    longTermLosses: string;
    netGainLoss: string;
    totalIncome: string;
    needsReviewCount: number;
    disposals: Disposal[];
  }> {
    const yearDisposals = await this.getDisposals(year, userId);
    
    // Get user's wallets for transaction queries
    const userWallets = await db.select({ id: wallets.id })
      .from(wallets)
      .where(eq(wallets.userId, userId));
    
    const walletIds = userWallets.map(w => w.id);
    
    let reviewCount = { count: 0 };
    if (walletIds.length > 0) {
      [reviewCount] = await db.select({ count: sql<number>`count(*)` })
        .from(transactions)
        .where(and(
          inArray(transactions.walletId, walletIds),
          eq(transactions.needsReview, true)
        ));
    }

    let shortTermGains = 0;
    let shortTermLosses = 0;
    let longTermGains = 0;
    let longTermLosses = 0;

    for (const d of yearDisposals) {
      const gainLoss = parseFloat(d.gainLossUsd);
      if (d.isShortTerm) {
        if (gainLoss >= 0) {
          shortTermGains += gainLoss;
        } else {
          shortTermLosses += Math.abs(gainLoss);
        }
      } else {
        if (gainLoss >= 0) {
          longTermGains += gainLoss;
        } else {
          longTermLosses += Math.abs(gainLoss);
        }
      }
    }

    // Calculate income from reward/airdrop transactions
    let totalIncome = 0;
    if (walletIds.length > 0) {
      const incomeTransactions = await db.select()
        .from(transactions)
        .where(
          and(
            inArray(transactions.walletId, walletIds),
            sql`${transactions.classification} IN ('reward', 'airdrop', 'interest', 'income')`,
            sql`${transactions.timestamp} >= ${new Date(year, 0, 1)}`,
            sql`${transactions.timestamp} < ${new Date(year + 1, 0, 1)}`
          )
        );

      for (const tx of incomeTransactions) {
        if (tx.valueUsd) {
          totalIncome += parseFloat(tx.valueUsd);
        }
      }
    }

    const netGainLoss = (shortTermGains - shortTermLosses) + (longTermGains - longTermLosses);

    return {
      totalDisposals: yearDisposals.length,
      shortTermGains: shortTermGains.toFixed(2),
      shortTermLosses: shortTermLosses.toFixed(2),
      longTermGains: longTermGains.toFixed(2),
      longTermLosses: longTermLosses.toFixed(2),
      netGainLoss: netGainLoss.toFixed(2),
      totalIncome: totalIncome.toFixed(2),
      needsReviewCount: Number(reviewCount.count),
      disposals: yearDisposals,
    };
  }

  // ---------- Missing cost basis ----------
  async getTransactionsMissingBasis(userId: string, limit = 100): Promise<Transaction[]> {
    const userWallets = await db.select({ id: wallets.id })
      .from(wallets)
      .where(eq(wallets.userId, userId));
    const walletIds = userWallets.map(w => w.id);
    if (walletIds.length === 0) return [];

    // Disposals (token_out present) without a USD value AND without an explicit basis source.
    return await db.select()
      .from(transactions)
      .where(and(
        inArray(transactions.walletId, walletIds),
        sql`${transactions.tokenOut} IS NOT NULL`,
        or(isNull(transactions.valueUsd), eq(transactions.valueUsd, sql`0`)),
        isNull(transactions.basisSource),
      ))
      .orderBy(desc(transactions.timestamp))
      .limit(limit);
  }

  // ---------- Proposals ----------
  async createProposal(p: InsertProposal): Promise<Proposal> {
    const [row] = await db.insert(proposals).values(p).returning();
    return row;
  }

  async getProposal(id: string, userId: string): Promise<Proposal | undefined> {
    const [row] = await db.select().from(proposals)
      .where(and(eq(proposals.id, id), eq(proposals.userId, userId)));
    return row;
  }

  async getProposalByIdempotencyKey(userId: string, key: string): Promise<Proposal | undefined> {
    const [row] = await db.select().from(proposals)
      .where(and(eq(proposals.userId, userId), eq(proposals.idempotencyKey, key)));
    return row;
  }

  async listProposals(userId: string, status?: string): Promise<Proposal[]> {
    const conditions = [eq(proposals.userId, userId)];
    if (status) conditions.push(eq(proposals.status, status));
    return await db.select().from(proposals)
      .where(and(...conditions))
      .orderBy(desc(proposals.createdAt));
  }

  async updateProposalStatus(id: string, userId: string, patch: Partial<Proposal>): Promise<Proposal | undefined> {
    const [row] = await db.update(proposals)
      .set(patch)
      .where(and(eq(proposals.id, id), eq(proposals.userId, userId)))
      .returning();
    return row;
  }

  // ---------- Audit log ----------
  async appendAudit(entry: Omit<AuditLogEntry, "id" | "createdAt">): Promise<AuditLogEntry> {
    const [row] = await db.insert(auditLog).values(entry).returning();
    return row;
  }

  async listAudit(userId: string, limit = 200): Promise<AuditLogEntry[]> {
    return await db.select().from(auditLog)
      .where(eq(auditLog.userId, userId))
      .orderBy(desc(auditLog.createdAt))
      .limit(limit);
  }

  // ---------- API tokens ----------
  async createApiToken(
    userId: string,
    name: string,
    tokenHash: string,
    tokenPrefix: string,
    scopes: string[],
    opts: { autoApprove?: boolean; autoApproveThreshold?: string; expiresAt?: Date } = {}
  ): Promise<ApiToken> {
    const [row] = await db.insert(apiTokens).values({
      userId,
      name,
      tokenHash,
      tokenPrefix,
      scopes: scopes as any,
      autoApprove: opts.autoApprove ?? false,
      autoApproveThreshold: opts.autoApproveThreshold,
      expiresAt: opts.expiresAt,
    }).returning();
    return row;
  }

  async getApiTokenByHash(tokenHash: string): Promise<ApiToken | undefined> {
    const [row] = await db.select().from(apiTokens)
      .where(and(eq(apiTokens.tokenHash, tokenHash), isNull(apiTokens.revokedAt)));
    return row;
  }

  async listApiTokens(userId: string): Promise<ApiToken[]> {
    return await db.select().from(apiTokens)
      .where(eq(apiTokens.userId, userId))
      .orderBy(desc(apiTokens.createdAt));
  }

  async revokeApiToken(id: string, userId: string): Promise<void> {
    await db.update(apiTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(apiTokens.id, id), eq(apiTokens.userId, userId)));
  }

  async touchApiToken(id: string): Promise<void> {
    await db.update(apiTokens)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiTokens.id, id));
  }

  // ---------- Dismissed wallets ----------
  async listDismissedWallets(userId: string): Promise<string[]> {
    const rows = await db.select({ address: dismissedWallets.address })
      .from(dismissedWallets)
      .where(eq(dismissedWallets.userId, userId));
    return rows.map(r => r.address.toLowerCase());
  }

  async addDismissedWallet(userId: string, address: string, reason?: string): Promise<void> {
    await db.insert(dismissedWallets).values({
      userId,
      address: address.toLowerCase(),
      reason: reason || null,
    });
  }

  // ---------- Agent work queue ----------
  async getAgentWork(userId: string) {
    const [missingBasis, needsReview, pendingProposals, walletSuggestions, transferPairCandidates] = await Promise.all([
      this.getTransactionsMissingBasis(userId, 50),
      this.getTransactions({ userId, needsReview: true }),
      this.listProposals(userId, "pending"),
      this.getWalletSuggestions(userId, 25),
      this.getTransferPairCandidates(userId, 25),
    ]);
    return {
      missingBasisCount: missingBasis.length,
      needsReviewCount: needsReview.length,
      pendingProposalsCount: pendingProposals.length,
      walletSuggestionsCount: walletSuggestions.length,
      transferPairCandidatesCount: transferPairCandidates.length,
      missingBasis: missingBasis.slice(0, 25),
      needsReview: needsReview.slice(0, 25),
      pendingProposals: pendingProposals.slice(0, 25),
      walletSuggestions,
      transferPairCandidates,
    };
  }

  // ---------- Wallet discovery ----------
  async getWalletSuggestions(userId: string, limit = 25) {
    const { suggestWallets } = await import("./services/walletSuggestions");
    const [txs, ws, dismissed] = await Promise.all([
      this.getTransactions({ userId }),
      this.getWallets(userId),
      this.listDismissedWallets(userId),
    ]);
    const dismissedSet = new Set(dismissed);
    return suggestWallets(txs, ws)
      .filter(s => !dismissedSet.has(s.address))
      .slice(0, limit);
  }

  async getTransferPairCandidates(userId: string, limit = 25) {
    const { findTransferPairCandidates } = await import("./services/walletSuggestions");
    const txs = await this.getTransactions({ userId });
    return findTransferPairCandidates(txs).slice(0, limit);
  }
}

export const storage = new DatabaseStorage();
