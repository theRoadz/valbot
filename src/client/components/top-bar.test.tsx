// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { TopBar } from "./top-bar";
import useStore from "@client/store";

beforeEach(() => {
  useStore.setState({
    connection: { status: "disconnected", equity: 0, available: 0 },
    stats: {
      equity: 0,
      available: 0,
      totalPnl: 0,
      sessionPnl: 0,
      totalTrades: 0,
      totalVolume: 0,
    },
  });
});

afterEach(cleanup);

describe("TopBar", () => {
  it("renders the ValBot title", () => {
    render(<TopBar />);
    expect(screen.getByText("ValBot")).toBeInTheDocument();
  });

  it('shows "Disconnected" by default with red dot', () => {
    render(<TopBar />);
    expect(screen.getByText("Disconnected")).toBeInTheDocument();
    const dot = screen.getByText("Disconnected").previousElementSibling;
    expect(dot?.className).toContain("bg-loss");
  });

  it('shows "Connected" with green dot when connected', () => {
    useStore.setState({
      connection: { status: "connected", equity: 0, available: 0 },
    });
    render(<TopBar />);
    expect(screen.getByText("Connected")).toBeInTheDocument();
    const dot = screen.getByText("Connected").previousElementSibling;
    expect(dot?.className).toContain("bg-profit");
  });

  it('shows "Reconnecting..." with pulsing yellow dot and will-change hint', () => {
    useStore.setState({
      connection: { status: "reconnecting", equity: 0, available: 0 },
    });
    render(<TopBar />);
    expect(screen.getByText("Reconnecting...")).toBeInTheDocument();
    const dot = screen.getByText("Reconnecting...").previousElementSibling;
    expect(dot?.className).toContain("bg-warning");
    expect(dot?.className).toContain("animate-pulse");
    expect(dot?.className).toContain("will-change-[opacity]");
  });

  it("renders all stat placeholders with zero values", () => {
    render(<TopBar />);
    expect(screen.getByText("Equity:")).toBeInTheDocument();
    expect(screen.getByText("Available:")).toBeInTheDocument();
    expect(screen.getByText("Total PnL:")).toBeInTheDocument();
    expect(screen.getByText("Session PnL:")).toBeInTheDocument();
    expect(screen.getByText("Trades:")).toBeInTheDocument();
    expect(screen.getByText("Volume:")).toBeInTheDocument();
    const zeroValues = screen.getAllByText("$0.00");
    expect(zeroValues.length).toBe(5);
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("formats stat values correctly — wallet in smallest-unit, PnL/volume in display units", () => {
    useStore.setState({
      stats: {
        equity: 1500000000, // smallest-unit: 1500 USDC after fromSmallestUnit
        available: 0,
        totalPnl: 250, // display units — already converted by server
        sessionPnl: -50, // display units
        totalTrades: 42,
        totalVolume: 10000, // display units
      },
    });
    render(<TopBar />);
    expect(screen.getByText("$1,500.00")).toBeInTheDocument(); // wallet: fromSmallestUnit applied
    expect(screen.getByText("+$250.00")).toBeInTheDocument(); // totalPnl: no fromSmallestUnit
    expect(screen.getByText("-$50.00")).toBeInTheDocument(); // sessionPnl: no fromSmallestUnit
    expect(screen.getByText("42")).toBeInTheDocument(); // trades: formatInteger
    expect(screen.getByText("$10,000.00")).toBeInTheDocument(); // volume: no fromSmallestUnit
  });

  it("has aria-live attribute on connection status container", () => {
    render(<TopBar />);
    const statusContainer = screen.getByRole("status");
    expect(statusContainer).toHaveAttribute("aria-live", "assertive");
  });

  it("uses semantic header element", () => {
    const { container } = render(<TopBar />);
    expect(container.querySelector("header")).toBeInTheDocument();
  });

  it("has aria-label on stat values", () => {
    render(<TopBar />);
    expect(
      screen.getByLabelText("Account equity: $0.00"),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("Available balance: $0.00"),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("Total profit and loss: $0.00"),
    ).toBeInTheDocument();
  });

  it("PnL stats render with text-profit class when positive", () => {
    useStore.setState({
      stats: { equity: 0, available: 0, totalPnl: 100, sessionPnl: 50, totalTrades: 0, totalVolume: 0 },
    });
    render(<TopBar />);
    const totalPnl = screen.getByLabelText(/Total profit and loss/);
    expect(totalPnl.className).toContain("text-profit");
    const sessionPnl = screen.getByLabelText(/Session profit and loss/);
    expect(sessionPnl.className).toContain("text-profit");
  });

  it("PnL stats render with text-loss class when negative", () => {
    useStore.setState({
      stats: { equity: 0, available: 0, totalPnl: -100, sessionPnl: -50, totalTrades: 0, totalVolume: 0 },
    });
    render(<TopBar />);
    const totalPnl = screen.getByLabelText(/Total profit and loss/);
    expect(totalPnl.className).toContain("text-loss");
    const sessionPnl = screen.getByLabelText(/Session profit and loss/);
    expect(sessionPnl.className).toContain("text-loss");
  });

  it("PnL stats render with text-text-muted class when zero", () => {
    useStore.setState({
      stats: { equity: 0, available: 0, totalPnl: 0, sessionPnl: 0, totalTrades: 0, totalVolume: 0 },
    });
    render(<TopBar />);
    const totalPnl = screen.getByLabelText(/Total profit and loss/);
    expect(totalPnl.className).toContain("text-text-muted");
    const sessionPnl = screen.getByLabelText(/Session profit and loss/);
    expect(sessionPnl.className).toContain("text-text-muted");
  });

  it("non-PnL stats remain text-text-muted", () => {
    useStore.setState({
      stats: { equity: 5000000, available: 0, totalPnl: 100, sessionPnl: 50, totalTrades: 10, totalVolume: 5000 },
    });
    render(<TopBar />);
    const wallet = screen.getByLabelText(/Available balance/);
    expect(wallet.className).toContain("text-text-muted");
    const trades = screen.getByLabelText(/Total trades/);
    expect(trades.className).toContain("text-text-muted");
    const volume = screen.getByLabelText(/Total volume/);
    expect(volume.className).toContain("text-text-muted");
  });

  it("positive PnL values show + prefix", () => {
    useStore.setState({
      stats: { equity: 0, available: 0, totalPnl: 1247.83, sessionPnl: 500, totalTrades: 0, totalVolume: 0 },
    });
    render(<TopBar />);
    expect(screen.getByText("+$1,247.83")).toBeInTheDocument();
    expect(screen.getByText("+$500.00")).toBeInTheDocument();
  });

  it("wallet balance uses fromSmallestUnit (smallest-unit → display)", () => {
    useStore.setState({
      stats: { equity: 2000000000, available: 0, totalPnl: 0, sessionPnl: 0, totalTrades: 0, totalVolume: 0 },
    });
    render(<TopBar />);
    // 2000000000 / 1e6 = 2000
    expect(screen.getByText("$2,000.00")).toBeInTheDocument();
  });

  it("totalPnl/totalVolume do NOT use fromSmallestUnit (already display units)", () => {
    useStore.setState({
      stats: { equity: 0, available: 0, totalPnl: 42.5, sessionPnl: 42.5, totalTrades: 0, totalVolume: 1500 },
    });
    render(<TopBar />);
    // If fromSmallestUnit was wrongly applied, 42.5 / 1e6 would show ~$0.00
    // Both totalPnl and sessionPnl are 42.5, so two elements match
    expect(screen.getAllByText("+$42.50")).toHaveLength(2);
    expect(screen.getByText("$1,500.00")).toBeInTheDocument();
  });

  it("totalTrades uses formatInteger directly (no unit conversion)", () => {
    useStore.setState({
      stats: { equity: 0, available: 0, totalPnl: 0, sessionPnl: 0, totalTrades: 1234, totalVolume: 0 },
    });
    render(<TopBar />);
    expect(screen.getByText("1,234")).toBeInTheDocument();
  });

  it("displays combined stats correctly when store has multi-mode aggregated values", () => {
    useStore.setState({
      stats: {
        equity: 5000000000, // smallest-unit: 5000 USDC
        available: 3000000000,
        totalPnl: 125, // display-unit: historical + session PnL
        sessionPnl: 25,
        totalTrades: 60, // historical(50) + session(10)
        totalVolume: 5350, // historical(5000) + session(350)
      },
    });
    render(<TopBar />);
    expect(screen.getByText("$5,000.00")).toBeInTheDocument(); // equity
    expect(screen.getByText("$3,000.00")).toBeInTheDocument(); // available
    expect(screen.getByText("+$125.00")).toBeInTheDocument(); // totalPnl
    expect(screen.getByText("+$25.00")).toBeInTheDocument(); // sessionPnl
    expect(screen.getByText("60")).toBeInTheDocument(); // totalTrades
    expect(screen.getByText("$5,350.00")).toBeInTheDocument(); // totalVolume
  });
});
