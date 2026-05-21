import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/stat-card";
import { ChainBadge } from "@/components/chain-badge";
import { ClassificationBadge } from "@/components/classification-badge";
import { AddressDisplay } from "@/components/address-display";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { 
  Wallet, 
  ArrowLeftRight, 
  AlertCircle, 
  DollarSign,
  TrendingUp,
  TrendingDown,
  ArrowRight,
  PlusCircle
} from "lucide-react";
import type { DashboardStats, Transaction } from "@shared/schema";
import { format } from "date-fns";

function formatCurrency(value: string | number): string {
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return "$0.00";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

function RecentTransactionRow({ tx }: { tx: Transaction }) {
  return (
    <div className="flex items-center justify-between py-3 border-b last:border-0">
      <div className="flex items-center gap-3 min-w-0">
        <ChainBadge chain={tx.chain} />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <ClassificationBadge classification={tx.classification || "unknown"} />
            {tx.needsReview && (
              <span className="text-xs text-yellow-600 dark:text-yellow-400 font-medium">
                Needs Review
              </span>
            )}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-2">
            <span>{format(new Date(tx.timestamp), "MMM d, yyyy HH:mm")}</span>
            <AddressDisplay address={tx.txHash} chain={tx.chain} showLink={false} showCopy={false} />
          </div>
        </div>
      </div>
      <div className="text-right">
        {tx.tokenOutSymbol && tx.tokenOutAmount && (
          <div className="text-sm font-medium text-loss">
            -{parseFloat(tx.tokenOutAmount).toFixed(4)} {tx.tokenOutSymbol}
          </div>
        )}
        {tx.tokenInSymbol && tx.tokenInAmount && (
          <div className="text-sm font-medium text-gain">
            +{parseFloat(tx.tokenInAmount).toFixed(4)} {tx.tokenInSymbol}
          </div>
        )}
        {tx.valueUsd && (
          <div className="text-xs text-muted-foreground">
            {formatCurrency(tx.valueUsd)}
          </div>
        )}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { data: stats, isLoading } = useQuery<DashboardStats>({
    queryKey: ["/api/dashboard/stats"],
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Dashboard</h1>
          <p className="text-muted-foreground">
            Overview of your onchain records review for 2024
          </p>
        </div>
        <Link href="/wallets">
          <Button data-testid="button-add-wallet">
          <PlusCircle className="h-4 w-4 mr-2" />
          Add Wallet
          </Button>
        </Link>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Wallets"
          value={stats?.totalWallets ?? 0}
          subtitle="Connected wallets"
          icon={Wallet}
          isLoading={isLoading}
        />
        <StatCard
          title="Transactions"
          value={stats?.totalTransactions ?? 0}
          subtitle="All time"
          icon={ArrowLeftRight}
          isLoading={isLoading}
        />
        <StatCard
          title="Needs Review"
          value={stats?.needsReview ?? 0}
          subtitle="Transactions requiring classification"
          icon={AlertCircle}
          isLoading={isLoading}
        />
        <StatCard
          title="Total Value"
          value={formatCurrency(stats?.totalValueUsd ?? "0")}
          subtitle="Current portfolio value"
          icon={DollarSign}
          isLoading={isLoading}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-green-600 dark:text-green-400" />
              Realized Gains
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-10 w-32" />
            ) : (
              <div className="text-3xl font-bold text-gain">
                {formatCurrency(stats?.realizedGains ?? "0")}
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-1">Draft · 2024</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <TrendingDown className="h-4 w-4 text-red-600 dark:text-red-400" />
              Realized Losses
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-10 w-32" />
            ) : (
              <div className="text-3xl font-bold text-loss">
                {formatCurrency(stats?.realizedLosses ?? "0")}
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-1">Draft · 2024</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
            <CardTitle className="text-base font-semibold">Recent Transactions</CardTitle>
            <Button variant="ghost" size="sm" asChild>
              <a href="/transactions" data-testid="link-view-all-transactions">
                View All <ArrowRight className="h-4 w-4 ml-1" />
              </a>
            </Button>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-4">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <Skeleton className="h-6 w-20" />
                    <div className="flex-1">
                      <Skeleton className="h-4 w-24 mb-1" />
                      <Skeleton className="h-3 w-32" />
                    </div>
                    <Skeleton className="h-4 w-16" />
                  </div>
                ))}
              </div>
            ) : stats?.recentTransactions && stats.recentTransactions.length > 0 ? (
              <div className="divide-y">
                {stats.recentTransactions.map((tx) => (
                  <RecentTransactionRow key={tx.id} tx={tx} />
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <ArrowLeftRight className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>No transactions yet</p>
                <p className="text-sm">Add a wallet to import transactions</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base font-semibold">Chain Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-3">
                {[...Array(4)].map((_, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <Skeleton className="h-5 w-20" />
                    <Skeleton className="h-4 w-16" />
                  </div>
                ))}
              </div>
            ) : stats?.chainBreakdown && stats.chainBreakdown.length > 0 ? (
              <div className="space-y-3">
                {stats.chainBreakdown.map((item) => (
                  <div key={item.chain} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <ChainBadge chain={item.chain} />
                      <span className="text-sm text-muted-foreground">
                        {item.count} txs
                      </span>
                    </div>
                    <span className="text-sm font-medium">
                      {formatCurrency(item.value)}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-4 text-muted-foreground text-sm">
                No chain data yet
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
