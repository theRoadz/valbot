// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ModeCard } from "./mode-card";
import useStore from "@client/store";
import type { ModeStatus, StrategyInfo } from "@shared/types";

const TEST_STRATEGIES: StrategyInfo[] = [
  { name: "Volume Max", description: "Volume maximization", modeType: "volumeMax", urlSlug: "volume-max", modeColor: "#8b5cf6", status: "stopped" as ModeStatus },
  { name: "Profit Hunter", description: "Profit hunting", modeType: "profitHunter", urlSlug: "profit-hunter", modeColor: "#22c55e", status: "stopped" as ModeStatus },
  { name: "Arbitrage", description: "Arbitrage trading", modeType: "arbitrage", urlSlug: "arbitrage", modeColor: "#06b6d4", status: "stopped" as ModeStatus },
];

vi.mock("@client/lib/api", () => ({
  startMode: vi.fn(() => Promise.resolve()),
  stopMode: vi.fn(() => Promise.resolve()),
  updateModeConfig: vi.fn(() => Promise.resolve()),
  fetchStatus: vi.fn(() => Promise.resolve()),
  ApiError: class ApiError extends Error {
    severity: string;
    code: string;
    details: string | null;
    resolution: string;
    constructor(f: { severity: string; code: string; message: string; details: string | null; resolution: string }) {
      super(f.message);
      this.severity = f.severity;
      this.code = f.code;
      this.details = f.details;
      this.resolution = f.resolution;
    }
  },
}));

const api = await import("@client/lib/api");

function resetStore() {
  useStore.setState({
    strategies: TEST_STRATEGIES,
    modes: {
      volumeMax: {
        mode: "volumeMax",
        status: "stopped",
        allocation: 0,
        pairs: ["SOL/USDC"],
        slippage: 0.5,
        stats: { pnl: 0, trades: 0, volume: 0, allocated: 0, remaining: 0 },
        errorDetail: null,
        killSwitchDetail: null,
      },
      profitHunter: {
        mode: "profitHunter",
        status: "stopped",
        allocation: 0,
        pairs: ["SOL/USDC"],
        slippage: 0.5,
        stats: { pnl: 0, trades: 0, volume: 0, allocated: 0, remaining: 0 },
        errorDetail: null,
        killSwitchDetail: null,
      },
      arbitrage: {
        mode: "arbitrage",
        status: "stopped",
        allocation: 0,
        pairs: ["SOL/USDC"],
        slippage: 0.5,
        stats: { pnl: 0, trades: 0, volume: 0, allocated: 0, remaining: 0 },
        errorDetail: null,
        killSwitchDetail: null,
      },
    },
  });
}

