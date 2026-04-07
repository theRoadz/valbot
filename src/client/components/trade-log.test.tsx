// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { TradeLog } from "./trade-log";
import useStore from "@client/store";
import { formatTime } from "@client/lib/format";
import type { Trade, StrategyInfo, ModeStatus } from "@shared/types";

const TEST_STRATEGIES: StrategyInfo[] = [
  { name: "Volume Max", description: "Volume maximization", modeType: "volumeMax", urlSlug: "volume-max", modeColor: "#8b5cf6", status: "stopped" as ModeStatus },
  { name: "Profit Hunter", description: "Profit hunting", modeType: "profitHunter", urlSlug: "profit-hunter", modeColor: "#22c55e", status: "stopped" as ModeStatus },
  { name: "Arbitrage", description: "Arbitrage trading", modeType: "arbitrage", urlSlug: "arbitrage", modeColor: "#06b6d4", status: "stopped" as ModeStatus },
];

const TEST_TIMESTAMP = 1712345027000; // fixed timestamp
const EXPECTED_TIME = formatTime(TEST_TIMESTAMP); // locale-dependent but consistent

function makeTrade(overrides: Partial<Trade> = {}): Trade {
  return {
    id: 1,
    mode: "volumeMax",
    pair: "SOL-PERP",
    side: "Long",
    size: 100,
    price: 150,
    pnl: 0,
    fees: 0.5,
    timestamp: TEST_TIMESTAMP,
    ...overrides,
  };
}

beforeEach(() => {
  useStore.setState({ trades: [], strategies: TEST_STRATEGIES });
});

afterEach(cleanup);

describe("TradeLog", () => {
  it("renders empty state when trades array is empty", () => {
    render(<TradeLog />);
    expect(screen.getByText("Waiting for trades...")).toBeInTheDocument();
  });

  it("renders trade entries with correct timestamp, mode tag, side, pair", () => {
    useStore.setState({
      trades: [makeTrade()],
    });

    render(<TradeLog />);
    // Timestamp in HH:mm:ss 24hr format (en-GB locale)
    expect(screen.getByText(EXPECTED_TIME)).toBeInTheDocument();
    expect(screen.getByText("[VOL]")).toBeInTheDocument();
    expect(screen.getByText(/Opened Long SOL-PERP/)).toBeInTheDocument();
  });

  it("mode tags display correct abbreviation and inline color", () => {
    useStore.setState({
      trades: [
        makeTrade({ id: 1, mode: "volumeMax" }),
        makeTrade({ id: 2, mode: "profitHunter" }),
        makeTrade({ id: 3, mode: "arbitrage" }),
      ],
    });

    render(<TradeLog />);

    const volTag = screen.getByText("[VOL]");
    expect(volTag.style.color).toBe("rgb(139, 92, 246)");

    const proTag = screen.getByText("[PRO]");
    expect(proTag.style.color).toBe("rgb(34, 197, 94)");

    const arbTag = screen.getByText("[ARB]");
    expect(arbTag.style.color).toBe("rgb(6, 182, 212)");
  });

  it("PnL values render with correct sign and color class", () => {
    useStore.setState({
      trades: [
        makeTrade({ id: 1, pnl: 14.2 }),
        makeTrade({ id: 2, pnl: -5.5 }),
      ],
    });

    render(<TradeLog />);

    const profitEl = screen.getByText("+$14.20");
    expect(profitEl).toHaveClass("text-profit");

    const lossEl = screen.getByText("-$5.50");
    expect(lossEl).toHaveClass("text-loss");
  });

  it("all entry text has font-mono class", () => {
    useStore.setState({
      trades: [makeTrade()],
    });

    render(<TradeLog />);
    // The entry div itself should have font-mono
    const entryDiv = screen.getByText(EXPECTED_TIME).closest("div");
    expect(entryDiv).toHaveClass("font-mono");
  });

  it("opening trades show size*price, closing trades show PnL", () => {
    useStore.setState({
      trades: [
        makeTrade({ id: 1, pnl: 0, size: 10, price: 100 }),
        makeTrade({ id: 2, pnl: 14.2, size: 10, price: 100 }),
      ],
    });

    render(<TradeLog />);
    // Open trade: $1,000.00 (10 * 100)
    expect(screen.getByText("$1,000.00")).toBeInTheDocument();
    // Close trade: +$14.20
    expect(screen.getByText("+$14.20")).toBeInTheDocument();
  });

  it("renders title", () => {
    render(<TradeLog />);
    expect(screen.getByText("Live Trade Log")).toBeInTheDocument();
  });
});
