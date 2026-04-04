import { Card } from "./ui/card";
import useStore from "@client/store";
import { cn } from "@client/lib/utils";
import { formatCurrency, formatInteger } from "@client/lib/format";
import { fromSmallestUnit } from "@shared/types";
import type { ConnectionStatus } from "@shared/types";

const STATUS_CONFIG: Record<
  ConnectionStatus,
  { dotClass: string; textClass: string; label: string }
> = {
  connected: {
    dotClass: "bg-profit",
    textClass: "text-profit",
    label: "Connected",
  },
  reconnecting: {
    dotClass: "bg-warning animate-pulse",
    textClass: "text-warning",
    label: "Reconnecting...",
  },
  disconnected: {
    dotClass: "bg-loss",
    textClass: "text-loss",
    label: "Disconnected",
  },
};

function StatItem({
  label,
  value,
  ariaLabel,
}: {
  label: string;
  value: string;
  ariaLabel: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-medium text-text-secondary">{label}</span>
      <span
        className="text-sm font-bold font-mono text-text-muted"
        aria-label={ariaLabel}
      >
        {value}
      </span>
    </div>
  );
}

export function TopBar() {
  const connection = useStore((s) => s.connection);
  const stats = useStore((s) => s.stats);
  const config = STATUS_CONFIG[connection.status];

  return (
    <header>
      <Card className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold">ValBot</h1>
            <div
              className="flex items-center gap-1.5"
              aria-live="assertive"
              role="status"
            >
              <span
                className={cn(
                  "inline-block h-2 w-2 rounded-full",
                  config.dotClass,
                )}
              />
              <span className={cn("text-xs font-medium", config.textClass)}>
                {config.label}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-6">
            <StatItem
              label="Wallet:"
              value={formatCurrency(fromSmallestUnit(stats.walletBalance))}
              ariaLabel={`Wallet balance: ${formatCurrency(fromSmallestUnit(stats.walletBalance))}`}
            />
            <StatItem
              label="Total PnL:"
              value={formatCurrency(fromSmallestUnit(stats.totalPnl), true)}
              ariaLabel={`Total profit and loss: ${formatCurrency(fromSmallestUnit(stats.totalPnl), true)}`}
            />
            <StatItem
              label="Session PnL:"
              value={formatCurrency(fromSmallestUnit(stats.sessionPnl), true)}
              ariaLabel={`Session profit and loss: ${formatCurrency(fromSmallestUnit(stats.sessionPnl), true)}`}
            />
            <StatItem
              label="Trades:"
              value={formatInteger(stats.totalTrades)}
              ariaLabel={`Total trades: ${formatInteger(stats.totalTrades)}`}
            />
            <StatItem
              label="Volume:"
              value={formatCurrency(fromSmallestUnit(stats.totalVolume))}
              ariaLabel={`Total volume: ${formatCurrency(fromSmallestUnit(stats.totalVolume))}`}
            />
          </div>
        </div>
      </Card>
    </header>
  );
}
