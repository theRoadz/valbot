import { useRef, useState, useCallback, useEffect } from "react";
import { Card, CardContent, CardHeader } from "./ui/card";
import { Badge } from "./ui/badge";
import { Switch } from "./ui/switch";
import { Input } from "./ui/input";
import useStore from "@client/store";
import * as api from "@client/lib/api";
import { formatCurrency, formatInteger } from "@client/lib/format";
import { cn } from "@client/lib/utils";
import type { ModeType, ModeStatus } from "@shared/types";
import { Flame } from "lucide-react";
import { toast } from "sonner";

interface StrategyOption {
  modeType: ModeType;
  name: string;
  modeColor: string;
}

interface ModeCardProps {
  mode: ModeType | null;
  name: string;
  description: string;
  color: string;
  barColor: string;
  strategies?: StrategyOption[];
  assignedModes?: Set<ModeType>;
  onSelectStrategy?: (modeType: ModeType) => void;
}

const AVAILABLE_PAIRS = ["SOL/USDC", "ETH/USDC", "BTC/USDC"];

const STATUS_BADGE: Record<ModeStatus, { className: string; label: string }> = {
  stopped: { className: "bg-neutral text-text-muted", label: "Stopped" },
  starting: { className: "bg-profit text-white", label: "Starting..." },
  running: { className: "bg-profit text-white", label: "Running" },
  stopping: { className: "bg-neutral text-text-muted", label: "Stopping..." },
  error: { className: "bg-loss text-white", label: "Error" },
  "kill-switch": { className: "bg-loss text-white animate-pulse", label: "Kill Switch" },
};

function StatCell({
  label,
  value,
  colorClass,
}: {
  label: string;
  value: string;
  colorClass: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-text-secondary">{label}</span>
      <span
        className={cn("text-2xl font-bold font-mono", colorClass)}
        aria-live="polite"
      >
        {value}
      </span>
    </div>
  );
}

function FundAllocationBar({
  allocated,
  remaining,
  modeColor,
}: {
  allocated: number;
  remaining: number;
  modeColor: string;
}) {
  if (allocated === 0) {
    return (
      <div className="mt-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-medium text-text-secondary">
            Fund Allocation
          </span>
          <span className="text-xs font-mono text-text-muted">
            Not allocated
          </span>
        </div>
        <div className="h-2 w-full rounded-full bg-surface-elevated">
          <div className="h-full rounded-full bg-neutral" style={{ width: "0%" }} />
        </div>
      </div>
    );
  }

  const usedPercent = ((allocated - remaining) / allocated) * 100;
  let fillColor = modeColor;
  if (usedPercent > 90) fillColor = "#ef4444";
  else if (usedPercent > 80) fillColor = "#f59e0b";

  return (
    <div className="mt-3">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-text-secondary">
          Fund Allocation
        </span>
        <span className="text-xs font-mono text-text-muted">
          {formatCurrency(remaining)} / {formatCurrency(allocated)} remaining
        </span>
      </div>
      <div className="h-2 w-full rounded-full bg-surface-elevated">
        <div
          className="h-full rounded-full"
          style={{
            width: `${Math.min(usedPercent, 100)}%`,
            backgroundColor: fillColor,
            transition: "width 200ms ease, background-color 200ms ease",
          }}
        />
      </div>
    </div>
  );
}

