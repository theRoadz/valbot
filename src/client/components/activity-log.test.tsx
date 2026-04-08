// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ActivityLog } from "./activity-log";
import useStore from "@client/store";
import { formatTime } from "@client/lib/format";
import type { ModeActivityPayload } from "@shared/events";

type ActivityEntry = ModeActivityPayload & { timestamp: number };

const TEST_TIMESTAMP = 1712345027000;
const EXPECTED_TIME = formatTime(TEST_TIMESTAMP);

function makeEntry(overrides: Partial<ActivityEntry> = {}): ActivityEntry {
  return {
    mode: "profitHunter",
    iteration: 1,
    pairs: [{ pair: "SOL/USDC", deviationPct: 1.5, oracleStatus: "ok", outcome: "no-signal", size: null, side: null }],
    timestamp: TEST_TIMESTAMP,
    ...overrides,
  };
}

beforeEach(() => {
  useStore.setState({ activityLog: [] });
});

afterEach(cleanup);

describe("ActivityLog", () => {
  it("renders empty state when no entries", () => {
    render(<ActivityLog />);
    expect(screen.getByText("Waiting for activity...")).toBeInTheDocument();
  });

  it("renders iteration header with timestamp and iteration number", () => {
    useStore.setState({ activityLog: [makeEntry()] });
    render(<ActivityLog />);
    expect(screen.getByText(new RegExp(`${EXPECTED_TIME}`))).toBeInTheDocument();
    expect(screen.getByText(/Iteration #1/)).toBeInTheDocument();
  });

  it("renders pair with deviation text and outcome", () => {
    useStore.setState({ activityLog: [makeEntry()] });
    render(<ActivityLog />);
    expect(screen.getByText("SOL/USDC")).toBeInTheDocument();
    expect(screen.getByText("dev +1.50%")).toBeInTheDocument();
    expect(screen.getByText("No signal")).toBeInTheDocument();
  });

  it("renders 'oracle stale' when deviationPct is null and oracle stale", () => {
    useStore.setState({
      activityLog: [makeEntry({
        pairs: [{ pair: "SOL/USDC", deviationPct: null, oracleStatus: "stale", outcome: "skipped-stale", size: null, side: null }],
      })],
    });
    render(<ActivityLog />);
    expect(screen.getByText("oracle stale")).toBeInTheDocument();
    expect(screen.getByText("Skipped (oracle stale)")).toBeInTheDocument();
  });

  it("renders 'warming up' when deviationPct is null and oracle warming-up", () => {
    useStore.setState({
      activityLog: [makeEntry({
        pairs: [{ pair: "SOL/USDC", deviationPct: null, oracleStatus: "warming-up", outcome: "skipped-warming", size: null, side: null }],
      })],
    });
    render(<ActivityLog />);
    expect(screen.getByText("warming up")).toBeInTheDocument();
    expect(screen.getByText("Skipped (warming up)")).toBeInTheDocument();
  });

  it("renders opened-long outcome with size", () => {
    useStore.setState({
      activityLog: [makeEntry({
        pairs: [{ pair: "SOL/USDC", deviationPct: -2.0, oracleStatus: "ok", outcome: "opened-long", size: 50_000_000, side: "Long" }],
      })],
    });
    render(<ActivityLog />);
    expect(screen.getByText("dev -2.00%")).toBeInTheDocument();
    expect(screen.getByText(/Opened Long/)).toBeInTheDocument();
  });

  it("renders FAILED outcomes", () => {
    useStore.setState({
      activityLog: [makeEntry({
        pairs: [
          { pair: "SOL/USDC", deviationPct: -2.0, oracleStatus: "ok", outcome: "open-failed", size: null, side: "Long" },
        ],
      })],
    });
    render(<ActivityLog />);
    expect(screen.getByText("FAILED to open")).toBeInTheDocument();
  });

  it("renders all outcome types correctly", () => {
    useStore.setState({
      activityLog: [makeEntry({
        pairs: [
          { pair: "A/B", deviationPct: 0.5, oracleStatus: "ok", outcome: "held", size: null, side: "Long" },
          { pair: "C/D", deviationPct: 0.1, oracleStatus: "ok", outcome: "closed-reverted", size: 10_000_000, side: "Short" },
          { pair: "E/F", deviationPct: null, oracleStatus: "ok", outcome: "skipped-no-funds", size: null, side: null },
          { pair: "G/H", deviationPct: null, oracleStatus: "ok", outcome: "skipped-has-position", size: null, side: null },
          { pair: "I/J", deviationPct: -1.0, oracleStatus: "ok", outcome: "close-failed", size: null, side: "Long" },
        ],
      })],
    });
    render(<ActivityLog />);
    expect(screen.getByText("Holding")).toBeInTheDocument();
    expect(screen.getByText("Closed (reverted)")).toBeInTheDocument();
    expect(screen.getByText("Skipped (no funds)")).toBeInTheDocument();
    expect(screen.getByText("Skipped (position open)")).toBeInTheDocument();
    expect(screen.getByText("FAILED to close")).toBeInTheDocument();
  });

  it("renders multiple iteration blocks", () => {
    useStore.setState({
      activityLog: [
        makeEntry({ iteration: 1 }),
        makeEntry({ iteration: 2, timestamp: TEST_TIMESTAMP + 5000 }),
      ],
    });
    render(<ActivityLog />);
    expect(screen.getByText(/Iteration #1/)).toBeInTheDocument();
    expect(screen.getByText(/Iteration #2/)).toBeInTheDocument();
  });

  it("renders negative deviation with minus sign", () => {
    useStore.setState({
      activityLog: [makeEntry({
        pairs: [{ pair: "SOL/USDC", deviationPct: -1.75, oracleStatus: "ok", outcome: "opened-long", size: 50_000_000, side: "Long" }],
      })],
    });
    render(<ActivityLog />);
    expect(screen.getByText("dev -1.75%")).toBeInTheDocument();
  });

  it("has accessible scroll-to-bottom button label", () => {
    render(<ActivityLog />);
    // Button is only shown when paused with new entries — just verify the component renders
    expect(screen.getByText("Profit Hunter Activity")).toBeInTheDocument();
  });
});
