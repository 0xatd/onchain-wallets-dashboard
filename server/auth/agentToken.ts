import type { Request, RequestHandler } from "express";
import crypto from "crypto";
import { storage } from "../storage";
import type { ApiToken } from "../../shared/schema";

const TOKEN_PREFIX = "octt_"; // "onchain tax token"

declare global {
  namespace Express {
    interface Request {
      apiToken?: ApiToken;
    }
  }
}

export function generateApiToken(): { plain: string; hash: string; prefix: string } {
  const random = crypto.randomBytes(32).toString("base64url");
  const plain = `${TOKEN_PREFIX}${random}`;
  const hash = crypto.createHash("sha256").update(plain).digest("hex");
  const prefix = plain.slice(0, 12);
  return { plain, hash, prefix };
}

export function hashApiToken(plain: string): string {
  return crypto.createHash("sha256").update(plain).digest("hex");
}

function extractBearer(req: Request): string | undefined {
  const h = req.headers.authorization;
  if (!h?.startsWith("Bearer ")) return undefined;
  return h.slice("Bearer ".length).trim();
}

/**
 * Middleware that accepts ONLY an API token (not a Firebase ID token).
 * Use this on /api/agent/* endpoints intended for AI agents.
 */
export const requireApiToken = (requiredScopes: string[] = []): RequestHandler => {
  return async (req, res, next) => {
    const raw = extractBearer(req);
    if (!raw || !raw.startsWith(TOKEN_PREFIX)) {
      return res.status(401).json({ error: "API token required" });
    }
    const hash = hashApiToken(raw);
    const token = await storage.getApiTokenByHash(hash);
    if (!token) return res.status(401).json({ error: "Invalid or revoked API token" });
    if (token.expiresAt && token.expiresAt < new Date()) {
      return res.status(401).json({ error: "Expired API token" });
    }
    const scopes = (token.scopes as string[]) || [];
    for (const s of requiredScopes) {
      if (!scopes.includes(s) && !scopes.includes("*")) {
        return res.status(403).json({ error: `Missing required scope: ${s}` });
      }
    }
    storage.touchApiToken(token.id).catch(() => {});
    req.apiToken = token;
    req.user = {
      uid: token.userId,
      claims: { sub: token.userId },
    };
    next();
  };
};
