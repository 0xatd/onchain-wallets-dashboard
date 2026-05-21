import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { 
  FileText, 
  Download,
  DollarSign,
  TrendingUp,
  TrendingDown,
  AlertTriangle,
  CheckCircle2,
  Calendar,
  Coins,
  Gift,
  ImageIcon,
  Pickaxe
} from "lucide-react";
import type { Disposal } from "@shared/schema";
import { format } from "date-fns";

function formatCurrency(value: string | number | null): string {
  if (!value) return "$0.00";
  const num = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(num)) return "$0.00";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

const reports = [
  {
    id: "form8949",
    title: "Draft Form 8949 Worksheet",
    description: "Review worksheet for potential sales and disposals. Not an official IRS form.",
    icon: FileText,
    format: "CSV",
  },
  {
    id: "schedule-d",
    title: "Draft Schedule D Summary",
    description: "Review summary of calculated gains and losses. Verify before filing.",
    icon: DollarSign,
    format: "CSV",
  },
  {
    id: "income",
    title: "Income Worksheet",
    description: "Draft summary of airdrops, staking rewards, and other income-like activity.",
    icon: Coins,
    format: "CSV",
  },
  {
    id: "staking",
    title: "Staking Worksheet",
    description: "Draft staking rewards breakdown for review.",
    icon: TrendingUp,
    format: "CSV",
  },
  {
    id: "airdrop",
    title: "Airdrop Worksheet",
    description: "Draft list of received airdrops and observed values.",
    icon: Gift,
    format: "CSV",
  },
  {
    id: "nft",
    title: "NFT Worksheet",
    description: "Draft list of NFT purchases, sales, and mints.",
    icon: ImageIcon,
    format: "CSV",
  },
];

type ReportSummary = {
  totalDisposals: number;
  shortTermGains: string;
  shortTermLosses: string;
  longTermGains: string;
  longTermLosses: string;
  netGainLoss: string;
  totalIncome: string;
  needsReviewCount: number;
  disposals: Disposal[];
};

function ReportCard({ 
  report, 
  taxYear,
  onDownload 
}: { 
  report: typeof reports[0]; 
  taxYear: number;
  onDownload: (reportId: string) => void;
}) {
  const Icon = report.icon;

  return (
    <Card className="hover-elevate">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary/10">
            <Icon className="h-5 w-5 text-primary" />
          </div>
          <Badge variant="outline" className="text-xs">
            {report.format}
          </Badge>
        </div>
        <CardTitle className="text-base mt-3">{report.title}</CardTitle>
        <CardDescription>{report.description}</CardDescription>
      </CardHeader>
      <CardFooter className="pt-0">
        <Button 
          variant="outline" 
          className="w-full"
          onClick={() => onDownload(report.id)}
          data-testid={`button-download-${report.id}`}
        >
          <Download className="h-4 w-4 mr-2" />
          Download
        </Button>
      </CardFooter>
    </Card>
  );
}

