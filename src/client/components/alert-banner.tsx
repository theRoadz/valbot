import type { Alert } from "@shared/types";
import { cn } from "@client/lib/utils";

interface AlertBannerProps {
  alerts: Alert[];
  onDismiss: (id: number) => void;
}

export function AlertBanner({ alerts, onDismiss }: AlertBannerProps) {
  if (alerts.length === 0) return null;

  return (
    <div className="flex flex-col gap-2 p-2" role="alert" aria-live="assertive">
      {alerts.map((alert) => (
        <div
          key={alert.id}
          className={cn(
            "relative rounded-md border px-4 py-3",
            alert.severity === "critical" &&
              "border-loss bg-loss/10 text-loss",
            alert.severity === "warning" &&
              "border-warning bg-warning/10 text-warning",
          )}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-sm">
                [{alert.code}] {alert.message}
              </p>
              {alert.details && (
                <p className="mt-1 text-xs opacity-80">{alert.details}</p>
              )}
              {alert.resolution && (
                <pre className="mt-2 text-xs opacity-70 whitespace-pre-line font-mono">
                  {alert.resolution}
                </pre>
              )}
            </div>
            {alert.severity === "warning" && (
              <button
                onClick={() => onDismiss(alert.id)}
                className="shrink-0 text-xs opacity-60 hover:opacity-100 transition-opacity"
                aria-label="Dismiss alert"
              >
                ✕
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
