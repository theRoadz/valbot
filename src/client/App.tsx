import { useEffect } from "react";
import { TopBar } from "./components/top-bar";
import { ModeCard } from "./components/mode-card";
import { MaxAllocationControl } from "./components/max-allocation-control";
import { PositionsTable } from "./components/positions-table";
import { TradeHistoryTable } from "./components/trade-history-table";
import { TradeLog } from "./components/trade-log";
import { ActivityLog } from "./components/activity-log";
import { AlertBanner } from "./components/alert-banner";
import { Toaster } from "./components/ui/sonner";
import { useAlertToast } from "./hooks/use-alert-toast";
import { useWebSocket } from "./hooks/use-websocket";
import useStore from "./store";
import { fetchStatus } from "./lib/api";

function App() {
  useWebSocket();
  useAlertToast();
  const alerts = useStore((s) => s.alerts);
  const dismissAlert = useStore((s) => s.dismissAlert);
  const loadInitialStatus = useStore((s) => s.loadInitialStatus);
  const strategies = useStore((s) => s.strategies);
  const phActive = useStore((s) => {
    const status = s.modes["profitHunter"]?.status;
    return status === "running" || status === "error";
  });

  useEffect(() => {
    fetchStatus()
      .then((data) => loadInitialStatus(data))
      .catch((err) => {
        if (import.meta.env.DEV) console.error("[App] Initial status fetch failed:", err);
      });
  }, [loadInitialStatus]);
  const bannerAlerts = alerts.filter(
    (a) => a.severity === "critical",
  );

  return (
    <div className="flex flex-col min-h-screen min-w-[1280px] bg-background overflow-auto">
      <Toaster />
      <AlertBanner alerts={bannerAlerts} onDismiss={dismissAlert} />

      <main className="grid grid-rows-[auto_auto_1fr] flex-1 min-h-0 gap-4 p-4">
        {/* Top Bar */}
        <TopBar />

        {/* Max Allocation + Mode Cards */}
        <div className="flex flex-col gap-2">
          <MaxAllocationControl />
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${strategies.length || 1}, minmax(0, 1fr))`, gap: "1rem" }}>
            {strategies.map((s) => (
              <ModeCard key={s.modeType} mode={s.modeType} name={s.name} description={s.description} color={s.modeColor} barColor={s.modeColor} />
            ))}
          </div>
        </div>

        {/* Bottom Split: Positions + Trade History (3fr) + Trade Log (2fr) */}
        <div className="grid grid-cols-[3fr_2fr] gap-4 min-h-[400px]">
          <div className="grid grid-rows-[auto_auto_1fr] gap-4 min-h-0">
            <PositionsTable />
            {phActive && <ActivityLog />}
            <TradeHistoryTable />
          </div>
          <TradeLog />
        </div>
      </main>
    </div>
  );
}

export default App;