export default function Reports() {
  const [taxYear, setTaxYear] = useState(2024);
  const { toast } = useToast();

  const { data: summary, isLoading } = useQuery<ReportSummary>({
    queryKey: [`/api/reports/summary?year=${taxYear}`],
  });

  const downloadMutation = useMutation({
    mutationFn: async (reportId: string) => {
      const response = await fetch(`/api/reports/${reportId}?year=${taxYear}`);
      if (!response.ok) throw new Error("Download failed");
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${reportId}-${taxYear}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    },
    onSuccess: () => {
      toast({
        title: "Report downloaded",
        description: "Your tax report has been downloaded successfully.",
      });
    },
    onError: () => {
      toast({
        title: "Download failed",
        description: "Unable to download the report. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleDownload = (reportId: string) => {
    downloadMutation.mutate(reportId);
  };

  const shortTermNet = summary 
    ? parseFloat(summary.shortTermGains || "0") - parseFloat(summary.shortTermLosses || "0")
    : 0;
  const longTermNet = summary 
    ? parseFloat(summary.longTermGains || "0") - parseFloat(summary.longTermLosses || "0")
    : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Review Exports</h1>
          <p className="text-muted-foreground">
            Generate draft worksheets for review. These are not official forms or professional advice.
          </p>
        </div>
        <Select value={taxYear.toString()} onValueChange={(v) => setTaxYear(parseInt(v))}>
          <SelectTrigger className="w-[140px]" data-testid="select-tax-year">
            <Calendar className="h-4 w-4 mr-2" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="2024">2024</SelectItem>
            <SelectItem value="2023">2023</SelectItem>
            <SelectItem value="2022">2022</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {summary?.needsReviewCount && summary.needsReviewCount > 0 ? (
        <Card className="border-yellow-500/30 bg-yellow-50/50 dark:bg-yellow-900/10">
          <CardContent className="flex items-center gap-4 py-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-yellow-100 dark:bg-yellow-900/50">
              <AlertTriangle className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
            </div>
            <div className="flex-1">
              <p className="font-medium">Some transactions need review</p>
              <p className="text-sm text-muted-foreground">
                {summary.needsReviewCount} transactions require review before exports can be considered complete.
              </p>
            </div>
            <Button variant="outline" asChild>
              <a href="/review">Review Now</a>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-green-500/30 bg-green-50/50 dark:bg-green-900/10">
          <CardContent className="flex items-center gap-4 py-4">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/50">
              <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
            </div>
            <div className="flex-1">
              <p className="font-medium">No open classification flags</p>
              <p className="text-sm text-muted-foreground">
                Draft exports are available. Verify the data before using it anywhere else.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Short-Term Net
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <div className={`text-2xl font-bold ${shortTermNet >= 0 ? "text-gain" : "text-loss"}`}>
                {formatCurrency(shortTermNet)}
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-1">Held less than 1 year</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              Long-Term Net
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <div className={`text-2xl font-bold ${longTermNet >= 0 ? "text-gain" : "text-loss"}`}>
                {formatCurrency(longTermNet)}
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-1">Held more than 1 year</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <DollarSign className="h-4 w-4" />
              Total Income
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <div className="text-2xl font-bold">
                {formatCurrency(summary?.totalIncome ?? "0")}
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-1">Rewards & airdrops</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Disposal Candidates
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="text-2xl font-bold">
                {summary?.totalDisposals ?? 0}
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-1">Review needed</p>
          </CardContent>
        </Card>
      </div>

      <div>
        <h2 className="text-lg font-semibold mb-4">Available Draft Exports</h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {reports.map((report) => (
            <ReportCard 
              key={report.id} 
              report={report} 
              taxYear={taxYear}
              onDownload={handleDownload}
            />
          ))}
        </div>
      </div>

      {summary?.disposals && summary.disposals.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Recent Disposals</CardTitle>
            <CardDescription>Preview of calculated disposal candidates. Verify before relying on these numbers.</CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Asset</TableHead>
                  <TableHead className="text-right">Proceeds</TableHead>
                  <TableHead className="text-right">Cost Basis</TableHead>
                  <TableHead className="text-right">Gain/Loss</TableHead>
                  <TableHead>Term</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.disposals.slice(0, 10).map((disposal) => (
                  <TableRow key={disposal.id}>
                    <TableCell>
                      {format(new Date(disposal.disposedAt), "MMM d, yyyy")}
                    </TableCell>
                    <TableCell>
                      <span className="font-medium">{disposal.tokenSymbol}</span>
                      <span className="text-muted-foreground ml-1 text-xs">
                        {parseFloat(disposal.amount).toFixed(4)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(disposal.proceedsUsd)}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(disposal.costBasisUsd)}
                    </TableCell>
                    <TableCell className={`text-right font-medium ${
                      parseFloat(disposal.gainLossUsd) >= 0 ? "text-gain" : "text-loss"
                    }`}>
                      {formatCurrency(disposal.gainLossUsd)}
                    </TableCell>
                    <TableCell>
                      <Badge variant={disposal.isShortTerm ? "secondary" : "outline"}>
                        {disposal.isShortTerm ? "Short" : "Long"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
