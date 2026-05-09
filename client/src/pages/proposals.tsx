import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Bot, Check, X, ExternalLink, Sparkles, AlertCircle } from "lucide-react";
import { format } from "date-fns";

type Proposal = {
  id: string;
  actor: string;
  actorType: string;
  action: string;
  targetType: string;
  targetId: string | null;
  payload: Record<string, any>;
  reasoning: string | null;
  evidenceUrl: string | null;
  confidence: string | null;
  status: string;
  createdAt: string;
  decidedAt: string | null;
  errorMessage: string | null;
};

const ACTION_LABELS: Record<string, string> = {
  set_cost_basis: "Set cost basis",
  classify_transaction: "Classify transaction",
  link_transfer_pair: "Link transfer pair",
  merge_duplicate_txs: "Merge duplicates",
  create_tax_lot: "Create tax lot",
  mark_reviewed: "Mark reviewed",
};

function ProposalCard({ p, onApprove, onReject, busy }: {
  p: Proposal;
  onApprove: () => void;
  onReject: () => void;
  busy: boolean;
}) {
  const conf = p.confidence ? Math.round(parseFloat(p.confidence) * 100) : null;
  const isPending = p.status === "pending";

  return (
    <Card className={isPending ? "border-blue-500/30 bg-blue-50/40 dark:bg-blue-950/10" : ""}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/40">
              <Bot className="h-5 w-5 text-blue-600 dark:text-blue-300" />
            </div>
            <div>
              <CardTitle className="text-base">{ACTION_LABELS[p.action] || p.action}</CardTitle>
              <CardDescription className="flex items-center gap-2 mt-1">
                <span className="font-mono text-xs">{p.actor}</span>
                <span>·</span>
                <span>{format(new Date(p.createdAt), "MMM d, HH:mm")}</span>
              </CardDescription>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {conf !== null && (
              <Badge variant="outline" className="text-xs">
                <Sparkles className="h-3 w-3 mr-1" />
                {conf}% confidence
              </Badge>
            )}
            <Badge
              variant={p.status === "applied" ? "default" : p.status === "failed" ? "destructive" : "outline"}
              className="text-xs"
            >
              {p.status}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="rounded-lg bg-background border p-3 text-sm">
          <div className="text-muted-foreground text-xs mb-1">Target: {p.targetType} {p.targetId ? `· ${p.targetId.slice(0, 8)}…` : ""}</div>
          <pre className="text-xs overflow-x-auto whitespace-pre-wrap font-mono">{JSON.stringify(p.payload, null, 2)}</pre>
        </div>
        {p.reasoning && (
          <div className="text-sm">
            <span className="text-muted-foreground">Reasoning: </span>
            {p.reasoning}
          </div>
        )}
        {p.evidenceUrl && (
          <a href={p.evidenceUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 hover:underline inline-flex items-center gap-1">
            <ExternalLink className="h-3 w-3" /> evidence
          </a>
        )}
        {p.errorMessage && (
          <div className="text-sm text-destructive flex items-center gap-1">
            <AlertCircle className="h-3 w-3" /> {p.errorMessage}
          </div>
        )}
        {isPending && (
          <div className="flex gap-2 pt-2">
            <Button size="sm" onClick={onApprove} disabled={busy} data-testid={`button-approve-${p.id}`}>
              <Check className="h-4 w-4 mr-1" /> Approve & apply
            </Button>
            <Button size="sm" variant="outline" onClick={onReject} disabled={busy} data-testid={`button-reject-${p.id}`}>
              <X className="h-4 w-4 mr-1" /> Reject
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function Proposals() {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<Proposal[]>({ queryKey: ["/api/proposals"] });

  const approveMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("POST", `/api/proposals/${id}/approve`);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/proposals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/transactions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({ title: data.applied ? "Applied" : "Failed", description: data.error || "Proposal applied", variant: data.applied ? "default" : "destructive" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const rejectMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("POST", `/api/proposals/${id}/reject`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/proposals"] });
      toast({ title: "Rejected" });
    },
  });

  const proposals = data || [];
  const pending = proposals.filter(p => p.status === "pending");
  const decided = proposals.filter(p => p.status !== "pending").slice(0, 50);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Agent proposals</h1>
          <p className="text-muted-foreground">
            Changes suggested by AI agents (or yourself via the API). Approve or reject — nothing applies until you do.
          </p>
        </div>
        {pending.length > 0 && (
          <Badge variant="outline" className="text-blue-600">
            <Bot className="h-3 w-3 mr-1" />
            {pending.length} pending
          </Badge>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-40 w-full" />)}
        </div>
      ) : pending.length === 0 && decided.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No proposals yet. Connect an AI agent via the MCP server (see <code>/settings</code>) to start receiving suggestions.
          </CardContent>
        </Card>
      ) : (
        <>
          {pending.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-muted-foreground">Pending</h2>
              {pending.map(p => (
                <ProposalCard
                  key={p.id}
                  p={p}
                  busy={approveMutation.isPending || rejectMutation.isPending}
                  onApprove={() => approveMutation.mutate(p.id)}
                  onReject={() => rejectMutation.mutate(p.id)}
                />
              ))}
            </section>
          )}
          {decided.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold text-muted-foreground">History</h2>
              {decided.map(p => (
                <ProposalCard key={p.id} p={p} busy onApprove={() => {}} onReject={() => {}} />
              ))}
            </section>
          )}
        </>
      )}
    </div>
  );
}
