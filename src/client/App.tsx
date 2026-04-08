import { useEffect, useState, useCallback, useMemo, useRef } from "react";
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
import { fetchStatus, stopMode } from "./lib/api";
import { toast } from "sonner";
import type { ModeType } from "@shared/types";

const SLOT_COUNT = 3;
const STORAGE_KEY = "strategySlots";

function parseSavedSlots(raw: string | null): (ModeType | null)[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const result = (parsed as (ModeType | null)[]).slice(0, SLOT_COUNT);
    while (result.length < SLOT_COUNT) result.push(null);
    return result;
  } catch {
    return null;
  }
}

function App() {
  useWebSocket();
  useAlertToast();
  const alerts = useStore((s) => s.alerts);
  const dismissAlert = useStore((s) => s.dismissAlert);
  const loadInitialStatus = useStore((s) => s.loadInitialStatus);
  const strategies = useStore((s) => s.strategies);
  const modes = useStore((s) => s.modes);
  const phActive = useStore((s) => {
    const status = s.modes["profitHunter"]?.status;
    return status === "running" || status === "error";
  });
  const slotsInitialized = useRef(false);

  const [slots, setSlots] = useState<(ModeType | null)[]>(() => {
    const saved = parseSavedSlots(localStorage.getItem(STORAGE_KEY));
    return saved ?? Array(SLOT_COUNT).fill(null);
  });

  // Initialize slots with first N strategies once loaded (runs once)
  useEffect(() => {
    if (strategies.length === 0 || slotsInitialized.current) return;
    slotsInitialized.current = true;
    const saved = parseSavedSlots(localStorage.getItem(STORAGE_KEY));
    if (saved) {
      const validTypes = new Set(strategies.map((s) => s.modeType));
      const validated = saved.map((m) => (m && validTypes.has(m) ? m : null));
      setSlots(validated);
      return;
    }
    const initial: (ModeType | null)[] = strategies.slice(0, SLOT_COUNT).map((s) => s.modeType);
    while (initial.length < SLOT_COUNT) initial.push(null);
    setSlots(initial);
  }, [strategies]);

  // Persist to localStorage on change
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(slots));
    } catch {
      // Storage full — ignore, slots still work in memory
    }
  }, [slots]);

  const assignedModes = useMemo(() => {
    const set = new Set<ModeType>();
    for (const s of slots) {
      if (s) set.add(s);
    }
    return set;
  }, [slots]);

  const strategyOptions = useMemo(
    () => strategies.map((s) => ({ modeType: s.modeType, name: s.name, modeColor: s.modeColor })),
    [strategies],
  );

  const handleSlotChange = useCallback(
    (slotIndex: number, newMode: ModeType) => {
      setSlots((prev) => {
        // Dedup guard: if newMode is already assigned to another slot, reject
        if (prev.some((s, i) => s === newMode && i !== slotIndex)) return prev;

        const currentMode = prev[slotIndex];
        const next = [...prev];
        next[slotIndex] = newMode;

        // If running, stop in background
        const currentStatus = currentMode ? modes[currentMode]?.status : undefined;
        const isRunning = currentStatus === "running" || currentStatus === "starting";
        if (isRunning && currentMode) {
          stopMode(currentMode).catch(() => {
            setSlots((revertPrev) => {
              const revertNext = [...revertPrev];
              // Only revert if slot still holds the newMode we set
              if (revertNext[slotIndex] === newMode) {
                revertNext[slotIndex] = currentMode;
              }
              return revertNext;
            });
            toast.error("Failed to stop strategy — swap reverted");
          });
        }

        return next;
      });
    },
    [modes],
  );

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
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${SLOT_COUNT}, minmax(0, 1fr))`, gap: "1rem" }}>
            {slots.map((slotMode, idx) => {
              const strategy = slotMode ? strategies.find((s) => s.modeType === slotMode) : undefined;
              return (
                <ModeCard
                  key={slotMode ?? `empty-${idx}`}
                  mode={slotMode}
                  name={strategy?.name ?? ""}
                  description={strategy?.description ?? ""}
                  color={strategy?.modeColor ?? ""}
                  barColor={strategy?.modeColor ?? ""}
                  strategies={strategyOptions}
                  assignedModes={assignedModes}
                  onSelectStrategy={(modeType) => handleSlotChange(idx, modeType)}
                />
              );
            })}
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
