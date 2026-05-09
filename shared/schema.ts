import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, decimal, boolean, integer, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// Export auth schema
export * from "./models/auth";

// Supported blockchain networks
export const SUPPORTED_CHAINS = [
  "ethereum",
  "arbitrum", 
  "optimism",
  "base",
  "polygon",
  "solana",
  "bitcoin",
  "avalanche",
  "bsc"
] as const;

export type Chain = typeof SUPPORTED_CHAINS[number];

// Transaction classification types
export const CLASSIFICATION_TYPES = [
  "swap",
  "lp_deposit",
  "lp_withdraw",
  "stake",
  "unstake",
  "borrow",
  "repay",
  "bridge",
  "airdrop",
  "vesting",
  "nft_mint",
  "nft_sale",
  "reward",
  "interest",
  "liquidation",
  "wrap",
  "unwrap",
  "migration",
  "self_transfer",
  "income",
  "expense",
  "unknown"
] as const;

export type ClassificationType = typeof CLASSIFICATION_TYPES[number];

// Cost basis methods
export const LOT_METHODS = ["fifo", "lifo", "hifo", "specific_id"] as const;
export type LotMethod = typeof LOT_METHODS[number];

// Wallets table
export const wallets = pgTable("wallets", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  address: text("address").notNull(),
  chain: text("chain").notNull(),
  label: text("label"),
  entityType: text("entity_type").default("personal"),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertWalletSchema = createInsertSchema(wallets).omit({ 
  id: true, 
  createdAt: true 
});

export type InsertWallet = z.infer<typeof insertWalletSchema>;
export type Wallet = typeof wallets.$inferSelect;

// Transactions table
export const transactions = pgTable("transactions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  walletId: varchar("wallet_id").references(() => wallets.id),
  txHash: text("tx_hash").notNull(),
  chain: text("chain").notNull(),
  timestamp: timestamp("timestamp").notNull(),
  blockNumber: integer("block_number"),
  
  // Token movements
  tokenIn: text("token_in"),
  tokenInAmount: decimal("token_in_amount", { precision: 38, scale: 18 }),
  tokenInSymbol: text("token_in_symbol"),
  tokenOut: text("token_out"),
  tokenOutAmount: decimal("token_out_amount", { precision: 38, scale: 18 }),
  tokenOutSymbol: text("token_out_symbol"),
  
  // Classification
  classification: text("classification").default("unknown"),
  classificationConfidence: decimal("classification_confidence", { precision: 5, scale: 4 }),
  needsReview: boolean("needs_review").default(false),
  userClassified: boolean("user_classified").default(false),
  
  // Contract interaction
  contractAddress: text("contract_address"),
  methodName: text("method_name"),
  
  // Fees
  gasFee: decimal("gas_fee", { precision: 38, scale: 18 }),
  gasFeeUsd: decimal("gas_fee_usd", { precision: 20, scale: 2 }),
  
  // Pricing
  priceAtTime: decimal("price_at_time", { precision: 20, scale: 8 }),
  valueUsd: decimal("value_usd", { precision: 20, scale: 2 }),

  // Cost basis provenance (set when an agent or human supplies missing basis)
  basisSource: text("basis_source"),
  basisEvidenceUrl: text("basis_evidence_url"),
  basisSetBy: text("basis_set_by"),
  basisSetAt: timestamp("basis_set_at"),
  basisNotes: text("basis_notes"),

  // Flags
  isSpam: boolean("is_spam").default(false),
  isDust: boolean("is_dust").default(false),

  createdAt: timestamp("created_at").defaultNow(),
});

export const insertTransactionSchema = createInsertSchema(transactions).omit({ 
  id: true, 
  createdAt: true 
});

export type InsertTransaction = z.infer<typeof insertTransactionSchema>;
export type Transaction = typeof transactions.$inferSelect;

