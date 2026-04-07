import { useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table";
import useStore from "@client/store";
import { formatCurrency, formatDateTime } from "@client/lib/format";
import { fetchTrades } from "@client/lib/api";
import { getModeTag } from "@client/lib/mode-utils";
import type { Trade } from "@shared/types";

const PAGE_SIZE = 50;

function TradeRow({ trade }: { trade: Trade }) {
  const strategies = useStore((s) => s.strategies);
  const tag = getModeTag(trade.mode, strategies);
  const pnlClass = trade.pnl > 0 ? "text-profit" : trade.pnl < 0 ? "text-loss" : "";

  return (
    <TableRow className="hover:bg-surface-elevated transition-colors duration-200">
      <TableCell className="text-xs">{formatDateTime(trade.timestamp)}</TableCell>
      <TableCell className="text-xs">
        <span style={{ color: tag.color }}>{tag.label}</span>
      </TableCell>
      <TableCell className="text-xs">{trade.pair}</TableCell>
      <TableCell className="text-xs">
        <span className={trade.side === "Long" ? "text-profit" : "text-loss"}>
          {trade.side}
        </span>
      </TableCell>
      <TableCell className="font-mono text-xs text-right">{formatCurrency(trade.size)}</TableCell>
      <TableCell className="font-mono text-xs text-right">{formatCurrency(trade.price)}</TableCell>
      <TableCell className={`font-mono text-xs text-right ${pnlClass}`}>
        {formatCurrency(trade.pnl, true)}
      </TableCell>
      <TableCell className="font-mono text-xs text-right">{formatCurrency(trade.fees)}</TableCell>
    </TableRow>
  );
}

export function TradeHistoryTable() {
  const tradeHistory = useStore((s) => s.tradeHistory);
  const setTradeHistory = useStore((s) => s.setTradeHistory);
  const setTradeHistoryLoading = useStore((s) => s.setTradeHistoryLoading);
  const setTradeHistoryPage = useStore((s) => s.setTradeHistoryPage);

  const totalPages = Math.max(1, Math.ceil(tradeHistory.total / PAGE_SIZE));
  const currentPage = tradeHistory.page;

  useEffect(() => {
    let cancelled = false;
    setTradeHistoryLoading(true);
    fetchTrades(PAGE_SIZE, currentPage * PAGE_SIZE)
      .then((data) => {
        if (!cancelled) setTradeHistory(data, currentPage);
      })
      .catch((err) => {
        if (!cancelled) setTradeHistoryLoading(false);
        if (import.meta.env.DEV) console.error("[TradeHistory] Fetch failed:", err);
      });
    return () => { cancelled = true; };
  }, [currentPage, setTradeHistory, setTradeHistoryLoading]);

  const goToPrevPage = () => {
    const page = useStore.getState().tradeHistory.page;
    if (page > 0) setTradeHistoryPage(page - 1);
  };

  const goToNextPage = () => {
    const page = useStore.getState().tradeHistory.page;
    const total = useStore.getState().tradeHistory.total;
    const maxPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);
    if (page < maxPage) setTradeHistoryPage(page + 1);
  };

  return (
    <Card className="flex flex-col overflow-hidden min-h-0">
      <CardHeader className="p-4 pb-0">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg font-semibold">Trade History</CardTitle>
          {(tradeHistory.total > PAGE_SIZE || currentPage > 0) && (
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={goToPrevPage}
                disabled={currentPage === 0}
                className="text-xs px-2 py-1 rounded bg-surface-elevated text-text-secondary hover:text-text-primary disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                Previous
              </button>
              <span className="text-xs text-text-muted">
                Page {currentPage + 1} of {totalPages}
              </span>
              <button
                type="button"
                onClick={goToNextPage}
                disabled={currentPage >= totalPages - 1}
                className="text-xs px-2 py-1 rounded bg-surface-elevated text-text-secondary hover:text-text-primary disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                Next
              </button>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-4 flex-1 min-h-0 overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs font-medium text-text-secondary">Time</TableHead>
              <TableHead className="text-xs font-medium text-text-secondary">Mode</TableHead>
              <TableHead className="text-xs font-medium text-text-secondary">Pair</TableHead>
              <TableHead className="text-xs font-medium text-text-secondary">Side</TableHead>
              <TableHead className="text-xs font-medium text-text-secondary font-mono text-right">Size</TableHead>
              <TableHead className="text-xs font-medium text-text-secondary font-mono text-right">Price</TableHead>
              <TableHead className="text-xs font-medium text-text-secondary font-mono text-right">PnL</TableHead>
              <TableHead className="text-xs font-medium text-text-secondary font-mono text-right">Fees</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tradeHistory.trades.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="h-32 text-center">
                  <span className="text-sm text-text-muted">No trade history</span>
                </TableCell>
              </TableRow>
            ) : (
              tradeHistory.trades.map((trade) => (
                <TradeRow key={trade.id} trade={trade} />
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
