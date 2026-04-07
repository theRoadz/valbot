import { useRef, useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { ScrollArea } from "./ui/scroll-area";
import useStore from "@client/store";
import { formatTime, formatCurrency } from "@client/lib/format";
import { getModeTag } from "@client/lib/mode-utils";
import type { Trade } from "@shared/types";

function TradeEntry({ trade }: { trade: Trade }) {
  const strategies = useStore((s) => s.strategies);
  const tag = getModeTag(trade.mode, strategies);
  const isClose = trade.pnl !== 0;
  const action = isClose ? "Closed" : "Opened";

  let details: string;
  let detailClass = "";
  if (isClose) {
    details = formatCurrency(trade.pnl, true);
    if (trade.pnl > 0) detailClass = "text-profit";
    else if (trade.pnl < 0) detailClass = "text-loss";
  } else {
    details = formatCurrency(trade.size * trade.price);
  }

  return (
    <div className="font-mono text-xs leading-relaxed">
      <span className="text-text-muted">{formatTime(trade.timestamp)}</span>{" "}
      <span style={{ color: tag.color }}>[{tag.label}]</span>{" "}
      <span>{action} {trade.side} {trade.pair}</span>{" "}
      <span className={detailClass}>{details}</span>
    </div>
  );
}

export function TradeLog() {
  const trades = useStore((s) => s.trades);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const [isAutoScroll, setIsAutoScroll] = useState(true);
  const [newTradesSincePause, setNewTradesSincePause] = useState(0);
  const prevTradesLenRef = useRef(trades.length);

  const getViewport = useCallback(
    () => wrapperRef.current?.querySelector<HTMLElement>("[data-radix-scroll-area-viewport]"),
    [],
  );

  // Track new trades arriving while paused
  useEffect(() => {
    const diff = trades.length - prevTradesLenRef.current;
    prevTradesLenRef.current = trades.length;
    if (!isAutoScroll && diff > 0) {
      setNewTradesSincePause((c) => c + diff);
    }
  }, [trades.length, isAutoScroll]);

  // Auto-scroll on new trades
  useEffect(() => {
    if (isAutoScroll && trades.length > 0) {
      const viewport = getViewport();
      if (viewport?.scrollTo) {
        viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" });
      }
    }
  }, [trades.length, isAutoScroll, getViewport]);

  // Attach scroll listener to viewport
  useEffect(() => {
    const viewport = getViewport();
    if (!viewport) return;

    const handleScroll = () => {
      const atBottom = viewport.scrollTop + viewport.clientHeight >= viewport.scrollHeight - 20;
      if (atBottom) {
        setIsAutoScroll(true);
        setNewTradesSincePause(0);
      } else {
        setIsAutoScroll(false);
      }
    };

    viewport.addEventListener("scroll", handleScroll);
    return () => viewport.removeEventListener("scroll", handleScroll);
  }, [getViewport]);

  const handleMouseEnter = () => {
    setIsAutoScroll(false);
  };

  const handleMouseLeave = () => {
    setIsAutoScroll(true);
    setNewTradesSincePause(0);
    const viewport = getViewport();
    if (viewport?.scrollTo) {
      viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" });
    }
  };

  const handleIndicatorClick = () => {
    setIsAutoScroll(true);
    setNewTradesSincePause(0);
    const viewport = getViewport();
    if (viewport?.scrollTo) {
      viewport.scrollTo({ top: viewport.scrollHeight, behavior: "smooth" });
    }
  };

  return (
    <Card className="flex flex-col overflow-hidden min-h-0 h-full">
      <CardHeader className="p-4 pb-0">
        <CardTitle className="text-lg font-semibold">Live Trade Log</CardTitle>
      </CardHeader>
      <CardContent className="p-4 flex-1 min-h-0 overflow-hidden">
        <div
          ref={wrapperRef}
          className="relative h-full"
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          <ScrollArea className="h-full">
            {trades.length === 0 ? (
              <div className="flex items-center justify-center h-32">
                <span className="text-xs font-mono text-text-muted">Waiting for trades...</span>
              </div>
            ) : (
              <div className="space-y-0.5">
                {trades.map((trade) => (
                  <TradeEntry key={trade.id} trade={trade} />
                ))}
              </div>
            )}
          </ScrollArea>
          {!isAutoScroll && newTradesSincePause > 0 && (
            <button
              type="button"
              onClick={handleIndicatorClick}
              aria-label="Scroll to latest trades"
              className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-card-foreground/10 backdrop-blur-sm text-text-muted text-xs font-mono px-3 py-1 rounded-full cursor-pointer hover:bg-card-foreground/20 transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              New trades below ↓
            </button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
