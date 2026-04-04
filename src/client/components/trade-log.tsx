import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { ScrollArea } from "./ui/scroll-area";

export function TradeLog() {
  return (
    <Card className="flex flex-col overflow-hidden">
      <CardHeader className="p-4 pb-0">
        <CardTitle className="text-lg font-semibold">Live Trade Log</CardTitle>
      </CardHeader>
      <CardContent className="p-4 flex-1 min-h-0 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="flex items-center justify-center h-32">
            <span className="text-xs font-mono text-text-muted">Waiting for trades...</span>
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
