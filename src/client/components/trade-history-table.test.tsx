// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { TradeHistoryTable } from "./trade-history-table";
import useStore from "@client/store";
import type { Trade, StrategyInfo, ModeStatus } from "@shared/types";

const TEST_STRATEGIES: StrategyInfo[] = [
  { name: "Volume Max", description: "Volume maximization", modeType: "volumeMax", urlSlug: "volume-max", modeColor: "#8b5cf6", status: "stopped" as ModeStatus },
  { name: "Profit Hunter", description: "Profit hunting", modeType: "profitHunter", urlSlug: "profit-hunter", modeColor: "#22c55e", status: "stopped" as ModeStatus },
  { name: "Arbitrage", description: "Arbitrage trading", modeType: "arbitrage", urlSlug: "arbitrage", modeColor: "#06b6d4", status: "stopped" as ModeStatus },
];

vi.mock("@client/lib/api", () => ({
  fetchTrades: vi.fn(() => Promise.resolve({ trades: [], total: 0 })),
}));

function makeTrade(overrides: Partial<Trade> = {}): Trade {
  return {
    id: 1,
    mode: "volumeMax",
    pair: "SOL/USDC",
    side: "Long",
    size: 10,
    price: 150,
    pnl: 5.25,
    fees: 0.1,
    timestamp: 1712500000000,
    ...overrides,
  };
}

beforeEach(() => {
  useStore.setState({
    strategies: TEST_STRATEGIES,
    tradeHistory: {
      trades: [],
      total: 0,
      page: 0,
      loading: false,
    },
  });
});

afterEach(cleanup);

