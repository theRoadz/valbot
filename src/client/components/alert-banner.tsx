import { useState } from "react";
import { AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";
import type { Alert } from "@shared/types";
import { cn } from "@client/lib/utils";
import useStore from "@client/store";

/** USDC amounts stored in smallest unit (micro-USDC, 6 decimals) */
const USDC_DECIMALS = 1e6;

interface AlertBannerProps {
  alerts: Alert[];
  onDismiss: (id: number) => void;
}

export function AlertBanner({ alerts, onDismiss }: AlertBannerProps) {
  if (alerts.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 p-2" role="alert" aria-live="assertive">
      {alerts.map((alert) => (
        <AlertBannerItem key={alert.id} alert={alert} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function AlertBannerItem({
  alert,
  onDismiss,
}: {
  alert: Alert;
  onDismiss: (id: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const modes = useStore((s) => s.modes);

  // Correlate kill switch detail to the specific mode from the alert payload
  const killSwitchDetail =
    alert.code === "KILL_SWITCH_TRIGGERED" && alert.mode
      ? modes[alert.mode]?.killSwitchDetail ?? null
      : null;

  const hasDetails = alert.details || alert.resolution || killSwitchDetail;

  return (
    <div
      className={cn(
        "relative rounded-md border px-4 py-3",
        alert.severity === "critical" && "border-loss bg-loss/10 text-loss",
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <p className="font-semibold text-sm">
              [{alert.code}] {alert.message}
            </p>
            {hasDetails && (
              <button
                onClick={() => setExpanded(!expanded)}
                className="shrink-0 opacity-60 hover:opacity-100 transition-opacity"
                aria-label={expanded ? "Collapse details" : "Expand details"}
              >
                {expanded ? (
                  <ChevronUp className="h-4 w-4" />
                ) : (
                  <ChevronDown className="h-4 w-4" />
                )}
              </button>
            )}
          </div>
          {expanded && (
            <div className="mt-2 space-y-1">
              {killSwitchDetail && (
                <p className="text-xs font-mono opacity-80">
                  Positions closed: {killSwitchDetail.positionsClosed} | Loss: $
                  {(killSwitchDetail.lossAmount / USDC_DECIMALS).toFixed(2)}
                </p>
              )}
              {alert.details && (
                <p className="text-xs opacity-80">{alert.details}</p>
              )}
              {alert.resolution && (
                <pre className="text-xs opacity-70 whitespace-pre-line font-mono">
                  {alert.resolution}
                </pre>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
