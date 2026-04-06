import { useEffect } from "react";
import { TopBar } from "./components/top-bar";
import { ModeCard } from "./components/mode-card";
import { MaxAllocationControl } from "./components/max-allocation-control";
import { PositionsTable } from "./components/positions-table";
import { TradeLog } from "./components/trade-log";
import { AlertBanner } from "./components/alert-banner";
import { Toaster } from "./components/ui/sonner";
import { useAlertToast } from "./hooks/use-alert-toast";
import { useWebSocket } from "./hooks/use-websocket";
import useStore from "./store";
import { fetchStatus } from "./lib/api";
import type { ModeType } from "@shared/types";

const MODES = [
  { mode: "volumeMax" as ModeType, name: "Volume Max", color: "text-mode-volume", barColor: "#8b5cf6" },
  { mode: "profitHunter" as ModeType, name: "Profit Hunter", color: "text-mode-profit", barColor: "#22c55e" },
  { mode: "arbitrage" as ModeType, name: "Arbitrage", color: "text-mode-arb", barColor: "#06b6d4" },
] as const;

function App() {
  useWebSocket();
  useAlertToast();
  const alerts = useStore((s) => s.alerts);
  const dismissAlert = useStore((s) => s.dismissAlert);
  const loadInitialStatus = useStore((s) => s.loadInitialStatus);

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
    <div className="flex flex-col h-screen min-w-[1280px] bg-background overflow-hidden">
      <Toaster />
      <AlertBanner alerts={bannerAlerts} onDismiss={dismissAlert} />

      <div className="grid grid-rows-[auto_auto_1fr] flex-1 min-h-0 gap-4 p-4">
        {/* Top Bar */}
        <TopBar />

        {/* Max Allocation + Mode Cards */}
        <div className="flex flex-col gap-2">
          <MaxAllocationControl />
          <div className="grid grid-cols-3 gap-4">
            {MODES.map((m) => (
              <ModeCard key={m.mode} mode={m.mode} name={m.name} color={m.color} barColor={m.barColor} />
            ))}
          </div>
        </div>

        {/* Bottom Split: Positions Table (3fr) + Trade Log (2fr) */}
        <div className="grid grid-cols-[3fr_2fr] gap-4 min-h-0">
          <PositionsTable />
          <TradeLog />
        </div>
      </div>
    </div>
  );
}

export default App;
