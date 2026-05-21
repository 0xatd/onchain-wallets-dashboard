import { AlertTriangle } from "lucide-react";

export function LegalDisclaimer({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={`rounded-lg border border-amber-500/30 bg-amber-50/80 text-amber-950 dark:bg-amber-950/20 dark:text-amber-100 ${compact ? "p-3 text-xs" : "p-4 text-sm"}`}
      data-testid="legal-disclaimer"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className={`${compact ? "h-4 w-4" : "h-5 w-5"} mt-0.5 shrink-0 text-amber-600 dark:text-amber-300`} />
        <div className="space-y-1">
          <p className="font-semibold">Informational tool only — not professional advice.</p>
          <p className="leading-relaxed">
            This app organizes wallet and transaction data for your own review. It does not provide tax,
            legal, accounting, investment, financial, or compliance advice; it does not determine your filing
            obligations; and exports are draft worksheets, not official tax forms. Verify everything with a
            qualified professional before filing or making decisions.
          </p>
        </div>
      </div>
    </div>
  );
}
