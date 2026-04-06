import { useState } from "react";
import { Input } from "./ui/input";
import useStore from "@client/store";
import * as api from "@client/lib/api";

export function MaxAllocationControl() {
  const maxAllocation = useStore((s) => s.modes.volumeMax.maxAllocation ?? 500);
  const setModeConfig = useStore((s) => s.setModeConfig);
  const [input, setInput] = useState("");
  const [focused, setFocused] = useState(false);

  const displayed = focused ? input : String(maxAllocation);

  const handleFocus = () => {
    setInput(String(maxAllocation));
    setFocused(true);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInput(e.target.value.replace(/[^0-9.]/g, ""));
  };

  const handleCommit = () => {
    setFocused(false);
    const numVal = parseFloat(input);
    if (!isNaN(numVal) && isFinite(numVal) && numVal >= 10 && numVal <= 10000 && numVal !== maxAllocation) {
      const prev = maxAllocation;
      // Update all modes optimistically (global setting)
      setModeConfig("volumeMax", { maxAllocation: numVal });
      setModeConfig("profitHunter", { maxAllocation: numVal });
      setModeConfig("arbitrage", { maxAllocation: numVal });
      // Send via any mode — server treats it as global
      api.updateModeConfig("volumeMax", { maxAllocation: numVal }).catch((err) => {
        setModeConfig("volumeMax", { maxAllocation: prev });
        setModeConfig("profitHunter", { maxAllocation: prev });
        setModeConfig("arbitrage", { maxAllocation: prev });
        if (import.meta.env.DEV) console.error("[MaxAllocationControl] Update failed:", err);
      });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
  };

  return (
    <div className="flex items-center gap-2 justify-end">
      <span className="text-xs font-medium text-text-secondary">Max Allocation Limit:</span>
      <span className="text-sm font-mono text-text-secondary">$</span>
      <Input
        type="text"
        className="h-7 w-24 font-mono text-right text-sm"
        value={displayed}
        onFocus={handleFocus}
        onChange={handleChange}
        onBlur={handleCommit}
        onKeyDown={handleKeyDown}
        aria-label="Global max allocation limit"
      />
    </div>
  );
}
