import { useState } from "react";
import { Input } from "./ui/input";
import useStore from "@client/store";
import * as api from "@client/lib/api";

export function MaxAllocationControl() {
  const maxAllocation = useStore((s) => {
    const first = Object.values(s.modes)[0];
    return first?.maxAllocation ?? null;
  });
  const setModeConfig = useStore((s) => s.setModeConfig);
  const [input, setInput] = useState("");
  const [focused, setFocused] = useState(false);

  const displayed = focused ? input : maxAllocation !== null ? String(maxAllocation) : "—";

  const handleFocus = () => {
    if (maxAllocation === null) return;
    setInput(String(maxAllocation));
    setFocused(true);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInput(e.target.value.replace(/[^0-9.]/g, ""));
  };

  const handleCommit = () => {
    setFocused(false);
    const numVal = parseFloat(input);
    if (maxAllocation !== null && !isNaN(numVal) && isFinite(numVal) && numVal >= 10 && numVal <= 100000 && numVal !== maxAllocation) {
      const prev = maxAllocation;
      const modeKeys = Object.keys(useStore.getState().modes);
      if (modeKeys.length === 0) return;
      // Update all modes optimistically (global setting)
      for (const mode of modeKeys) setModeConfig(mode, { maxAllocation: numVal });
      // Send via first mode — server treats it as global
      const firstMode = modeKeys[0];
      api.updateModeConfig(firstMode, { maxAllocation: numVal }).catch((err) => {
        for (const mode of modeKeys) setModeConfig(mode, { maxAllocation: prev });
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
      {maxAllocation !== null && <span className="text-sm font-mono text-text-secondary">$</span>}
      <Input
        type="text"
        className="h-7 w-28 font-mono text-right text-sm"
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