describe("TradeHistoryTable", () => {
  it("renders the title", () => {
    render(<TradeHistoryTable />);
    expect(screen.getByText("Trade History")).toBeInTheDocument();
  });

  it("renders all table headers", () => {
    render(<TradeHistoryTable />);
    const headers = ["Time", "Mode", "Pair", "Side", "Size", "Price", "PnL", "Fees"];
    for (const header of headers) {
      expect(screen.getByText(header)).toBeInTheDocument();
    }
  });

  it("shows empty state message when no trades", () => {
    render(<TradeHistoryTable />);
    expect(screen.getByText("No trade history")).toBeInTheDocument();
  });

  it("renders trade rows with correct mode tags and inline colors", () => {
    useStore.setState({
      tradeHistory: {
        trades: [
          makeTrade({ id: 1, mode: "volumeMax" }),
          makeTrade({ id: 2, mode: "profitHunter" }),
          makeTrade({ id: 3, mode: "arbitrage" }),
        ],
        total: 3,
        page: 0,
        loading: false,
      },
    });

    render(<TradeHistoryTable />);

    const volTag = screen.getByText("VOL");
    expect(volTag.style.color).toBe("rgb(139, 92, 246)");

    const proTag = screen.getByText("PRO");
    expect(proTag.style.color).toBe("rgb(34, 197, 94)");

    const arbTag = screen.getByText("ARB");
    expect(arbTag.style.color).toBe("rgb(6, 182, 212)");
  });

  it("renders Side with correct color classes", () => {
    useStore.setState({
      tradeHistory: {
        trades: [
          makeTrade({ id: 1, side: "Long" }),
          makeTrade({ id: 2, side: "Short" }),
        ],
        total: 2,
        page: 0,
        loading: false,
      },
    });

    render(<TradeHistoryTable />);

    const longEl = screen.getByText("Long");
    expect(longEl.className).toContain("text-profit");

    const shortEl = screen.getByText("Short");
    expect(shortEl.className).toContain("text-loss");
  });

  it("renders PnL with correct color and sign prefix", () => {
    useStore.setState({
      tradeHistory: {
        trades: [
          makeTrade({ id: 1, pnl: 5.25 }),
          makeTrade({ id: 2, pnl: -3.5 }),
        ],
        total: 2,
        page: 0,
        loading: false,
      },
    });

    render(<TradeHistoryTable />);

    const profitEl = screen.getByText("+$5.25");
    expect(profitEl.closest("td")?.className).toContain("text-profit");

    const lossEl = screen.getByText("-$3.50");
    expect(lossEl.closest("td")?.className).toContain("text-loss");
  });

  it("renders financial values with font-mono class", () => {
    useStore.setState({
      tradeHistory: {
        trades: [makeTrade({ id: 1, size: 100, price: 150 })],
        total: 1,
        page: 0,
        loading: false,
      },
    });

    render(<TradeHistoryTable />);

    const sizeCell = screen.getByText("$100.00");
    expect(sizeCell.closest("td")?.className).toContain("font-mono");

    const priceCell = screen.getByText("$150.00");
    expect(priceCell.closest("td")?.className).toContain("font-mono");
  });

  it("does not show pagination when total <= page size", () => {
    useStore.setState({
      tradeHistory: {
        trades: [makeTrade()],
        total: 1,
        page: 0,
        loading: false,
      },
    });

    render(<TradeHistoryTable />);
    expect(screen.queryByText("Previous")).not.toBeInTheDocument();
    expect(screen.queryByText("Next")).not.toBeInTheDocument();
  });

  it("shows pagination controls when total > page size", () => {
    useStore.setState({
      tradeHistory: {
        trades: Array.from({ length: 50 }, (_, i) => makeTrade({ id: i + 1 })),
        total: 100,
        page: 0,
        loading: false,
      },
    });

    render(<TradeHistoryTable />);
    expect(screen.getByText("Previous")).toBeInTheDocument();
    expect(screen.getByText("Next")).toBeInTheDocument();
    expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();
  });

  it("disables Previous button on first page", () => {
    useStore.setState({
      tradeHistory: {
        trades: Array.from({ length: 50 }, (_, i) => makeTrade({ id: i + 1 })),
        total: 100,
        page: 0,
        loading: false,
      },
    });

    render(<TradeHistoryTable />);
    const prevBtn = screen.getByText("Previous");
    expect(prevBtn).toBeDisabled();
  });

  it("disables Next button on last page", () => {
    useStore.setState({
      tradeHistory: {
        trades: Array.from({ length: 50 }, (_, i) => makeTrade({ id: i + 1 })),
        total: 100,
        page: 1,
        loading: false,
      },
    });

    render(<TradeHistoryTable />);
    const nextBtn = screen.getByText("Next");
    expect(nextBtn).toBeDisabled();
  });

  it("does not show empty state when trades exist", () => {
    useStore.setState({
      tradeHistory: {
        trades: [makeTrade()],
        total: 1,
        page: 0,
        loading: false,
      },
    });

    render(<TradeHistoryTable />);
    expect(screen.queryByText("No trade history")).not.toBeInTheDocument();
  });

  it("pagination buttons have focus-visible ring classes", () => {
    useStore.setState({
      tradeHistory: {
        trades: Array.from({ length: 50 }, (_, i) => makeTrade({ id: i + 1 })),
        total: 100,
        page: 0,
        loading: false,
      },
    });

    render(<TradeHistoryTable />);
    const prevBtn = screen.getByText("Previous");
    const nextBtn = screen.getByText("Next");
    expect(prevBtn.className).toContain("focus-visible:ring-2");
    expect(nextBtn.className).toContain("focus-visible:ring-2");
  });

  it('table header cells have scope="col" attribute', () => {
    render(<TradeHistoryTable />);
    const thElements = document.querySelectorAll("th");
    expect(thElements.length).toBeGreaterThan(0);
    for (const th of thElements) {
      expect(th).toHaveAttribute("scope", "col");
    }
  });

  it("number header cells have text-right alignment", () => {
    render(<TradeHistoryTable />);

    for (const header of ["Size", "Price", "PnL", "Fees"]) {
      const el = screen.getByText(header);
      expect(el.className).toContain("text-right");
    }
  });
});
