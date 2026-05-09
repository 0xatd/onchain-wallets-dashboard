import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  MessageCircle,
  Link2,
  Unlink,
  CheckCircle,
  AlertCircle,
  Copy,
  ExternalLink,
  Bell,
  Bot,
  KeyRound,
  Trash2
} from "lucide-react";
import { useState } from "react";

interface TelegramStatus {
  configured: boolean;
  linked: boolean;
  verified: boolean;
  username: string | null;
}

interface LinkResponse {
  verificationCode: string;
  instructions: string;
}

export default function Settings() {
  const { toast } = useToast();
  const [verificationCode, setVerificationCode] = useState<string | null>(null);

  const { data: telegramStatus, isLoading } = useQuery<TelegramStatus>({
    queryKey: ["/api/telegram/status"],
  });

  const linkMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/telegram/link");
      return response.json() as Promise<LinkResponse>;
    },
    onSuccess: (data) => {
      setVerificationCode(data.verificationCode);
      queryClient.invalidateQueries({ queryKey: ["/api/telegram/status"] });
    },
    onError: async (error: Error & { response?: Response }) => {
      let message = "Failed to generate verification code.";
      try {
        if (error.response) {
          const data = await error.response.json();
          message = data.message || data.error || message;
        }
      } catch {}
      toast({
        title: "Error",
        description: message,
        variant: "destructive",
      });
    },
  });

  const unlinkMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", "/api/telegram/link");
    },
    onSuccess: () => {
      setVerificationCode(null);
      queryClient.invalidateQueries({ queryKey: ["/api/telegram/status"] });
      toast({
        title: "Telegram unlinked",
        description: "You will no longer receive notifications on Telegram.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to unlink Telegram. Please try again.",
        variant: "destructive",
      });
    },
  });

  const copyCode = () => {
    if (verificationCode) {
      navigator.clipboard.writeText(verificationCode);
      toast({
        title: "Copied!",
        description: "Verification code copied to clipboard.",
      });
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-muted-foreground">
          Manage your account settings and integrations
        </p>
      </div>

      <Card data-testid="card-telegram-settings">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-blue-500/10">
              <MessageCircle className="h-5 w-5 text-blue-500" />
            </div>
            <div>
              <CardTitle className="flex items-center gap-2">
                Telegram Notifications
                {telegramStatus?.verified && (
                  <Badge variant="outline" className="text-green-600 border-green-600">
                    <CheckCircle className="h-3 w-3 mr-1" />
                    Connected
                  </Badge>
                )}
              </CardTitle>
              <CardDescription>
                Get instant notifications when transactions need classification
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-10 w-32" />
            </div>
          ) : !telegramStatus?.configured ? (
            <div className="flex items-start gap-3 p-4 rounded-lg bg-amber-500/10 border border-amber-500/20">
              <AlertCircle className="h-5 w-5 text-amber-500 mt-0.5" />
              <div>
                <p className="font-medium text-amber-600 dark:text-amber-400">Telegram Bot Not Configured</p>
                <p className="text-sm text-muted-foreground mt-1">
                  To enable Telegram notifications, add TELEGRAM_BOT_TOKEN to your secrets.
                  Create a bot via @BotFather on Telegram to get your token.
                </p>
              </div>
            </div>
          ) : telegramStatus?.verified ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 rounded-lg bg-green-500/10 border border-green-500/20">
                <div className="flex items-center gap-3">
                  <CheckCircle className="h-5 w-5 text-green-500" />
                  <div>
                    <p className="font-medium text-green-600 dark:text-green-400">
                      Connected to Telegram
                    </p>
                    {telegramStatus.username && (
                      <p className="text-sm text-muted-foreground">
                        @{telegramStatus.username}
                      </p>
                    )}
                  </div>
                </div>
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => unlinkMutation.mutate()}
                  disabled={unlinkMutation.isPending}
                  data-testid="button-unlink-telegram"
                >
                  <Unlink className="h-4 w-4 mr-2" />
                  Unlink
                </Button>
              </div>
              
              <div className="space-y-2">
                <h4 className="font-medium flex items-center gap-2">
                  <Bell className="h-4 w-4" />
                  You'll receive notifications for:
                </h4>
                <ul className="text-sm text-muted-foreground space-y-1 ml-6 list-disc">
                  <li>New transactions that need classification</li>
                  <li>Transactions flagged for review</li>
                </ul>
              </div>
            </div>
          ) : verificationCode ? (
            <div className="space-y-4">
              <div className="p-4 rounded-lg bg-muted">
                <p className="text-sm text-muted-foreground mb-3">
                  Send this code to your Telegram bot to verify your account:
                </p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 px-4 py-3 rounded-md bg-background font-mono text-2xl tracking-widest text-center border" data-testid="text-verification-code">
                    {verificationCode}
                  </code>
                  <Button variant="outline" size="icon" onClick={copyCode} data-testid="button-copy-code">
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
              
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  onClick={() => linkMutation.mutate()}
                  disabled={linkMutation.isPending}
                  data-testid="button-regenerate-code"
                >
                  Generate New Code
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => queryClient.invalidateQueries({ queryKey: ["/api/telegram/status"] })}
                >
                  I've sent the code
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Link your Telegram account to receive instant notifications when:
              </p>
              <ul className="text-sm text-muted-foreground space-y-1 ml-4 list-disc">
                <li>New transactions are synced that need classification</li>
                <li>You can classify transactions directly from Telegram</li>
              </ul>
              
              <Button 
                onClick={() => linkMutation.mutate()}
                disabled={linkMutation.isPending}
                data-testid="button-link-telegram"
              >
                <Link2 className="h-4 w-4 mr-2" />
                {linkMutation.isPending ? "Generating code..." : "Link Telegram Account"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <AgentTokensCard />
    </div>
  );
}