// Classification rules table
export const classificationRules = pgTable("classification_rules", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  
  // Matching criteria
  contractAddress: text("contract_address"),
  methodSignature: text("method_signature"),
  tokenPattern: text("token_pattern"),
  chain: text("chain"),
  direction: text("direction"),
  
  // Result
  classification: text("classification").notNull(),
  priority: integer("priority").default(0),
  isActive: boolean("is_active").default(true),
  
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertRuleSchema = createInsertSchema(classificationRules).omit({ 
  id: true, 
  createdAt: true 
});

export type InsertRule = z.infer<typeof insertRuleSchema>;
export type ClassificationRule = typeof classificationRules.$inferSelect;

// Tax lots for cost basis tracking
export const taxLots = pgTable("tax_lots", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  walletId: varchar("wallet_id").references(() => wallets.id),
  transactionId: varchar("transaction_id").references(() => transactions.id),
  
  token: text("token").notNull(),
  tokenSymbol: text("token_symbol").notNull(),
  amount: decimal("amount", { precision: 38, scale: 18 }).notNull(),
  remainingAmount: decimal("remaining_amount", { precision: 38, scale: 18 }).notNull(),
  costBasisUsd: decimal("cost_basis_usd", { precision: 20, scale: 2 }).notNull(),
  acquiredAt: timestamp("acquired_at").notNull(),

  // Provenance: where did this cost basis number come from?
  basisSource: text("basis_source"),
  basisEvidenceUrl: text("basis_evidence_url"),
  basisSetBy: text("basis_set_by"),
  basisSetAt: timestamp("basis_set_at"),
  basisNotes: text("basis_notes"),

  createdAt: timestamp("created_at").defaultNow(),
});

export const insertTaxLotSchema = createInsertSchema(taxLots).omit({ 
  id: true, 
  createdAt: true 
});

export type InsertTaxLot = z.infer<typeof insertTaxLotSchema>;
export type TaxLot = typeof taxLots.$inferSelect;

// Disposals for realized gains/losses
export const disposals = pgTable("disposals", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  taxLotId: varchar("tax_lot_id").references(() => taxLots.id),
  transactionId: varchar("transaction_id").references(() => transactions.id),
  
  token: text("token").notNull(),
  tokenSymbol: text("token_symbol").notNull(),
  amount: decimal("amount", { precision: 38, scale: 18 }).notNull(),
  proceedsUsd: decimal("proceeds_usd", { precision: 20, scale: 2 }).notNull(),
  costBasisUsd: decimal("cost_basis_usd", { precision: 20, scale: 2 }).notNull(),
  gainLossUsd: decimal("gain_loss_usd", { precision: 20, scale: 2 }).notNull(),
  isShortTerm: boolean("is_short_term").default(true),
  disposedAt: timestamp("disposed_at").notNull(),
  
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertDisposalSchema = createInsertSchema(disposals).omit({ 
  id: true, 
  createdAt: true 
});

export type InsertDisposal = z.infer<typeof insertDisposalSchema>;
export type Disposal = typeof disposals.$inferSelect;

// Settings table
export const settings = pgTable("settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().unique(),
  taxYear: integer("tax_year").default(2024),
  lotMethod: text("lot_method").default("fifo"),
  baseCurrency: text("base_currency").default("USD"),
  country: text("country").default("US"),
  showSpam: boolean("show_spam").default(false),
  showDust: boolean("show_dust").default(true),
  dustThreshold: decimal("dust_threshold", { precision: 20, scale: 2 }).default("1.00"),
});

export const insertSettingsSchema = createInsertSchema(settings).omit({ 
  id: true 
});

export type InsertSettings = z.infer<typeof insertSettingsSchema>;
export type Settings = typeof settings.$inferSelect;

// Telegram links for notifications
export const telegramLinks = pgTable("telegram_links", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().unique(),
  telegramChatId: varchar("telegram_chat_id").notNull().unique(),
  telegramUsername: text("telegram_username"),
  verificationCode: varchar("verification_code"),
  isVerified: boolean("is_verified").default(false),
  notifyOnNewTx: boolean("notify_on_new_tx").default(true),
  notifyOnReview: boolean("notify_on_review").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  verifiedAt: timestamp("verified_at"),
});

