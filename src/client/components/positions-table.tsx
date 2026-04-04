import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table";

export function PositionsTable() {
  return (
    <Card className="flex flex-col overflow-hidden">
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
              <TableHead className="text-xs font-medium text-text-secondary font-mono">Size</TableHead>
              <TableHead className="text-xs font-medium text-text-secondary font-mono">Entry</TableHead>
              <TableHead className="text-xs font-medium text-text-secondary font-mono">Mark</TableHead>
              <TableHead className="text-xs font-medium text-text-secondary font-mono">PnL</TableHead>
              <TableHead className="text-xs font-medium text-text-secondary font-mono">Stop-Loss</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell colSpan={8} className="h-32 text-center">
                <span className="text-sm text-text-muted">No open positions</span>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
