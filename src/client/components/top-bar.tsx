import { Card } from "./ui/card";

function StatItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs font-medium text-text-secondary">{label}</span>
      <span className="text-sm font-bold font-mono text-text-muted">{value}</span>
    </div>
  );
}

export function TopBar() {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">ValBot</h1>
          <div className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-neutral" />
            <span className="text-xs font-medium text-text-muted">Disconnected</span>
          </div>
        </div>
        <div className="flex items-center gap-6">
          <StatItem label="Wallet:" value="$0.00" />
          <StatItem label="Total PnL:" value="$0.00" />
          <StatItem label="Session PnL:" value="$0.00" />
          <StatItem label="Trades:" value="0" />
          <StatItem label="Volume:" value="$0.00" />
        </div>
      </div>
    </Card>
  );
}