function StrategySelector({
  strategies,
  assignedModes,
  currentMode,
  currentStatus,
  onSelect,
}: {
  strategies: StrategyOption[];
  assignedModes: Set<ModeType>;
  currentMode: ModeType | null;
  currentStatus?: ModeStatus;
  onSelect: (modeType: ModeType) => void;
}) {
  const [open, setOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const isRunning = currentStatus === "running" || currentStatus === "starting";

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current && !dropdownRef.current.contains(e.target as Node) &&
        triggerRef.current && !triggerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  // Focus the active option when dropdown opens or focusedIndex changes
  useEffect(() => {
    if (open && focusedIndex >= 0) {
      optionRefs.current[focusedIndex]?.focus();
    }
  }, [open, focusedIndex]);

  const currentStrategy = strategies.find((s) => s.modeType === currentMode);
  const displayLabel = currentStrategy ? currentStrategy.name : "Select Strategy";

  const openDropdown = () => {
    setOpen(true);
    // Focus current selection or first non-disabled item
    const startIdx = strategies.findIndex((s) => s.modeType === currentMode);
    setFocusedIndex(startIdx >= 0 ? startIdx : findNextEnabledIndex(-1, 1));
  };

  const findNextEnabledIndex = (from: number, direction: 1 | -1): number => {
    let idx = from + direction;
    while (idx >= 0 && idx < strategies.length) {
      const s = strategies[idx];
      const isAssigned = assignedModes.has(s.modeType) && s.modeType !== currentMode;
      if (!isAssigned) return idx;
      idx += direction;
    }
    return from; // stay put if no enabled item found
  };

  const handleTriggerKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" && open) {
      setOpen(false);
    } else if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (!open) openDropdown();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) openDropdown();
    }
  };

  const handleListKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setOpen(false);
      triggerRef.current?.focus();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusedIndex((prev) => findNextEnabledIndex(prev, 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusedIndex((prev) => findNextEnabledIndex(prev, -1));
    } else if (e.key === "Home") {
      e.preventDefault();
      setFocusedIndex(findNextEnabledIndex(-1, 1));
    } else if (e.key === "End") {
      e.preventDefault();
      setFocusedIndex(findNextEnabledIndex(strategies.length, -1));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (focusedIndex >= 0) {
        const s = strategies[focusedIndex];
        const isAssigned = assignedModes.has(s.modeType) && s.modeType !== currentMode;
        if (!isAssigned && s.modeType !== currentMode) {
          onSelect(s.modeType);
          setOpen(false);
          triggerRef.current?.focus();
        }
      }
    }
  };

  return (
    <div className="relative mb-2">
      <button
        ref={triggerRef}
        type="button"
        className="w-full h-8 px-3 text-left text-sm rounded-md border border-input bg-background flex items-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        onClick={() => open ? setOpen(false) : openDropdown()}
        onKeyDown={handleTriggerKeyDown}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label="Select strategy"
      >
        {currentStrategy && (
          <span
            className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
            style={{ backgroundColor: currentStrategy.modeColor }}
          />
        )}
        <span className={currentStrategy ? "text-text-primary" : "text-text-muted"}>
          {displayLabel}
        </span>
      </button>
      {open && (
        <div
          ref={dropdownRef}
          role="listbox"
          aria-label="Strategy options"
          aria-activedescendant={focusedIndex >= 0 ? `strategy-option-${strategies[focusedIndex].modeType}` : undefined}
          className="absolute z-10 mt-1 w-full rounded-md border border-input bg-background shadow-lg"
          onKeyDown={handleListKeyDown}
        >
          {isRunning && (
            <div className="px-3 py-1.5 text-xs text-warning border-b border-input flex items-center gap-1.5">
              <span className="inline-block w-2 h-2 rounded-full bg-warning" />
              Will stop current strategy
            </div>
          )}
          {strategies.map((s, i) => {
            const isAssigned = assignedModes.has(s.modeType) && s.modeType !== currentMode;
            return (
              <button
                key={s.modeType}
                ref={(el) => { optionRefs.current[i] = el; }}
                id={`strategy-option-${s.modeType}`}
                type="button"
                role="option"
                tabIndex={i === focusedIndex ? 0 : -1}
                aria-selected={s.modeType === currentMode}
                aria-disabled={isAssigned}
                disabled={isAssigned}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left",
                  isAssigned
                    ? "opacity-50 cursor-not-allowed text-text-muted"
                    : "hover:bg-surface-elevated cursor-pointer",
                  s.modeType === currentMode && "bg-surface-elevated",
                  i === focusedIndex && !isAssigned && "bg-surface-elevated",
                )}
                onClick={() => {
                  if (!isAssigned && s.modeType !== currentMode) {
                    onSelect(s.modeType);
                    setOpen(false);
                    triggerRef.current?.focus();
                  }
                }}
              >
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                  style={{ backgroundColor: s.modeColor }}
                />
                <span>{s.name}{isAssigned ? " (in use)" : ""}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RsiConfigInputs({
  rsiPeriod,
  oversoldThreshold,
  overboughtThreshold,
  exitRsi,
  disabled,
  mode,
  name,
  setModeConfig,
}: {
  rsiPeriod: number;
  oversoldThreshold: number;
  overboughtThreshold: number;
  exitRsi: number;
  disabled: boolean;
  mode: ModeType;
  name: string;
  setModeConfig: (mode: ModeType, config: Partial<{ rsiPeriod: number; oversoldThreshold: number; overboughtThreshold: number; exitRsi: number }>) => void;
}) {
  const commitRsiField = (field: string, value: string, min: number, max: number) => {
    const num = parseFloat(value);
    if (isNaN(num) || num < min || num > max) return;
    const rounded = Math.round(num);
    // Cross-field validation: oversold < exitRsi < overbought
    if (field === "oversoldThreshold" && (rounded >= overboughtThreshold || rounded >= exitRsi)) return;
    if (field === "overboughtThreshold" && (rounded <= oversoldThreshold || rounded <= exitRsi)) return;
    if (field === "exitRsi" && (rounded <= oversoldThreshold || rounded >= overboughtThreshold)) return;
    setModeConfig(mode, { [field]: rounded });
    api.updateModeConfig(mode, { [field]: rounded }).catch((err) => {
      if (import.meta.env.DEV) console.error(`[ModeCard] RSI config update failed:`, err);
    });
  };

  const rsiFields: { label: string; field: string; value: number; min: number; max: number }[] = [
    { label: "RSI Period", field: "rsiPeriod", value: rsiPeriod, min: 2, max: 50 },
    { label: "Oversold", field: "oversoldThreshold", value: oversoldThreshold, min: 0, max: 100 },
    { label: "Overbought", field: "overboughtThreshold", value: overboughtThreshold, min: 0, max: 100 },
    { label: "Exit RSI", field: "exitRsi", value: exitRsi, min: 0, max: 100 },
  ];

  return (
    <div className="mt-3 grid grid-cols-2 gap-2">
      {rsiFields.map(({ label, field, value, min, max }) => (
        <div key={`${field}-${value}`} className="flex items-center gap-1">
          <span className="text-xs font-medium text-text-secondary whitespace-nowrap">{label}:</span>
          <Input
            type="text"
            className="h-7 w-16 font-mono text-center text-sm"
            defaultValue={String(value)}
            onBlur={(e) => commitRsiField(field, e.target.value, min, max)}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
            disabled={disabled}
            aria-label={`${label} for ${name}`}
          />
        </div>
      ))}
    </div>
  );
}

export function ModeCard({ mode, name, description, color, barColor, strategies, assignedModes, onSelectStrategy }: ModeCardProps) {
  const modeState = useStore((s) => mode ? s.modes[mode] : undefined);
  const totalAllocated = useStore((s) =>
    Object.values(s.modes).reduce((sum, m) => sum + m.allocation, 0),
  );
  const setModeStatus = useStore((s) => s.setModeStatus);
  const setModeConfig = useStore((s) => s.setModeConfig);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const togglingRef = useRef(false);
  const [pairDropdownOpen, setPairDropdownOpen] = useState(false);
  const pairTriggerRef = useRef<HTMLButtonElement>(null);
  const pairDropdownRef = useRef<HTMLDivElement>(null);
  const [allocationInput, setAllocationInput] = useState("");
  const [allocationFocused, setAllocationFocused] = useState(false);
  const [slippageInput, setSlippageInput] = useState("");
  const [slippageFocused, setSlippageFocused] = useState(false);
  const [positionSizeInput, setPositionSizeInput] = useState("");
  const [positionSizeFocused, setPositionSizeFocused] = useState(false);
  const pairTogglingRef = useRef(false);

  const clearSafetyTimeout = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
  }, []);

  useEffect(() => () => clearSafetyTimeout(), [clearSafetyTimeout]);

  // Focus first checkbox when pair dropdown opens
  useEffect(() => {
    if (pairDropdownOpen && pairDropdownRef.current) {
      const firstCheckbox = pairDropdownRef.current.querySelector<HTMLInputElement>('input[type="checkbox"]');
      firstCheckbox?.focus();
    }
  }, [pairDropdownOpen]);

  // Close pair dropdown on click outside
  useEffect(() => {
    if (!pairDropdownOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (
        pairDropdownRef.current && !pairDropdownRef.current.contains(e.target as Node) &&
        pairTriggerRef.current && !pairTriggerRef.current.contains(e.target as Node)
      ) {
        setPairDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [pairDropdownOpen]);

  const handleToggle = useCallback(
    async (checked: boolean) => {
      if (!mode || !modeState) return;
      if (togglingRef.current) return;
      togglingRef.current = true;
      clearSafetyTimeout();

      const { pairs, slippage } = modeState;
      const revertStatus = checked ? "stopped" : "running";
      const targetStatus = checked ? "starting" : "stopping";

      setModeStatus(mode, targetStatus);

      const controller = new AbortController();
      abortRef.current = controller;

      timeoutRef.current = setTimeout(() => {
        controller.abort();
        setModeStatus(mode, revertStatus);
        togglingRef.current = false;
      }, 2000);

      try {
        if (checked) {
          await api.startMode(mode, { pairs, slippage });
        } else {
          await api.stopMode(mode);
        }
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
        abortRef.current = null;
      } catch (e) {
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
          timeoutRef.current = null;
        }
        abortRef.current = null;
        setModeStatus(mode, revertStatus);
        if (import.meta.env.DEV && e instanceof api.ApiError) {
          console.error(`[ModeCard] Toggle failed:`, e.code, e.message, e.resolution);
        }
      } finally {
        togglingRef.current = false;
      }
    },
    [mode, modeState, setModeStatus, clearSafetyTimeout],
  );

  // Empty slot placeholder
  if (!mode || !modeState) {
    return (
      <Card className="border-dashed border-text-muted/30">
        <CardHeader className="p-4 pb-3">
          {strategies && onSelectStrategy ? (
            <StrategySelector
              strategies={strategies}
              assignedModes={assignedModes ?? new Set()}
              currentMode={null}
              onSelect={onSelectStrategy}
            />
          ) : (
            <span className="text-sm text-text-muted">Select Strategy</span>
          )}
        </CardHeader>
        <CardContent className="p-4 pt-0">
          <div className="flex items-center justify-center h-32 text-text-muted text-sm">
            No strategy selected
          </div>
        </CardContent>
      </Card>
    );
  }

  const { status, stats, allocation, maxAllocation: modeMaxAllocation, positionSize, pairs, slippage, errorDetail, killSwitchDetail, rsiPeriod, oversoldThreshold, overboughtThreshold, exitRsi } = modeState;
  const maxAlloc = modeMaxAllocation ?? 500;
  const availableForMode = Math.max(0, maxAlloc - totalAllocated + allocation);

  const isRunning = status === "running" || status === "starting";
  const isDisabledToggle = allocation === 0 || status === "error" || status === "kill-switch" || status === "stopping";

  // Allocation input handlers
  const displayedAllocation = allocationFocused ? allocationInput : String(allocation);

  const handleAllocationFocus = () => {
    setAllocationInput(String(allocation));
    setAllocationFocused(true);
  };

  const handleAllocationChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.replace(/[^0-9.]/g, "");
    setAllocationInput(val);
  };

  const handleAllocationCommit = () => {
    setAllocationFocused(false);
    const numVal = parseFloat(allocationInput);
    if (!isNaN(numVal) && isFinite(numVal) && numVal >= 0 && numVal !== allocation) {
      const prevAllocation = allocation;
      const prevStatus = status;
      setModeConfig(mode, { allocation: numVal });
      api.updateModeConfig(mode, { allocation: numVal }).catch((err) => {
        setModeConfig(mode, { allocation: prevAllocation });
        if (prevStatus === "kill-switch") setModeStatus(mode, "kill-switch");
        const msg = err instanceof Error ? err.message : "Allocation update failed";
        toast.warning(msg);
        if (import.meta.env.DEV) console.error("[ModeCard] Allocation update failed:", err);
      });
    }
  };

  const handleAllocationKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      (e.target as HTMLInputElement).blur();
    }
  };

  // Slippage input handlers
  const displayedSlippage = slippageFocused ? slippageInput : slippage.toFixed(1);

  const handleSlippageFocus = () => {
    setSlippageInput(slippage.toFixed(1));
    setSlippageFocused(true);
  };

  const handleSlippageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.replace(/[^0-9.]/g, "");
    setSlippageInput(val);
  };

  const handleSlippageCommit = () => {
    setSlippageFocused(false);
    const numVal = parseFloat(slippageInput);
    if (isNaN(numVal) || numVal < 0.1 || numVal > 5.0) {
      return;
    }
    const rounded = Math.round(numVal * 10) / 10;
    if (rounded !== slippage) {
      api.updateModeConfig(mode, { slippage: rounded }).catch((err) => {
        if (import.meta.env.DEV) console.error("[ModeCard] Slippage update failed:", err);
      });
    }
  };

  const handleSlippageKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      (e.target as HTMLInputElement).blur();
    }
  };

  // Position size input handlers
  const autoPositionSize = allocation > 0 ? Math.floor(allocation / 20) : 0;
  const displayedPositionSize = positionSizeFocused
    ? positionSizeInput
    : positionSize !== undefined ? String(positionSize) : "";

  const handlePositionSizeFocus = () => {
    setPositionSizeInput(positionSize !== undefined ? String(positionSize) : "");
    setPositionSizeFocused(true);
  };

  const handlePositionSizeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.replace(/[^0-9.]/g, "");
    setPositionSizeInput(val);
  };

  const handlePositionSizeCommit = () => {
    setPositionSizeFocused(false);
    const trimmed = positionSizeInput.trim();
    if (trimmed === "" || trimmed.toLowerCase() === "auto") {
      if (positionSize !== undefined) {
        const prevPositionSize = positionSize;
        setModeConfig(mode, { positionSize: undefined });
        api.updateModeConfig(mode, { positionSize: null }).catch(() => {
          setModeConfig(mode, { positionSize: prevPositionSize });
        });
      }
      return;
    }
    const numVal = parseFloat(trimmed);
    if (!isNaN(numVal) && isFinite(numVal) && numVal >= 10 && numVal <= 100000 && numVal !== positionSize) {
      const prevPositionSize = positionSize;
      setModeConfig(mode, { positionSize: numVal });
      api.updateModeConfig(mode, { positionSize: numVal }).catch((err) => {
        setModeConfig(mode, { positionSize: prevPositionSize });
        if (import.meta.env.DEV) console.error("[ModeCard] Position size update failed:", err);
      });
    }
  };

  const handlePositionSizeKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
  };

  const handlePairToggle = (pair: string) => {
    if (pairTogglingRef.current) return;
    const newPairs = pairs.includes(pair)
      ? pairs.filter((p) => p !== pair)
      : [...pairs, pair];
    if (newPairs.length === 0) return; // must select at least 1
    const prevPairs = pairs;
    pairTogglingRef.current = true;
    setModeConfig(mode, { pairs: newPairs });
    api.updateModeConfig(mode, { pairs: newPairs }).catch((err) => {
      setModeConfig(mode, { pairs: prevPairs });
      toast.warning("Pair selection failed — reverted to previous selection");
      if (import.meta.env.DEV) console.error("[ModeCard] Pair update failed:", err);
    }).finally(() => {
      pairTogglingRef.current = false;
    });
  };

  const isMuted = status === "error" || status === "kill-switch";

  const pnlColor =
    isMuted
      ? "text-text-muted"
      : stats.pnl > 0
        ? "text-profit"
        : stats.pnl < 0
          ? "text-loss"
          : "text-text-muted";

  const statColor = isMuted ? "text-text-muted" : "text-text-primary";

  const badge = STATUS_BADGE[status];
  const isControlsDisabled = isRunning || status === "stopping";

  return (
    <Card>
      <CardHeader className="p-4 pb-3">
        {strategies && onSelectStrategy && (
          <StrategySelector
            strategies={strategies}
            assignedModes={assignedModes ?? new Set()}
            currentMode={mode}
            currentStatus={status}
            onSelect={onSelectStrategy}
          />
        )}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-lg font-semibold" style={{ color }}>{name}</span>
            <Badge
              className={cn(
                badge.className,
                status === "kill-switch" ? "transition-none" : "transition-colors duration-200",
                "min-w-[80px] text-center",
              )}
            >
              {badge.label}
            </Badge>
          </div>
          <Switch
            checked={isRunning}
            disabled={isDisabledToggle}
            onCheckedChange={handleToggle}
            aria-label={`Toggle ${name} mode`}
          />
        </div>
        <p className="text-xs text-text-muted mt-1">{description}</p>
      </CardHeader>
      <CardContent className="p-4 pt-0">
        {/* Stats Grid */}
        <div className="grid grid-cols-2 gap-3">
          <StatCell
            label="PnL"
            value={formatCurrency(stats.pnl, true)}
            colorClass={pnlColor}
          />
          <StatCell
            label="Trades"
            value={formatInteger(stats.trades)}
            colorClass={statColor}
          />
          <StatCell
            label="Volume"
            value={formatCurrency(stats.volume)}
            colorClass={statColor}
          />
          <StatCell
            label="Allocated"
            value={formatCurrency(stats.allocated)}
            colorClass={statColor}
          />
        </div>

        {/* Error detail */}
        {status === "error" && errorDetail && (
          <div className="mt-2 text-xs text-loss" aria-live="assertive">
            {errorDetail.message}
          </div>
        )}

        {/* Kill-switch detail */}
        {status === "kill-switch" && killSwitchDetail && (
          <div className="mt-2 text-xs text-loss" aria-live="assertive">
            Positions closed: {killSwitchDetail.positionsClosed} | Loss:{" "}
            {formatCurrency(killSwitchDetail.lossAmount)}
          </div>
        )}

        {/* Fund Allocation Bar */}
        <FundAllocationBar
          allocated={stats.allocated}
          remaining={stats.remaining}
          modeColor={barColor}
        />

        {/* Fund Allocation Input */}
        <div className="mt-3 flex items-center gap-1">
          <span className="text-sm font-mono text-text-secondary">$</span>
          <Input
            type="text"
            className="h-8 font-mono text-right text-sm"
            value={displayedAllocation}
            placeholder={`Max ${formatCurrency(availableForMode)}`}
            onFocus={handleAllocationFocus}
            onChange={handleAllocationChange}
            onBlur={handleAllocationCommit}
            onKeyDown={handleAllocationKeyDown}
            disabled={isControlsDisabled}
            aria-label={`Fund allocation for ${name}`}
          />
        </div>

        {/* Pair Selector */}
        <div className="mt-3 relative">
          <button
            ref={pairTriggerRef}
            type="button"
            className={cn(
              "w-full h-8 px-3 text-left text-sm rounded-md border border-input bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              isControlsDisabled && "opacity-50 cursor-not-allowed",
            )}
            onClick={() => !isControlsDisabled && setPairDropdownOpen(!pairDropdownOpen)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && pairDropdownOpen) {
                setPairDropdownOpen(false);
              }
            }}
            disabled={isControlsDisabled}
            aria-expanded={pairDropdownOpen}
            aria-label={`Select trading pairs for ${name}`}
          >
            {pairs.length > 0 ? pairs.join(", ") : "Select pairs..."}
          </button>
          {pairDropdownOpen && !isControlsDisabled && (
            <div
              ref={pairDropdownRef}
              role="group"
              aria-label="Trading pairs"
              className="absolute z-10 mt-1 w-full rounded-md border border-input bg-background shadow-lg"
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setPairDropdownOpen(false);
                  pairTriggerRef.current?.focus();
                }
              }}
            >
              {AVAILABLE_PAIRS.map((pair) => (
                <label
                  key={pair}
                  className="flex items-center gap-2 px-3 py-1.5 hover:bg-surface-elevated cursor-pointer text-sm"
                >
                  <input
                    type="checkbox"
                    checked={pairs.includes(pair)}
                    onChange={() => handlePairToggle(pair)}
                  />
                  <Flame
                    size={16}
                    className="text-warning opacity-0"
                    role="img"
                    aria-label="Boosted pair"
                  />
                  {pair}
                </label>
              ))}
            </div>
          )}
        </div>

        {/* Slippage Input */}
        <div className="mt-3 flex items-center gap-1">
          <span className="text-xs font-medium text-text-secondary">Slippage:</span>
          <Input
            type="text"
            className="h-7 w-20 font-mono text-center text-sm"
            value={`${displayedSlippage}%`}
            onFocus={handleSlippageFocus}
            onChange={handleSlippageChange}
            onBlur={handleSlippageCommit}
            onKeyDown={handleSlippageKeyDown}
            disabled={isControlsDisabled}
            aria-label={`Slippage for ${name}`}
          />
        </div>

        {/* Position Size Input */}
        <div className="mt-3 flex items-center gap-1">
          <span className="text-xs font-medium text-text-secondary">Position Size:</span>
          <span className="text-sm font-mono text-text-secondary">$</span>
          <Input
            type="text"
            className="h-7 w-24 font-mono text-right text-sm"
            placeholder={autoPositionSize > 0 ? `Auto (${autoPositionSize})` : "Auto"}
            value={displayedPositionSize}
            onFocus={handlePositionSizeFocus}
            onChange={handlePositionSizeChange}
            onBlur={handlePositionSizeCommit}
            onKeyDown={handlePositionSizeKeyDown}
            disabled={isControlsDisabled}
            aria-label={`Position size for ${name}`}
          />
        </div>

        {/* RSI Config (Profit Hunter only) */}
        {mode === "profitHunter" && (
          <RsiConfigInputs
            rsiPeriod={rsiPeriod ?? 14}
            oversoldThreshold={oversoldThreshold ?? 30}
            overboughtThreshold={overboughtThreshold ?? 70}
            exitRsi={exitRsi ?? 50}
            disabled={isControlsDisabled}
            mode={mode}
            name={name}
            setModeConfig={setModeConfig}
          />
        )}

      </CardContent>
    </Card>
  );
}
