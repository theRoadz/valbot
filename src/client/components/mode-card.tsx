import { Card, CardContent, CardHeader } from "./ui/card";
import { Badge } from "./ui/badge";
import { Switch } from "./ui/switch";

interface ModeCardProps {
  mode: {
    name: string;
    color: string;
  };
}

function StatCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-text-secondary">{label}</span>
      <span className="text-2xl font-bold font-mono text-text-muted">{value}</span>
    </div>
  );
}

export function ModeCard({ mode }: ModeCardProps) {
  return (
    <Card>
      <CardHeader className="p-4 pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className={`text-lg font-semibold ${mode.color}`}>{mode.name}</span>
            <Badge variant="secondary" className="text-text-muted">
              Stopped
            </Badge>
          </div>
          <Switch disabled />
        </div>
      </CardHeader>
      <CardContent className="p-4 pt-0">
        <div className="grid grid-cols-2 gap-3">
          <StatCell label="PnL" value="$0.00" />
          <StatCell label="Trades" value="0" />
          <StatCell label="Volume" value="$0.00" />
          <StatCell label="Allocated" value="$0.00" />
        </div>
        <div className="mt-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium text-text-secondary">Fund Allocation</span>
            <span className="text-xs font-mono text-text-muted">Not allocated</span>
          </div>
          <div className="h-2 w-full rounded-full bg-surface-elevated">
            <div
              className="h-full rounded-full bg-neutral"
              style={{ width: "0%" }}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
