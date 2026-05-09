import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/use-auth";
import {
  Wallet,
  FileText,
  Shield,
  Bot,
  CheckCircle,
  ArrowRight,
  Github,
  Receipt,
  Sparkles
} from "lucide-react";

const features = [
  {
    icon: Wallet,
    title: "Aggregate everything",
    description: "Wallets across Ethereum, Bitcoin, Solana, and 6+ more chains. CSV import for exchanges. One dataset, every account."
  },
  {
    icon: Sparkles,
    title: "Fix missing cost basis",
    description: "Surface every disposal where the basis is unknown. Hand it to your AI agent — or fill in by hand with full provenance."
  },
  {
    icon: Bot,
    title: "Built for AI agents",
    description: "MCP server + REST API + JSON export. Claude (or any agent) connects, proposes fixes, you approve. Audit log keeps everyone honest."
  },
  {
    icon: FileText,
    title: "Tax-ready output",
    description: "Form 8949, Schedule D, income reports. Export structured JSON for your accountant or your favorite tax LLM workflow."
  }
];

const supportedChains = [
  "Ethereum", "Bitcoin", "Solana", "Polygon",
  "Arbitrum", "Optimism", "Base", "Avalanche", "BSC"
];

const reportTypes = [
  "Form 8949 (Capital Gains)",
  "Schedule D Summary",
  "Income Report",
  "JSON Export (agents)",
  "Audit Log",
  "Missing Cost Basis Queue"
];

export default function LandingPage() {
  const { loginWithGoogle, isLocalMode } = useAuth();

  const handleLogin = async () => {
    if (isLocalMode) {
      window.location.reload();
      return;
    }
    try {
      await loginWithGoogle();
    } catch (error) {
      console.error("Login failed:", error);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 py-8">
        <nav className="flex items-center justify-between mb-16">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-md bg-primary flex items-center justify-center">
              <Receipt className="w-5 h-5 text-primary-foreground" />
            </div>
            <span className="text-xl font-bold">Open Crypto Tax</span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" asChild>
              <a href="https://github.com" target="_blank" rel="noopener noreferrer">
                <Github className="w-4 h-4 mr-2" /> GitHub
              </a>
            </Button>
            <Button onClick={handleLogin} data-testid="button-login-nav">
              {isLocalMode ? "Open app" : "Sign In"}
              <ArrowRight className="ml-2 w-4 h-4" />
            </Button>
          </div>
        </nav>

        <section className="text-center mb-20">
          <Badge variant="secondary" className="mb-4" data-testid="badge-tagline">
            MIT-licensed · Self-hosted · Agent-friendly
          </Badge>
          <h1 className="text-4xl md:text-5xl font-bold mb-4" data-testid="text-headline">
            Free crypto tax tool
            <br />
            for you and your AI agent
          </h1>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-8" data-testid="text-subheadline">
            Self-host. Connect your wallets. Let Claude (or any AI agent) work the missing-cost-basis queue and propose fixes — you approve in one click. Hand the clean dataset to any LLM to finish your taxes.
          </p>
          <div className="flex gap-4 justify-center">
            <Button size="lg" onClick={handleLogin} data-testid="button-get-started">
              {isLocalMode ? "Open app" : "Get started — free"}
              <ArrowRight className="ml-2 w-4 h-4" />
            </Button>
            <Button size="lg" variant="outline" asChild>
              <a href="/api/openapi.json" target="_blank" rel="noopener noreferrer">
                View API
              </a>
            </Button>
          </div>
        </section>

        <section className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 mb-20">
          {features.map((feature, index) => (
            <Card key={feature.title} className="hover-elevate" data-testid={`card-feature-${index}`}>
              <CardHeader>
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center mb-3">
                  <feature.icon className="w-5 h-5 text-primary" />
                </div>
                <CardTitle className="text-lg">{feature.title}</CardTitle>
              </CardHeader>
              <CardContent>
                <CardDescription>{feature.description}</CardDescription>
              </CardContent>
            </Card>
          ))}
        </section>

        <section className="grid md:grid-cols-2 gap-8 mb-20">
          <Card data-testid="card-supported-chains">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Wallet className="w-5 h-5" />
                Supported blockchains
              </CardTitle>
              <CardDescription>
                Read-only address tracking — your keys never leave your wallet.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-2">
                {supportedChains.map(chain => (
                  <Badge key={chain} variant="outline" data-testid={`badge-chain-${chain.toLowerCase()}`}>
                    {chain}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card data-testid="card-report-types">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="w-5 h-5" />
                What you get out
              </CardTitle>
              <CardDescription>
                Designed for humans, accountants, and AI agents.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {reportTypes.map(report => (
                  <li key={report} className="flex items-center gap-2 text-sm" data-testid={`text-report-${report.replace(/\s+/g, '-').toLowerCase()}`}>
                    <CheckCircle className="w-4 h-4 text-green-500" />
                    {report}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </section>

        <section className="text-center py-12 border-t">
          <h2 className="text-2xl font-bold mb-4" data-testid="text-cta-heading">
            Point Claude at your wallets. Watch your basis problems disappear.
          </h2>
          <p className="text-muted-foreground mb-6 max-w-xl mx-auto">
            The MCP server lets your AI agent read your transactions and propose cost-basis fixes with evidence. You approve. Done.
          </p>
          <Button size="lg" onClick={handleLogin} data-testid="button-cta-login">
            {isLocalMode ? "Open app" : "Get started"}
            <ArrowRight className="ml-2 w-4 h-4" />
          </Button>
        </section>

        <footer className="text-center text-sm text-muted-foreground py-8">
          <p>Open Crypto Tax · MIT-licensed · Built for self-hosting and AI workflows.</p>
        </footer>
      </div>
    </div>
  );
}
