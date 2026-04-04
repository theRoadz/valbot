import { Card } from "./ui/card";
import useStore from "@client/store";
import { cn } from "@client/lib/utils";
import type { ConnectionStatus } from "@shared/types";

function formatCurrency(valueSmallestUnit: number, showSign = false): string {
  const value = valueSmallestUnit / 1e6;
  const formatted = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Math.abs(value));

  if (showSign && value > 0) return `+$${formatted}`;
  if (showSign && value < 0) return `-$${formatted}`;
  return `$${formatted}`;
}

function formatInteger(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

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
              value={formatCurrency(stats.walletBalance)}
              ariaLabel={`Wallet balance: ${formatCurrency(stats.walletBalance)}`}
            />
            <StatItem
              label="Total PnL:"
              value={formatCurrency(stats.totalPnl, true)}
              ariaLabel={`Total profit and loss: ${formatCurrency(stats.totalPnl, true)}`}
            />
            <StatItem
              label="Session PnL:"
              value={formatCurrency(stats.sessionPnl, true)}
              ariaLabel={`Session profit and loss: ${formatCurrency(stats.sessionPnl, true)}`}
            />
            <StatItem
              label="Trades:"
              value={formatInteger(stats.totalTrades)}
              ariaLabel={`Total trades: ${formatInteger(stats.totalTrades)}`}
            />
            <StatItem
              label="Volume:"
              value={formatCurrency(stats.totalVolume)}
              ariaLabel={`Total volume: ${formatCurrency(stats.totalVolume)}`}
            />
          </div>
        </div>
      </Card>
    </header>
  );
}
