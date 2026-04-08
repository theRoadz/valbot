import { useRef, useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { ScrollArea } from "./ui/scroll-area";
import useStore from "@client/store";
import { formatTime, formatCurrency } from "@client/lib/format";
import type { ActivityPairEntry } from "@shared/events";

function getOutcomeText(entry: ActivityPairEntry): string {
  switch (entry.outcome) {
    case "opened-long":
      return `Opened Long ${entry.size !== null ? formatCurrency(entry.size) : ""}`;
    case "opened-short":
      return `Opened Short ${entry.size !== null ? formatCurrency(entry.size) : ""}`;
    case "closed-reverted":
      return "Closed (reverted)";
    case "held":
      return "Holding";
    case "no-signal":
      return "No signal";
    case "skipped-stale":
      return "Skipped (oracle stale)";
    case "skipped-warming":
      return "Skipped (warming up)";
    case "skipped-no-funds":
      return "Skipped (no funds)";
    case "skipped-has-position":
      return "Skipped (position open)";
    case "open-failed":
      return "FAILED to open";
    case "close-failed":
      return "FAILED to close";
    default:
      return entry.outcome;
  }
}

function getOutcomeClass(outcome: ActivityPairEntry["outcome"]): string {
  switch (outcome) {
    case "opened-long":
    case "opened-short":
    case "closed-reverted":
      return "text-profit";
    case "open-failed":
    case "close-failed":
      return "text-loss";
    case "skipped-stale":
    case "skipped-warming":
    case "skipped-no-funds":
    case "skipped-has-position":
      return "text-warning";
    default:
      return "text-text-muted";
  }
}

function getDeviationText(entry: ActivityPairEntry): string {
  if (entry.deviationPct === null) {
    return entry.oracleStatus === "stale" ? "oracle stale" : "warming up";
  }
  const sign = entry.deviationPct >= 0 ? "+" : "";
  return `dev ${sign}${entry.deviationPct.toFixed(2)}%`;
}

function PairEntry({ entry }: { entry: ActivityPairEntry }) {
  return (
    <div className="font-mono text-xs leading-relaxed pl-4">
      <span className="text-text-muted">{entry.pair}</span>{" "}
      <span className="text-text-muted">{getDeviationText(entry)}</span>
      {" → "}
      <span className={getOutcomeClass(entry.outcome)}>{getOutcomeText(entry)}</span>
    </div>
  );
}

type ActivityEntry = { iteration: number; pairs: ActivityPairEntry[]; timestamp: number };

function IterationBlock({ entry }: { entry: ActivityEntry }) {
  return (
    <div className="mb-1">
      <div className="font-mono text-xs leading-relaxed text-text-muted">
        {formatTime(entry.timestamp)} — Iteration #{entry.iteration} {"─".repeat(16)}
      </div>
      {entry.pairs.map((pair, i) => (
        <PairEntry key={`${entry.iteration}-${pair.pair}-${i}`} entry={pair} />
      ))}
    </div>
  );
}

export function ActivityLog() {
  const activityLog = useStore((s) => s.activityLog);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [isAutoScroll, setIsAutoScroll] = useState(true);
  const [newEntriesSincePause, setNewEntriesSincePause] = useState(0);
  const prevLenRef = useRef(activityLog.length);

  const getViewport = useCallback(
    () => wrapperRef.current?.querySelector<HTMLElement>("[data-radix-scroll-area-viewport]"),
    [],
  );

  // Track new entries arriving while paused
  useEffect(() => {
    const diff = activityLog.length - prevLenRef.current;
    prevLenRef.current = activityLog.length;
    if (!isAutoScroll && diff > 0) {
      setNewEntriesSincePause((c) => c + diff);
    }
  }, [activityLog.length, isAutoScroll]);

  // Auto-scroll on new entries
  useEffect(() => {
    if (isAutoScroll && activityLog.length > 0) {
      const viewport = getViewport();
      if (viewport?.scrollTo) {
        viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" });
      }
    }
  }, [activityLog.length, isAutoScroll, getViewport]);

  // Attach scroll listener to viewport (re-run on activityLog changes to catch late Radix mount)
  useEffect(() => {
    const viewport = getViewport();
    if (!viewport) return;

    const handleScroll = () => {
      const atBottom = viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - 20;
      if (atBottom) {
        setIsAutoScroll(true);
        setNewEntriesSincePause(0);
      } else {
        setIsAutoScroll(false);
      }
    };

    viewport.addEventListener("scroll", handleScroll);
    return () => viewport.removeEventListener("scroll", handleScroll);
  }, [getViewport, activityLog.length]);

  const handlePointerEnter = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse") setIsAutoScroll(false);
  };

  const handlePointerLeave = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse") {
      setIsAutoScroll(true);
      setNewEntriesSincePause(0);
      const viewport = getViewport();
      if (viewport?.scrollTo) {
        viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" });
      }
    }
  };

  const handleIndicatorClick = () => {
    setIsAutoScroll(true);
    setNewEntriesSincePause(0);
    const viewport = getViewport();
    if (viewport?.scrollTo) {
      viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" });
    }
  };

  return (
    <Card className="flex flex-col overflow-hidden max-h-[200px]">
      <CardHeader className="p-3 pb-0">
        <CardTitle className="text-sm font-semibold">Profit Hunter Activity</CardTitle>
      </CardHeader>
      <CardContent className="p-3 flex-1 min-h-0 overflow-hidden">
        <div
          ref={wrapperRef}
          className="relative h-full"
          onPointerEnter={handlePointerEnter}
          onPointerLeave={handlePointerLeave}
        >
          <ScrollArea className="h-full">
            {activityLog.length === 0 ? (
              <div className="flex items-center justify-center h-16">
                <span className="text-xs font-mono text-text-muted">Waiting for activity...</span>
              </div>
            ) : (
              <div className="space-y-0.5">
                {activityLog.map((entry, i) => (
                  <IterationBlock key={`${entry.iteration}-${i}`} entry={entry} />
                ))}
              </div>
            )}
          </ScrollArea>
          {!isAutoScroll && newEntriesSincePause > 0 && (
            <button
              type="button"
              onClick={handleIndicatorClick}
              aria-label="Scroll to latest activity"
              className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-card-foreground/10 backdrop-blur-sm text-text-muted text-xs font-mono px-3 py-1 rounded-full cursor-pointer hover:bg-card-foreground/20 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              New activity below ↓
            </button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
