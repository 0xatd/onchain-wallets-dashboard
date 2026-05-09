import type { Express, RequestHandler, Request } from "express";
import session from "express-session";
import connectPg from "connect-pg-simple";
import { authStorage } from "./storage";

// Local-auth mode: when AUTH_MODE=local (or no Firebase env is set), we skip
// Firebase entirely and treat every request as the LOCAL_USER_ID. This makes
// the project trivially self-hostable without Google Cloud setup.
const AUTH_MODE = (process.env.AUTH_MODE || "").toLowerCase();
const LOCAL_USER_ID = process.env.LOCAL_USER_ID || "local-user";
const LOCAL_USER_EMAIL = process.env.LOCAL_USER_EMAIL || "you@localhost";

const firebaseAvailable =
  !!process.env.FIREBASE_SERVICE_ACCOUNT ||
  !!process.env.FIREBASE_PROJECT_ID ||
  !!process.env.GOOGLE_APPLICATION_CREDENTIALS;

const useLocalAuth = AUTH_MODE === "local" || (!firebaseAvailable && AUTH_MODE !== "firebase");

let firebaseAuth: { verifyIdToken: (t: string) => Promise<any> } | null = null;

async function initFirebaseAdmin() {
  if (useLocalAuth) return null;
  if (firebaseAuth) return firebaseAuth;
  const { initializeApp, cert, getApps } = await import("firebase-admin/app");
  const { getAuth } = await import("firebase-admin/auth");
  if (getApps().length === 0) {
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      initializeApp({ credential: cert(serviceAccount) });
    } else {
      initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID });
    }
  }
  firebaseAuth = getAuth() as any;
  return firebaseAuth;
}

export function getSession() {
  const sessionTtl = 7 * 24 * 60 * 60 * 1000;
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL is required for sessions");
  }
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: true,
    ttl: sessionTtl,
    tableName: "sessions",
  });
  return session({
    secret: process.env.SESSION_SECRET || "dev-secret-change-me",
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: sessionTtl,
      sameSite: "lax",
    },
  });
}

declare global {
  namespace Express {
    interface Request {
      user?: {
        uid: string;
        email?: string;
        claims: {
          sub: string;
          email?: string;
          name?: string;
          picture?: string;
        };
      };
    }
  }
}

export async function setupAuth(app: Express) {
  app.set("trust proxy", 1);
  app.use(getSession());

  if (useLocalAuth) {
    console.log(`[auth] Local-auth mode active. All requests resolve to user="${LOCAL_USER_ID}". Set AUTH_MODE=firebase + FIREBASE_PROJECT_ID for multi-user.`);
    // Ensure the local user exists.
    try {
      await authStorage.upsertUser({
        id: LOCAL_USER_ID,
        email: LOCAL_USER_EMAIL,
        firstName: "Local",
        lastName: "User",
        profileImageUrl: null,
      });
    } catch (err) {
      console.warn("[auth] Could not upsert local user (db not ready?):", err);
    }
  } else {
    await initFirebaseAdmin();
    console.log("[auth] Firebase auth mode active.");
  }
}

export function registerAuthRoutes(app: Express) {
  app.get("/api/auth/user", isAuthenticated, async (req, res) => {
    try {
      const user = req.user!;
      res.json({
        id: user.uid,
        email: user.claims.email,
        name: user.claims.name,
        picture: user.claims.picture,
        mode: useLocalAuth ? "local" : "firebase",
      });
    } catch (error) {
      console.error("Error fetching user:", error);
      res.status(500).json({ error: "Failed to fetch user" });
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy((err) => {
      if (err) console.error("Error destroying session:", err);
      res.json({ success: true });
    });
  });
}

export const isAuthenticated: RequestHandler = async (req, res, next) => {
  // Local-auth: every request is the local user.
  if (useLocalAuth) {
    req.user = {
      uid: LOCAL_USER_ID,
      email: LOCAL_USER_EMAIL,
      claims: { sub: LOCAL_USER_ID, email: LOCAL_USER_EMAIL, name: "Local User" },
    };
    return next();
  }

  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({ message: "Unauthorized - No token provided" });
    }
    const idToken = authHeader.split("Bearer ")[1];

    // If it's an agent API token, defer to agent middleware semantics by
    // resolving against api_tokens table. Keeps `isAuthenticated` permissive
    // for any caller that holds a valid bearer credential.
    if (idToken.startsWith("octt_")) {
      const { hashApiToken } = await import("./agentToken");
      const { storage } = await import("../storage");
      const token = await storage.getApiTokenByHash(hashApiToken(idToken));
      if (!token) return res.status(401).json({ message: "Invalid API token" });
      req.user = { uid: token.userId, claims: { sub: token.userId } };
      return next();
    }

    const auth = await initFirebaseAdmin();
    if (!auth) return res.status(500).json({ message: "Auth not initialized" });
    const decodedToken = await auth.verifyIdToken(idToken);

    await authStorage.upsertUser({
      id: decodedToken.uid,
      email: decodedToken.email || null,
      firstName: decodedToken.name?.split(" ")[0] || null,
      lastName: decodedToken.name?.split(" ").slice(1).join(" ") || null,
      profileImageUrl: decodedToken.picture || null,
    });

    req.user = {
      uid: decodedToken.uid,
      email: decodedToken.email,
      claims: {
        sub: decodedToken.uid,
        email: decodedToken.email,
        name: decodedToken.name,
        picture: decodedToken.picture,
      },
    };
    next();
  } catch (error) {
    console.error("Auth error:", error);
    return res.status(401).json({ message: "Unauthorized - Invalid token" });
  }
};

export function isLocalAuthMode() {
  return useLocalAuth;
}
