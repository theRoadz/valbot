// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { TopBar } from "./top-bar";
import useStore from "@client/store";

beforeEach(() => {
  useStore.setState({
    connection: { status: "disconnected", walletBalance: 0 },
    stats: {
      walletBalance: 0,
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
      connection: { status: "connected", walletBalance: 0 },
    });
    render(<TopBar />);
    expect(screen.getByText("Connected")).toBeInTheDocument();
    const dot = screen.getByText("Connected").previousElementSibling;
    expect(dot?.className).toContain("bg-profit");
  });

  it('shows "Reconnecting..." with pulsing yellow dot', () => {
    useStore.setState({
      connection: { status: "reconnecting", walletBalance: 0 },
    });
    render(<TopBar />);
    expect(screen.getByText("Reconnecting...")).toBeInTheDocument();
    const dot = screen.getByText("Reconnecting...").previousElementSibling;
    expect(dot?.className).toContain("bg-warning");
    expect(dot?.className).toContain("animate-pulse");
  });

  it("renders all stat placeholders with zero values", () => {
    render(<TopBar />);
    expect(screen.getByText("Wallet:")).toBeInTheDocument();
    expect(screen.getByText("Total PnL:")).toBeInTheDocument();
    expect(screen.getByText("Session PnL:")).toBeInTheDocument();
    expect(screen.getByText("Trades:")).toBeInTheDocument();
    expect(screen.getByText("Volume:")).toBeInTheDocument();
    const zeroValues = screen.getAllByText("$0.00");
    expect(zeroValues.length).toBe(4);
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("formats stat values correctly with currency formatting", () => {
    useStore.setState({
      stats: {
        walletBalance: 1500000000, // 1500 USDC
        totalPnl: 250000000, // +250 USDC
        sessionPnl: -50000000, // -50 USDC
        totalTrades: 42,
        totalVolume: 10000000000, // 10000 USDC
      },
    });
    render(<TopBar />);
    expect(screen.getByText("$1,500.00")).toBeInTheDocument();
    expect(screen.getByText("+$250.00")).toBeInTheDocument();
    expect(screen.getByText("-$50.00")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
    expect(screen.getByText("$10,000.00")).toBeInTheDocument();
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
      screen.getByLabelText("Wallet balance: $0.00"),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText("Total profit and loss: $0.00"),
    ).toBeInTheDocument();
  });
});