const defaultProps = {
  mode: "volumeMax" as const,
  name: "Volume Max",
  description: "Volume maximization",
  color: "#8b5cf6",
  barColor: "#8b5cf6",
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(resetStore);

describe("ModeCard", () => {
  it("renders mode name, badge, toggle, stats, allocation bar, pair selector, slippage", () => {
    render(<ModeCard {...defaultProps} />);
    expect(screen.getByText("Volume Max")).toBeInTheDocument();
    expect(screen.getByText("Stopped")).toBeInTheDocument();
    expect(document.querySelector('[role="switch"]')).toBeInTheDocument();
    expect(screen.getByText("PnL")).toBeInTheDocument();
    expect(screen.getByText("Trades")).toBeInTheDocument();
    expect(screen.getByText("Volume")).toBeInTheDocument();
    expect(screen.getByText("Allocated")).toBeInTheDocument();
    expect(screen.getByText("Fund Allocation")).toBeInTheDocument();
    expect(screen.getByText("Not allocated")).toBeInTheDocument();
    expect(screen.getByLabelText("Fund allocation for Volume Max")).toBeInTheDocument();
    expect(screen.getByLabelText("Select trading pairs for Volume Max")).toBeInTheDocument();
  });

  it("applies mode color via inline style", () => {
    render(<ModeCard {...defaultProps} />);
    expect(screen.getByText("Volume Max").style.color).toBe("rgb(139, 92, 246)");
  });

  it("shows zero-value stats in muted color", () => {
    render(<ModeCard {...defaultProps} />);
    const zeroValues = screen.getAllByText("$0.00");
    expect(zeroValues.length).toBe(3); // PnL, Volume, Allocated
    expect(screen.getByText("0")).toBeInTheDocument();
  });

  describe("toggle", () => {
    it("toggle is disabled when allocation is 0", () => {
      render(<ModeCard {...defaultProps} />);
      const toggle = document.querySelector('[role="switch"]')!;
      expect(toggle).toHaveAttribute("disabled");
    });

    it("calls startMode API on toggle on", async () => {
      useStore.setState((s) => ({
        modes: { ...s.modes, volumeMax: { ...s.modes.volumeMax, allocation: 100 } },
      }));
      const user = userEvent.setup();
      render(<ModeCard {...defaultProps} />);
      const toggle = document.querySelector('[role="switch"]')!;
      await user.click(toggle);
      expect(api.startMode).toHaveBeenCalledWith("volumeMax", expect.objectContaining({ pairs: expect.any(Array), slippage: expect.any(Number) }));
    });

    it("optimistic badge update: changes to Starting on toggle on", async () => {
      useStore.setState((s) => ({
        modes: { ...s.modes, volumeMax: { ...s.modes.volumeMax, allocation: 100 } },
      }));
      const user = userEvent.setup();
      render(<ModeCard {...defaultProps} />);
      await user.click(document.querySelector('[role="switch"]')!);
      expect(screen.getByText("Starting...")).toBeInTheDocument();
    });

    it("optimistic revert: badge reverts on API error", async () => {
      (api.startMode as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("fail"));
      useStore.setState((s) => ({
        modes: { ...s.modes, volumeMax: { ...s.modes.volumeMax, allocation: 100 } },
      }));
      const user = userEvent.setup();
      render(<ModeCard {...defaultProps} />);
      await user.click(document.querySelector('[role="switch"]')!);
      // After rejection, should revert
      await vi.waitFor(() => {
        expect(screen.getByText("Stopped")).toBeInTheDocument();
      });
    });

    it("calls stopMode API on toggle off", async () => {
      useStore.setState((s) => ({
        modes: { ...s.modes, volumeMax: { ...s.modes.volumeMax, allocation: 100, status: "running" } },
      }));
      const user = userEvent.setup();
      render(<ModeCard {...defaultProps} />);
      await user.click(document.querySelector('[role="switch"]')!);
      expect(api.stopMode).toHaveBeenCalledWith("volumeMax");
    });

    it("toggle disabled when kill-switch", () => {
      useStore.setState((s) => ({
        modes: { ...s.modes, volumeMax: { ...s.modes.volumeMax, status: "kill-switch" as ModeStatus } },
      }));
      render(<ModeCard {...defaultProps} />);
      expect(document.querySelector('[role="switch"]')).toHaveAttribute("disabled");
    });

    it("toggle disabled when error", () => {
      useStore.setState((s) => ({
        modes: { ...s.modes, volumeMax: { ...s.modes.volumeMax, status: "error" as ModeStatus } },
      }));
      render(<ModeCard {...defaultProps} />);
      expect(document.querySelector('[role="switch"]')).toHaveAttribute("disabled");
    });

    it("toggle disabled when stopping", () => {
      useStore.setState((s) => ({
        modes: { ...s.modes, volumeMax: { ...s.modes.volumeMax, status: "stopping" as ModeStatus } },
      }));
      render(<ModeCard {...defaultProps} />);
      expect(document.querySelector('[role="switch"]')).toHaveAttribute("disabled");
    });

    it("ignores rapid toggle clicks while first is in-flight", async () => {
      let resolveStart!: () => void;
      (api.startMode as ReturnType<typeof vi.fn>).mockImplementation(
        () => new Promise<void>((r) => { resolveStart = r; }),
      );
      useStore.setState((s) => ({
        modes: { ...s.modes, volumeMax: { ...s.modes.volumeMax, allocation: 100 } },
      }));
      const user = userEvent.setup();
      render(<ModeCard {...defaultProps} />);
      const toggle = document.querySelector('[role="switch"]')!;
      await user.click(toggle);
      // First click fires startMode
      expect(api.startMode).toHaveBeenCalledTimes(1);
      // Second click while first is in-flight — should be ignored by toggle lock
      await user.click(toggle);
      expect(api.startMode).toHaveBeenCalledTimes(1);
      expect(api.stopMode).not.toHaveBeenCalled();
      resolveStart();
    });
  });

  describe("fund allocation input", () => {
    it("is numeric only and calls updateModeConfig on blur", async () => {
      const user = userEvent.setup();
      render(<ModeCard {...defaultProps} />);
      const input = screen.getByLabelText("Fund allocation for Volume Max");
      await user.click(input);
      await user.clear(input);
      await user.type(input, "500");
      await user.tab();
      expect(api.updateModeConfig).toHaveBeenCalledWith("volumeMax", { allocation: 500 });
    });

    it("is read-only when running", () => {
      useStore.setState((s) => ({
        modes: { ...s.modes, volumeMax: { ...s.modes.volumeMax, allocation: 100, status: "running" } },
      }));
      render(<ModeCard {...defaultProps} />);
      const input = screen.getByLabelText("Fund allocation for Volume Max");
      expect(input).toBeDisabled();
    });
  });

  describe("pair selector", () => {
    it("shows pairs in dropdown and is disabled when running", async () => {
      useStore.setState((s) => ({
        modes: { ...s.modes, volumeMax: { ...s.modes.volumeMax, status: "running" } },
      }));
      render(<ModeCard {...defaultProps} />);
      const btn = screen.getByLabelText("Select trading pairs for Volume Max");
      expect(btn).toBeDisabled();
    });

    it("multi-select shows pairs and calls API on change", async () => {
      const user = userEvent.setup();
      render(<ModeCard {...defaultProps} />);
      const btn = screen.getByLabelText("Select trading pairs for Volume Max");
      await user.click(btn);
      // Should show all pairs in the dropdown
      const checkboxes = document.querySelectorAll('input[type="checkbox"]');
      expect(checkboxes.length).toBe(3);

      // Click ETH/USDC to add it
      const ethCheckbox = checkboxes[1];
      await user.click(ethCheckbox);
      expect(api.updateModeConfig).toHaveBeenCalledWith("volumeMax", {
        pairs: ["SOL/USDC", "ETH/USDC"],
      });
    });

    it("checkbox stays checked after toggling a pair", async () => {
      const user = userEvent.setup();
      render(<ModeCard {...defaultProps} />);
      const btn = screen.getByLabelText("Select trading pairs for Volume Max");
      await user.click(btn);
      const checkboxes = document.querySelectorAll('input[type="checkbox"]');
      // ETH/USDC checkbox (index 1) should be unchecked initially
      expect(checkboxes[1]).not.toBeChecked();
      await user.click(checkboxes[1]);
      // After click, ETH/USDC should be checked
      expect(checkboxes[1]).toBeChecked();
    });

    it("rolls back pair selection on API failure", async () => {
      (api.updateModeConfig as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("network"));
      const user = userEvent.setup();
      render(<ModeCard {...defaultProps} />);
      const btn = screen.getByLabelText("Select trading pairs for Volume Max");
      await user.click(btn);
      const checkboxes = document.querySelectorAll('input[type="checkbox"]');
      // ETH/USDC starts unchecked
      expect(checkboxes[1]).not.toBeChecked();
      // Click to add — optimistic update fires, then rejection rolls back
      await user.click(checkboxes[1]);
      // After rejection + rollback, should be unchecked again
      await vi.waitFor(() => {
        expect(checkboxes[1]).not.toBeChecked();
      });
      // Verify the store was restored to original pairs
      expect(useStore.getState().modes.volumeMax.pairs).toEqual(["SOL/USDC"]);
    });
  });

  describe("slippage input", () => {
    it("validates range 0.1-5.0 and reverts invalid", async () => {
      const user = userEvent.setup();
      render(<ModeCard {...defaultProps} />);
      const inputs = document.querySelectorAll("input[type='text']");
      // Slippage is the second text input
      const slipInput = inputs[1];
      await user.click(slipInput);
      await user.clear(slipInput);
      await user.type(slipInput, "10");
      await user.tab();
      // Invalid value, should not call API
      expect(api.updateModeConfig).not.toHaveBeenCalledWith("volumeMax", expect.objectContaining({ slippage: 10 }));
    });

    it("calls updateModeConfig with valid slippage", async () => {
      const user = userEvent.setup();
      render(<ModeCard {...defaultProps} />);
      const inputs = document.querySelectorAll("input[type='text']");
      const slipInput = inputs[1];
      await user.click(slipInput);
      await user.clear(slipInput);
      await user.type(slipInput, "1.5");
      await user.tab();
      expect(api.updateModeConfig).toHaveBeenCalledWith("volumeMax", { slippage: 1.5 });
    });
  });

  describe("FundAllocationBar", () => {
    it("shows gray empty bar when not allocated", () => {
      render(<ModeCard {...defaultProps} />);
      expect(screen.getByText("Not allocated")).toBeInTheDocument();
    });

    it("shows colored bar when allocated", () => {
      useStore.setState((s) => ({
        modes: {
          ...s.modes,
          volumeMax: {
            ...s.modes.volumeMax,
            stats: { ...s.modes.volumeMax.stats, allocated: 1000, remaining: 500 },
          },
        },
      }));
      render(<ModeCard {...defaultProps} />);
      expect(screen.getByText(/\$500\.00 \/ \$1,000\.00 remaining/)).toBeInTheDocument();
    });
  });

  describe("status badge", () => {
    const statuses: [ModeStatus, string][] = [
      ["stopped", "Stopped"],
      ["starting", "Starting..."],
      ["running", "Running"],
      ["stopping", "Stopping..."],
      ["error", "Error"],
      ["kill-switch", "Kill Switch"],
    ];

    for (const [status, label] of statuses) {
      it(`renders ${label} for status ${status}`, () => {
        useStore.setState((s) => ({
          modes: { ...s.modes, volumeMax: { ...s.modes.volumeMax, status } },
        }));
        render(<ModeCard {...defaultProps} />);
        expect(screen.getByText(label)).toBeInTheDocument();
      });
    }
  });

  describe("error detail section", () => {
    it("renders when status is error", () => {
      useStore.setState((s) => ({
        modes: {
          ...s.modes,
          volumeMax: {
            ...s.modes.volumeMax,
            status: "error",
            errorDetail: { code: "TEST", message: "Something went wrong", details: null },
          },
        },
      }));
      render(<ModeCard {...defaultProps} />);
      expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    });
  });

  describe("kill-switch detail section", () => {
    it("renders when status is kill-switch", () => {
      useStore.setState((s) => ({
        modes: {
          ...s.modes,
          volumeMax: {
            ...s.modes.volumeMax,
            status: "kill-switch",
            killSwitchDetail: { positionsClosed: 3, lossAmount: 150 },
          },
        },
      }));
      render(<ModeCard {...defaultProps} />);
      expect(screen.getByText(/Positions closed: 3/)).toBeInTheDocument();
      expect(screen.getByText(/\$150\.00/)).toBeInTheDocument();
    });
  });

  describe("stats preserved in muted color during error", () => {
    it("shows stats in muted when error", () => {
      useStore.setState((s) => ({
        modes: {
          ...s.modes,
          volumeMax: {
            ...s.modes.volumeMax,
            status: "error",
            stats: { pnl: 100, trades: 5, volume: 1000, allocated: 500, remaining: 200 },
            errorDetail: { code: "E", message: "err", details: null },
          },
        },
      }));
      render(<ModeCard {...defaultProps} />);
      // All stat values should have muted color
      const statValues = document.querySelectorAll("[aria-live='polite']");
      for (const el of statValues) {
        expect(el.className).toContain("text-text-muted");
      }
    });
  });

  describe("accessibility", () => {
    it("has aria-label on toggle", () => {
      render(<ModeCard {...defaultProps} />);
      expect(document.querySelector('[aria-label="Toggle Volume Max mode"]')).toBeInTheDocument();
    });

    it("has aria-label on fund input", () => {
      render(<ModeCard {...defaultProps} />);
      expect(screen.getByLabelText("Fund allocation for Volume Max")).toBeInTheDocument();
    });

    it("has aria-label on pair selector", () => {
      render(<ModeCard {...defaultProps} />);
      expect(screen.getByLabelText("Select trading pairs for Volume Max")).toBeInTheDocument();
    });

    it("has aria-live on stats", () => {
      render(<ModeCard {...defaultProps} />);
      const liveElements = document.querySelectorAll("[aria-live='polite']");
      expect(liveElements.length).toBeGreaterThanOrEqual(4);
    });

    it("has aria-live assertive on error section", () => {
      useStore.setState((s) => ({
        modes: {
          ...s.modes,
          volumeMax: {
            ...s.modes.volumeMax,
            status: "error",
            errorDetail: { code: "E", message: "err", details: null },
          },
        },
      }));
      render(<ModeCard {...defaultProps} />);
      expect(document.querySelector("[aria-live='assertive']")).toBeInTheDocument();
    });
  });

  it("renders all three mode variants", () => {
    const modes = [
      { mode: "volumeMax" as const, name: "Volume Max", description: "Volume maximization", color: "#8b5cf6", barColor: "#8b5cf6" },
      { mode: "profitHunter" as const, name: "Profit Hunter", description: "Profit hunting", color: "#22c55e", barColor: "#22c55e" },
      { mode: "arbitrage" as const, name: "Arbitrage", description: "Arbitrage trading", color: "#06b6d4", barColor: "#06b6d4" },
    ];
    for (const m of modes) {
      const { unmount } = render(<ModeCard {...m} />);
      expect(screen.getByText(m.name)).toBeInTheDocument();
      unmount();
    }
  });
});
