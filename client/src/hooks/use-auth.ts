import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

// VITE_AUTH_MODE=local skips Firebase entirely. The server side must also be
// in local mode (AUTH_MODE=local). This is the easiest path to self-host.
const AUTH_MODE = (import.meta.env.VITE_AUTH_MODE || "").toLowerCase();
const FIREBASE_CONFIGURED = !!import.meta.env.VITE_FIREBASE_API_KEY;
const USE_LOCAL = AUTH_MODE === "local" || !FIREBASE_CONFIGURED;

type FirebaseUserShape = {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  getIdToken(): Promise<string>;
} | null;

type FirebaseModule = {
  auth: any;
  googleProvider: any;
  signInWithPopup: any;
  signOut: any;
  onAuthStateChanged: any;
};

let firebaseModule: FirebaseModule | null = null;
let firebaseInitPromise: Promise<FirebaseModule | null> | null = null;

async function getFirebase(): Promise<FirebaseModule | null> {
  if (USE_LOCAL) return null;
  if (firebaseModule) return firebaseModule;
  if (firebaseInitPromise) return firebaseInitPromise;
  firebaseInitPromise = (async () => {
    const { initializeApp, getApps } = await import("firebase/app");
    const fbAuth = await import("firebase/auth");
    const config = {
      apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
      authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
      projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
      storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
      appId: import.meta.env.VITE_FIREBASE_APP_ID,
    };
    const app = getApps().length === 0 ? initializeApp(config) : getApps()[0];
    const auth = fbAuth.getAuth(app);
    const googleProvider = new fbAuth.GoogleAuthProvider();
    firebaseModule = {
      auth,
      googleProvider,
      signInWithPopup: fbAuth.signInWithPopup,
      signOut: fbAuth.signOut,
      onAuthStateChanged: fbAuth.onAuthStateChanged,
    };
    return firebaseModule;
  })();
  return firebaseInitPromise;
}

export async function getIdToken(): Promise<string | null> {
  if (USE_LOCAL) return "local"; // server ignores in local-auth mode
  const fb = await getFirebase();
  const user = fb?.auth.currentUser;
  if (!user) return null;
  return user.getIdToken();
}

export async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const token = await getIdToken();
  if (!token) throw new Error("Not authenticated");
  return fetch(url, {
    ...options,
    headers: {
      ...options.headers,
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
}

export function useAuth() {
  const [user, setUser] = useState<FirebaseUserShape>(null);
  const [isLoading, setIsLoading] = useState(true);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (USE_LOCAL) {
      setUser({
        uid: "local-user",
        email: "you@localhost",
        displayName: "Local User",
        photoURL: null,
        getIdToken: async () => "local",
      });
      setIsLoading(false);
      return;
    }
    let unsubscribe: (() => void) | undefined;
    getFirebase().then((fb) => {
      if (!fb) { setIsLoading(false); return; }
      unsubscribe = fb.onAuthStateChanged(fb.auth, (firebaseUser: any) => {
        setUser(firebaseUser);
        setIsLoading(false);
      });
    }).catch(() => setIsLoading(false));
    return () => { if (unsubscribe) unsubscribe(); };
  }, []);

  const loginWithGoogle = async () => {
    if (USE_LOCAL) return;
    const fb = await getFirebase();
    if (!fb) throw new Error("Firebase not configured");
    await fb.signInWithPopup(fb.auth, fb.googleProvider);
  };

  const logout = async () => {
    if (USE_LOCAL) return;
    const fb = await getFirebase();
    if (fb) await fb.signOut(fb.auth);
    queryClient.clear();
  };

  return {
    user: user ? {
      id: user.uid,
      email: user.email,
      firstName: user.displayName?.split(" ")[0] || null,
      lastName: user.displayName?.split(" ").slice(1).join(" ") || null,
      profileImageUrl: user.photoURL,
    } : null,
    firebaseUser: user,
    isLoading,
    isAuthenticated: !!user,
    isLocalMode: USE_LOCAL,
    loginWithGoogle,
    logout,
  };
}
