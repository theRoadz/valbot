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
import { formatCurrency } from "@client/lib/format";
import { getModeTag } from "@client/lib/mode-utils";
import type { Position } from "@shared/types";

function PositionRow({ position, isClosing }: { position: Position; isClosing: boolean }) {
  const strategies = useStore((s) => s.strategies);
  const tag = getModeTag(position.mode, strategies);

  return (
    <TableRow
      className={`hover:bg-surface-elevated ${isClosing ? "bg-warning/20" : ""}`}
    >
      <TableCell className="text-xs">
        <span style={{ color: tag.color }}>{tag.label}</span>
      </TableCell>
      <TableCell className="text-xs">{position.pair}</TableCell>
      <TableCell className="text-xs">
        <span className={position.side === "Long" ? "text-profit" : "text-loss"}>
          {position.side}
        </span>
      </TableCell>
      <TableCell className="font-mono text-xs text-right">{formatCurrency(position.size)}</TableCell>
      <TableCell className="font-mono text-xs text-right">{formatCurrency(position.entryPrice)}</TableCell>
      <TableCell className="font-mono text-xs text-right text-text-muted">&mdash;</TableCell>
      <TableCell className="font-mono text-xs text-right text-text-muted">&mdash;</TableCell>
      <TableCell className="font-mono text-xs text-right">{formatCurrency(position.stopLoss)}</TableCell>
    </TableRow>
  );
}

export function PositionsTable() {
  const positions = useStore((s) => s.positions);
  const closingPositions = useStore((s) => s.closingPositions);

  return (
    <Card className="flex flex-col overflow-hidden min-h-0">
      <CardHeader className="p-4 pb-0">
        <CardTitle className="text-lg font-semibold">Open Positions</CardTitle>
      </CardHeader>
      <CardContent className="p-4 flex-1 min-h-0 overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs font-medium text-text-secondary">Mode</TableHead>
              <TableHead className="text-xs font-medium text-text-secondary">Pair</TableHead>
              <TableHead className="text-xs font-medium text-text-secondary">Side</TableHead>
              <TableHead className="text-xs font-medium text-text-secondary font-mono text-right">Size</TableHead>
              <TableHead className="text-xs font-medium text-text-secondary font-mono text-right">Entry</TableHead>
              <TableHead className="text-xs font-medium text-text-secondary font-mono text-right">Mark</TableHead>
              <TableHead className="text-xs font-medium text-text-secondary font-mono text-right">PnL</TableHead>
              <TableHead className="text-xs font-medium text-text-secondary font-mono text-right">Stop-Loss</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {positions.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="h-32 text-center">
                  <span className="text-sm text-text-muted">No open positions</span>
                </TableCell>
              </TableRow>
            ) : (
              positions.map((position) => (
                <PositionRow
                  key={position.id}
                  position={position}
                  isClosing={closingPositions.includes(position.id)}
                />
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