export const insertTelegramLinkSchema = createInsertSchema(telegramLinks).omit({ 
  id: true, 
  createdAt: true,
  verifiedAt: true 
});

export type InsertTelegramLink = z.infer<typeof insertTelegramLinkSchema>;
export type TelegramLink = typeof telegramLinks.$inferSelect;

// Agent / human proposals — every agent write goes through this approval workflow.
export const PROPOSAL_ACTIONS = [
  "set_cost_basis",
  "classify_transaction",
  "link_transfer_pair",
  "merge_duplicate_txs",
  "create_tax_lot",
  "mark_reviewed",
] as const;
export type ProposalAction = typeof PROPOSAL_ACTIONS[number];

export const PROPOSAL_STATUSES = ["pending", "approved", "rejected", "applied", "failed"] as const;
export type ProposalStatus = typeof PROPOSAL_STATUSES[number];

export const proposals = pgTable("proposals", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  actor: text("actor").notNull(), // "agent:<token-name>" or "user:<id>"
  actorType: text("actor_type").notNull().default("agent"),
  action: text("action").notNull(),
  targetType: text("target_type").notNull(), // "transaction" | "tax_lot" | etc.
  targetId: varchar("target_id"),
  payload: jsonb("payload").notNull(),
  reasoning: text("reasoning"),
  evidenceUrl: text("evidence_url"),
  confidence: decimal("confidence", { precision: 5, scale: 4 }),
  status: text("status").notNull().default("pending"),
  idempotencyKey: text("idempotency_key"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow(),
  decidedAt: timestamp("decided_at"),
  decidedBy: text("decided_by"),
  appliedAt: timestamp("applied_at"),
});

export const insertProposalSchema = createInsertSchema(proposals).omit({
  id: true,
  createdAt: true,
  decidedAt: true,
  appliedAt: true,
});

export type InsertProposal = z.infer<typeof insertProposalSchema>;
export type Proposal = typeof proposals.$inferSelect;

// Append-only audit log of every meaningful state change.
export const auditLog = pgTable("audit_log", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  actor: text("actor").notNull(),
  action: text("action").notNull(),
  targetType: text("target_type"),
  targetId: varchar("target_id"),
  before: jsonb("before"),
  after: jsonb("after"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type AuditLogEntry = typeof auditLog.$inferSelect;

// API tokens scoped per user — used by AI agents and the MCP server.
export const API_TOKEN_SCOPES = [
  "read",
  "transactions:write",
  "basis:propose",
  "proposals:apply",
  "reports:read",
] as const;
export type ApiTokenScope = typeof API_TOKEN_SCOPES[number];

export const apiTokens = pgTable("api_tokens", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  name: text("name").notNull(),
  // Store SHA-256 hash of the token. Plain token returned ONCE on create.
  tokenHash: text("token_hash").notNull().unique(),
  tokenPrefix: text("token_prefix").notNull(),
  scopes: jsonb("scopes").notNull().default(sql`'[]'::jsonb`),
  // If true, proposals from this token are auto-approved when confidence >= threshold.
  autoApprove: boolean("auto_approve").default(false),
  autoApproveThreshold: decimal("auto_approve_threshold", { precision: 5, scale: 4 }),
  lastUsedAt: timestamp("last_used_at"),
  expiresAt: timestamp("expires_at"),
  revokedAt: timestamp("revoked_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type ApiToken = typeof apiTokens.$inferSelect;

// Dashboard stats type
export type DashboardStats = {
  totalWallets: number;
  totalTransactions: number;
  needsReview: number;
  totalValueUsd: string;
  realizedGains: string;
  realizedLosses: string;
  unrealizedGains: string;
  chainBreakdown: { chain: string; count: number; value: string }[];
  classificationBreakdown: { classification: string; count: number }[];
  recentTransactions: Transaction[];
};
