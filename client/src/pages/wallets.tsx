import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChainBadge } from "@/components/chain-badge";
import { AddressDisplay } from "@/components/address-display";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  PlusCircle,
  Wallet,
  MoreVertical,
  Trash2,
  RefreshCw,
  ArrowLeftRight,
  CheckCircle2,
  Sparkles,
  Eye,
  X,
  ExternalLink,
  Upload,
  AlertTriangle
} from "lucide-react";
import type { Wallet as WalletType } from "@shared/schema";
import { SUPPORTED_CHAINS } from "@shared/schema";
import { format } from "date-fns";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";

const addWalletSchema = z.object({
  address: z.string().min(26, "Address must be at least 26 characters"),
  chain: z.string().min(1, "Please select a chain"),
  label: z.string().optional(),
  entityType: z.string().default("personal"),
});

type AddWalletFormValues = z.infer<typeof addWalletSchema>;

function WalletCard({ wallet }: { wallet: WalletType }) {
  const { toast } = useToast();

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/wallets/${wallet.id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/wallets"] });
      toast({
        title: "Wallet removed",
        description: "The wallet has been removed from your account.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to remove wallet. Please try again.",
        variant: "destructive",
      });
    },
  });

  const syncMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", `/api/wallets/${wallet.id}/sync`);
      return response.json();
    },
    onSuccess: (data: { status: string; imported: number; skipped: number; total: number }) => {
      queryClient.invalidateQueries({ queryKey: ["/api/wallets"] });
      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({
        title: "Sync complete",
        description: data.imported > 0 
          ? `Imported ${data.imported} new transactions.${data.skipped > 0 ? ` (${data.skipped} already existed)` : ''}`
          : data.total === 0 
            ? "No transactions found for this wallet."
            : `All ${data.skipped} transactions already synced.`,
      });
    },
    onError: async (error: Error & { response?: Response }) => {
      let message = "Failed to sync wallet. Please try again.";
      try {
        if (error.response) {
          const data = await error.response.json();
          message = data.message || data.error || message;
        }
      } catch {}
      toast({
        title: "Sync failed",
        description: message,
        variant: "destructive",
      });
    },
  });

  return (
    <Card className="hover-elevate">
      <CardHeader className="flex flex-row items-start justify-between gap-2 space-y-0 pb-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10">
            <Wallet className="h-5 w-5 text-primary" />
          </div>
          <div>
            <CardTitle className="text-base font-semibold">
              {wallet.label || "Unnamed Wallet"}
            </CardTitle>
            <div className="flex items-center gap-2 mt-1">
              <ChainBadge chain={wallet.chain} />
              <Badge variant="outline" className="text-xs">
                {wallet.entityType || "personal"}
              </Badge>
            </div>
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" data-testid={`button-wallet-menu-${wallet.id}`}>
              <MoreVertical className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem 
              onClick={() => syncMutation.mutate()}
              disabled={syncMutation.isPending}
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              Sync Transactions
            </DropdownMenuItem>
            <DropdownMenuItem 
              onClick={() => deleteMutation.mutate()}
              className="text-destructive"
              disabled={deleteMutation.isPending}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Remove Wallet
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          <AddressDisplay address={wallet.address} chain={wallet.chain} />
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Added</span>
            <span>{wallet.createdAt ? format(new Date(wallet.createdAt), "MMM d, yyyy") : "N/A"}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Status</span>
            <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
              <CheckCircle2 className="h-3 w-3" />
              Active
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Wallets() {
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [isImportDialogOpen, setIsImportDialogOpen] = useState(false);
  const { toast } = useToast();

  const { data: wallets, isLoading } = useQuery<WalletType[]>({
    queryKey: ["/api/wallets"],
  });

  const form = useForm<AddWalletFormValues>({
    resolver: zodResolver(addWalletSchema),
    defaultValues: {
      address: "",
      chain: "",
      label: "",
      entityType: "personal",
    },
  });

  const addMutation = useMutation({
    mutationFn: async (data: AddWalletFormValues) => {
      return await apiRequest("POST", "/api/wallets", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/wallets"] });
      setIsAddDialogOpen(false);
      form.reset();
      toast({
        title: "Wallet added",
        description: "Your wallet has been added. Transactions will be imported shortly.",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to add wallet. Please check the address and try again.",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: AddWalletFormValues) => {
    addMutation.mutate(data);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Wallets</h1>
          <p className="text-muted-foreground">
            Manage your connected wallet addresses
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Dialog open={isImportDialogOpen} onOpenChange={setIsImportDialogOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" disabled={!wallets?.length} data-testid="button-import-csv">
                <Upload className="h-4 w-4 mr-2" />
                Import CSV
              </Button>
            </DialogTrigger>
            <ExchangeCsvImportDialog wallets={wallets || []} onDone={() => setIsImportDialogOpen(false)} />
          </Dialog>
          <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
            <DialogTrigger asChild>
              <Button data-testid="button-add-wallet">
                <PlusCircle className="h-4 w-4 mr-2" />
                Add Wallet
              </Button>
            </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Add Wallet</DialogTitle>
              <DialogDescription>
                Enter your wallet address to import transaction history. We use read-only connections only.
              </DialogDescription>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="chain"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Blockchain</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-chain">
                            <SelectValue placeholder="Select a blockchain" />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {SUPPORTED_CHAINS.map((chain) => (
                            <SelectItem key={chain} value={chain}>
                              {chain.charAt(0).toUpperCase() + chain.slice(1)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="address"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Wallet Address</FormLabel>
                      <FormControl>
                        <Input 
                          placeholder="0x..." 
                          className="font-mono"
                          data-testid="input-wallet-address"
                          {...field} 
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="label"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Label (optional)</FormLabel>
                      <FormControl>
                        <Input 
                          placeholder="My Main Wallet" 
                          data-testid="input-wallet-label"
                          {...field} 
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="entityType"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Entity Type</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger data-testid="select-entity-type">
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="personal">Personal</SelectItem>
                          <SelectItem value="llc">LLC</SelectItem>
                          <SelectItem value="dao">DAO</SelectItem>
                          <SelectItem value="trust">Trust</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <DialogFooter>
                  <Button 
                    type="submit" 
                    disabled={addMutation.isPending}
                    data-testid="button-submit-wallet"
                  >
                    {addMutation.isPending ? "Adding..." : "Add Wallet"}
                  </Button>
                </DialogFooter>
              </form>
            </Form>
          </DialogContent>
          </Dialog>
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[...Array(3)].map((_, i) => (
            <Card key={i}>
              <CardHeader className="flex flex-row items-start gap-3">
                <Skeleton className="h-10 w-10 rounded-md" />
                <div className="flex-1">
                  <Skeleton className="h-5 w-32 mb-2" />
                  <Skeleton className="h-4 w-24" />
                </div>
              </CardHeader>
              <CardContent>
                <Skeleton className="h-4 w-full mb-3" />
                <Skeleton className="h-4 w-3/4" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : wallets && wallets.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {wallets.map((wallet) => (
            <WalletCard key={wallet.id} wallet={wallet} />
          ))}
        </div>
      ) : (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-muted mb-4">
              <Wallet className="h-8 w-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold mb-1">No wallets connected</h3>
            <p className="text-muted-foreground text-center max-w-sm mb-4">
              Add your first wallet to start importing transaction history and organizing your onchain records.
            </p>
            <Button onClick={() => setIsAddDialogOpen(true)} data-testid="button-add-first-wallet">
              <PlusCircle className="h-4 w-4 mr-2" />
              Add Your First Wallet
            </Button>
          </CardContent>
        </Card>
      )}

      <SuggestedWallets onAdd={(s) => {
        form.reset({ address: s.address, chain: s.chains[0] || "ethereum", label: "", entityType: "personal" });
        setIsAddDialogOpen(true);
      }} />
    </div>
  );
}

// ---------- CSV import ----------

type CsvSource = "coinbase" | "robinhood" | "generic";
type CsvPreview = {
  imported: number;
  importable: number;
  duplicates: number;
  skipped: number;
  needsReview: number;
  errors: { row: number; reason: string }[];
  sample: {
    row: number;
    timestamp: string;
    asset?: string;
    amount?: string;
    valueUsd?: string;
    classification: string | null;
    needsReview: boolean;
  }[];
  warnings: string[];
};

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      i++;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(cell.trim());
      cell = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i++;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  if (rows.length < 2) return [];
  const headers = rows[0].map(h => h.trim());
  return rows.slice(1).map(values => Object.fromEntries(headers.map((header, index) => [header, values[index] || ""])));
}

function ExchangeCsvImportDialog({ wallets, onDone }: { wallets: WalletType[]; onDone: () => void }) {
  const { toast } = useToast();
  const [source, setSource] = useState<CsvSource>("coinbase");
  const [walletId, setWalletId] = useState(wallets[0]?.id || "");
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<CsvPreview | null>(null);

  const selectedWallet = wallets.find(w => w.id === walletId);

  const previewMutation = useMutation({
    mutationFn: async (payload: { wallet_id: string; source: CsvSource; rows: Record<string, string>[] }) => {
      const response = await apiRequest("POST", "/api/import/csv/preview", payload);
      return response.json() as Promise<CsvPreview>;
    },
    onSuccess: setPreview,
    onError: (error: Error) => {
      toast({ title: "Preview failed", description: error.message, variant: "destructive" });
    },
  });

  const importMutation = useMutation({
    mutationFn: async (payload: { wallet_id: string; source: CsvSource; rows: Record<string, string>[] }) => {
      const response = await apiRequest("POST", "/api/import/csv", payload);
      return response.json() as Promise<{ imported: number; duplicates: number; needsReview: number }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      queryClient.invalidateQueries({ queryKey: ["/api/agent/work"] });
      toast({
        title: "CSV imported",
        description: `Imported ${data.imported} rows.${data.duplicates ? ` Skipped ${data.duplicates} duplicates.` : ""}${data.needsReview ? ` ${data.needsReview} need review.` : ""}`,
      });
      onDone();
    },
    onError: (error: Error) => {
      toast({ title: "Import failed", description: error.message, variant: "destructive" });
    },
  });

  async function handleFile(file?: File) {
    setPreview(null);
    if (!file) return;
    const text = await file.text();
    const parsed = parseCsv(text);
    setRows(parsed);
    setFileName(file.name);
    if (parsed.length === 0) {
      toast({ title: "No rows found", description: "Could not parse this CSV. Check that the first row contains headers.", variant: "destructive" });
      return;
    }
    if (walletId) previewMutation.mutate({ wallet_id: walletId, source, rows: parsed });
  }

  function refreshPreview(nextSource = source, nextWalletId = walletId) {
    if (!nextWalletId || rows.length === 0) return;
    previewMutation.mutate({ wallet_id: nextWalletId, source: nextSource, rows });
  }

  return (
    <DialogContent className="max-w-3xl">
      <DialogHeader>
        <DialogTitle>Import exchange CSV</DialogTitle>
        <DialogDescription>
          Upload Coinbase, Robinhood, or generic exchange activity exports. We preview mapped rows before import and mark ambiguous rows for review.
        </DialogDescription>
      </DialogHeader>

      <div className="rounded-lg border border-amber-500/30 bg-amber-50/80 p-3 text-sm text-amber-950 dark:bg-amber-950/20 dark:text-amber-100">
        <div className="flex gap-2">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <p>CSV imports are draft records only. Verify against your exchange account and official documents before relying on them.</p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="space-y-2">
          <Label>Source</Label>
          <Select value={source} onValueChange={(value: CsvSource) => { setSource(value); refreshPreview(value, walletId); }}>
            <SelectTrigger data-testid="select-csv-source"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="coinbase">Coinbase</SelectItem>
              <SelectItem value="robinhood">Robinhood</SelectItem>
              <SelectItem value="generic">Generic CSV</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>Import into wallet/account</Label>
          <Select value={walletId} onValueChange={(value) => { setWalletId(value); refreshPreview(source, value); }}>
            <SelectTrigger data-testid="select-import-wallet"><SelectValue placeholder="Select wallet" /></SelectTrigger>
            <SelectContent>
              {wallets.map(wallet => (
                <SelectItem key={wallet.id} value={wallet.id}>{wallet.label || wallet.address.slice(0, 10)} · {wallet.chain}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label>CSV file</Label>
          <Input type="file" accept=".csv,text/csv" onChange={(event) => handleFile(event.target.files?.[0])} data-testid="input-csv-file" />
        </div>
      </div>

      {fileName && selectedWallet && (
        <p className="text-sm text-muted-foreground">
          Previewing <span className="font-medium">{fileName}</span> into <span className="font-medium">{selectedWallet.label || selectedWallet.address}</span>.
        </p>
      )}

      {previewMutation.isPending && <Skeleton className="h-32 w-full" />}

      {preview && (
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-5">
            <StatMini label="Rows parsed" value={preview.imported} />
            <StatMini label="Importable" value={preview.importable} />
            <StatMini label="Duplicates" value={preview.duplicates} />
            <StatMini label="Needs review" value={preview.needsReview} />
            <StatMini label="Skipped" value={preview.skipped} />
          </div>

          {preview.warnings.length > 0 && (
            <div className="rounded-lg bg-muted p-3 text-sm space-y-1">
              {preview.warnings.map((warning, index) => <p key={index}>· {warning}</p>)}
            </div>
          )}

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Preview sample</CardTitle>
              <CardDescription>First mapped rows. Import keeps uncertain rows flagged for review.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {preview.sample.map(row => (
                <div key={row.row} className="flex items-center justify-between gap-3 border-b last:border-0 py-2">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{row.asset || "Unknown asset"} {row.amount ? `· ${row.amount}` : ""}</p>
                    <p className="text-xs text-muted-foreground">{new Date(row.timestamp).toLocaleString()} · {row.classification || "unknown"}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {row.valueUsd && <Badge variant="outline">${row.valueUsd}</Badge>}
                    {row.needsReview && <Badge variant="secondary">needs review</Badge>}
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          {preview.errors.length > 0 && (
            <details className="text-sm text-muted-foreground">
              <summary className="cursor-pointer">Skipped row details</summary>
              <ul className="mt-2 space-y-1">
                {preview.errors.slice(0, 20).map(error => <li key={`${error.row}-${error.reason}`}>Row {error.row}: {error.reason}</li>)}
              </ul>
            </details>
          )}
        </div>
      )}

      <DialogFooter>
        <Button variant="outline" onClick={onDone}>Cancel</Button>
        <Button
          disabled={!preview || preview.importable <= 0 || importMutation.isPending}
          onClick={() => importMutation.mutate({ wallet_id: walletId, source, rows })}
          data-testid="button-confirm-csv-import"
        >
          {importMutation.isPending ? "Importing..." : "Import rows"}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

function StatMini({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-xl font-semibold">{value}</p>
    </div>
  );
}

// ---------- Suggested wallets ----------

type WalletSuggestion = {
  address: string;
  chains: string[];
  txCount: number;
  sentToCount: number;
  receivedFromCount: number;
  totalValueUsd: number;
  firstSeen: string;
  lastSeen: string;
  bidirectional: boolean;
  score: number;
  reasons: string[];
  sampleTxIds: string[];
};

function SuggestedWallets({ onAdd }: { onAdd: (s: WalletSuggestion) => void }) {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<WalletSuggestion[]>({ queryKey: ["/api/wallets/suggestions"] });

  const dismissMutation = useMutation({
    mutationFn: async (address: string) => apiRequest("POST", `/api/wallets/suggestions/${address}/dismiss`, { reason: "user_dismissed" }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/wallets/suggestions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/agent/work"] });
      toast({ title: "Dismissed", description: "We won't suggest this address again." });
    },
  });

  const suggestions = data || [];
  if (isLoading || suggestions.length === 0) return null;

  return (
    <Card className="border-blue-500/30 bg-blue-50/40 dark:bg-blue-950/10" data-testid="card-suggested-wallets">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-blue-500" />
          Wallets you might have forgotten
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          Counterparty addresses with patterns that suggest you might own them — bidirectional flow, repeated interactions, multi-chain presence.
          Adding a forgotten wallet usually unlocks a stack of missing-basis problems at once.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {suggestions.map(s => (
          <div key={s.address} className="rounded-lg bg-background border p-4" data-testid={`suggestion-${s.address}`}>
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <code className="text-sm font-mono break-all">{s.address}</code>
                  <Badge variant="outline" className="text-xs">
                    {Math.round(s.score * 100)}% confidence
                  </Badge>
                  {s.bidirectional && <Badge variant="outline" className="text-xs">bidirectional</Badge>}
                </div>
                <div className="flex flex-wrap gap-1 mb-2">
                  {s.chains.map(c => <ChainBadge key={c} chain={c} />)}
                </div>
                <ul className="text-xs text-muted-foreground space-y-0.5">
                  {s.reasons.map((r, i) => <li key={i}>· {r}</li>)}
                </ul>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" onClick={() => onAdd(s)} data-testid={`button-add-${s.address}`}>
                  <PlusCircle className="h-3 w-3 mr-1" /> Add
                </Button>
                <Button size="sm" variant="outline" onClick={() => dismissMutation.mutate(s.address)} data-testid={`button-dismiss-${s.address}`}>
                  <X className="h-3 w-3 mr-1" /> Not mine
                </Button>
              </div>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
