import { TopBar } from "./components/top-bar";
import { ModeCard } from "./components/mode-card";
import { PositionsTable } from "./components/positions-table";
import { TradeLog } from "./components/trade-log";
import { AlertBanner } from "./components/alert-banner";
import { useWebSocket } from "./hooks/use-websocket";
import useStore from "./store";

const MODES = [
  { name: "Volume Max", color: "text-mode-volume" },
  { name: "Profit Hunter", color: "text-mode-profit" },
  { name: "Arbitrage", color: "text-mode-arb" },
] as const;

function App() {
  useWebSocket();
  const alerts = useStore((s) => s.alerts);
  const dismissAlert = useStore((s) => s.dismissAlert);
  const bannerAlerts = alerts.filter(
    (a) => a.severity === "critical" || a.severity === "warning",
  );

  return (
    <div className="flex flex-col h-screen min-w-[1280px] bg-background overflow-hidden">
      <AlertBanner alerts={bannerAlerts} onDismiss={dismissAlert} />

      <div className="grid grid-rows-[auto_auto_1fr] flex-1 min-h-0 gap-4 p-4">
        {/* Top Bar */}
        <TopBar />

        {/* Mode Cards Row */}
        <div className="grid grid-cols-3 gap-4">
          {MODES.map((mode) => (
            <ModeCard key={mode.name} mode={mode} />
          ))}
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