// ---------- Agent tokens ----------

type AgentToken = {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  autoApprove: boolean;
  autoApproveThreshold: string | null;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
};

const ALL_SCOPES = ["read", "transactions:write", "basis:propose", "proposals:apply", "reports:read"] as const;

function AgentTokensCard() {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["read", "basis:propose"]);
  const [autoApprove, setAutoApprove] = useState(false);
  const [threshold, setThreshold] = useState("0.95");
  const [createdToken, setCreatedToken] = useState<string | null>(null);

  const { data: tokens, isLoading } = useQuery<AgentToken[]>({ queryKey: ["/api/agent/tokens"] });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/agent/tokens", {
        name,
        scopes,
        autoApprove,
        autoApproveThreshold: autoApprove ? parseFloat(threshold) : undefined,
      });
      return res.json();
    },
    onSuccess: (data) => {
      setCreatedToken(data.token);
      setName("");
      queryClient.invalidateQueries({ queryKey: ["/api/agent/tokens"] });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const revokeMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/agent/tokens/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/agent/tokens"] });
      toast({ title: "Token revoked" });
    },
  });

  const toggleScope = (s: string) => {
    setScopes(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]);
  };

  const copy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied" });
  };

  return (
    <Card data-testid="card-agent-tokens">
      <CardHeader>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-blue-500/10">
            <Bot className="h-5 w-5 text-blue-500" />
          </div>
          <div>
            <CardTitle>Agent API Tokens</CardTitle>
            <CardDescription>
              Issue tokens for AI agents (Claude via the MCP server, scripts, etc.). Agents propose changes — you approve them.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {createdToken && (
          <div className="p-4 rounded-lg border border-green-500/30 bg-green-50 dark:bg-green-950/20 space-y-3">
            <div className="flex items-start gap-2">
              <KeyRound className="h-5 w-5 text-green-600 mt-0.5" />
              <div className="flex-1">
                <p className="font-medium text-green-700 dark:text-green-300">Token created. Copy it now — you won't see it again.</p>
                <code className="block mt-2 px-3 py-2 rounded bg-background border font-mono text-xs break-all" data-testid="text-new-token">
                  {createdToken}
                </code>
              </div>
              <Button size="sm" variant="outline" onClick={() => copy(createdToken)}>
                <Copy className="h-3 w-3 mr-1" /> Copy
              </Button>
            </div>
            <Button size="sm" variant="ghost" onClick={() => setCreatedToken(null)}>Dismiss</Button>
          </div>
        )}

        <div className="space-y-3 p-4 rounded-lg border bg-muted/30">
          <h4 className="text-sm font-medium">Create a new token</h4>
          <input
            type="text"
            placeholder="Token name (e.g. claude-desktop)"
            value={name}
            onChange={e => setName(e.target.value)}
            className="w-full px-3 py-2 rounded-md border bg-background text-sm"
            data-testid="input-token-name"
          />
          <div>
            <p className="text-xs text-muted-foreground mb-2">Scopes</p>
            <div className="flex flex-wrap gap-2">
              {ALL_SCOPES.map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => toggleScope(s)}
                  className={`text-xs px-2 py-1 rounded border ${scopes.includes(s) ? "bg-primary text-primary-foreground border-primary" : "bg-background"}`}
                  data-testid={`button-scope-${s}`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={autoApprove} onChange={e => setAutoApprove(e.target.checked)} />
            Auto-approve high-confidence proposals
          </label>
          {autoApprove && (
            <div className="flex items-center gap-2 text-sm pl-6">
              <span className="text-muted-foreground">Threshold (0–1):</span>
              <input
                type="number"
                step="0.01"
                min="0"
                max="1"
                value={threshold}
                onChange={e => setThreshold(e.target.value)}
                className="w-20 px-2 py-1 rounded border bg-background"
              />
            </div>
          )}
          <Button onClick={() => createMutation.mutate()} disabled={!name || createMutation.isPending} data-testid="button-create-token">
            <KeyRound className="h-4 w-4 mr-2" />
            {createMutation.isPending ? "Creating…" : "Create token"}
          </Button>
        </div>

        <div>
          <h4 className="text-sm font-medium mb-3">Existing tokens</h4>
          {isLoading ? (
            <Skeleton className="h-20 w-full" />
          ) : !tokens || tokens.length === 0 ? (
            <p className="text-sm text-muted-foreground">No tokens yet.</p>
          ) : (
            <div className="space-y-2">
              {tokens.map(t => (
                <div key={t.id} className="flex items-center justify-between p-3 rounded border" data-testid={`token-row-${t.id}`}>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{t.name}</span>
                      <code className="text-xs text-muted-foreground font-mono">{t.prefix}…</code>
                      {t.revokedAt && <Badge variant="destructive" className="text-xs">revoked</Badge>}
                      {t.autoApprove && <Badge variant="outline" className="text-xs">auto-approve ≥ {t.autoApproveThreshold}</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      Scopes: {(t.scopes || []).join(", ") || "—"}
                      {t.lastUsedAt && <> · Last used {new Date(t.lastUsedAt).toLocaleDateString()}</>}
                    </div>
                  </div>
                  {!t.revokedAt && (
                    <Button size="sm" variant="outline" onClick={() => revokeMutation.mutate(t.id)} data-testid={`button-revoke-${t.id}`}>
                      <Trash2 className="h-3 w-3 mr-1" /> Revoke
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="text-xs text-muted-foreground border-t pt-4">
          Connect Claude or another MCP client by setting <code className="bg-muted px-1 rounded">OPEN_CRYPTO_TAX_TOKEN</code> on the <code className="bg-muted px-1 rounded">open-crypto-tax-mcp</code> server. See <a href="/mcp/README.md" className="underline">mcp/README.md</a>.
        </div>
      </CardContent>
    </Card>
  );
}
