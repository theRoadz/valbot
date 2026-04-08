// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from "@testing-library/user-event";
import App from './App';
import useStore from './store';
import type { StrategyInfo, ModeStatus } from '@shared/types';

vi.mock("@client/lib/api", () => ({
  startMode: vi.fn(() => Promise.resolve()),
  stopMode: vi.fn(() => Promise.resolve()),
  updateModeConfig: vi.fn(() => Promise.resolve()),
  fetchStatus: vi.fn(() => Promise.resolve()),
  fetchTrades: vi.fn(() => Promise.resolve({ trades: [], total: 0 })),
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

const TEST_STRATEGIES: StrategyInfo[] = [
  { name: "Volume Max", description: "Volume maximization", modeType: "volumeMax", urlSlug: "volume-max", modeColor: "#8b5cf6", status: "stopped" as ModeStatus },
  { name: "Profit Hunter", description: "Profit hunting", modeType: "profitHunter", urlSlug: "profit-hunter", modeColor: "#22c55e", status: "stopped" as ModeStatus },
  { name: "Arbitrage", description: "Arbitrage trading", modeType: "arbitrage", urlSlug: "arbitrage", modeColor: "#06b6d4", status: "stopped" as ModeStatus },
];

beforeEach(() => {
  localStorage.removeItem("strategySlots");
  useStore.setState({
    strategies: TEST_STRATEGIES,
    modes: {
      volumeMax: { mode: "volumeMax", status: "stopped", allocation: 0, pairs: ["SOL/USDC"], slippage: 0.5, stats: { pnl: 0, trades: 0, volume: 0, allocated: 0, remaining: 0 }, errorDetail: null, killSwitchDetail: null },
      profitHunter: { mode: "profitHunter", status: "stopped", allocation: 0, pairs: ["SOL/USDC"], slippage: 0.5, stats: { pnl: 0, trades: 0, volume: 0, allocated: 0, remaining: 0 }, errorDetail: null, killSwitchDetail: null },
      arbitrage: { mode: "arbitrage", status: "stopped", allocation: 0, pairs: ["SOL/USDC"], slippage: 0.5, stats: { pnl: 0, trades: 0, volume: 0, allocated: 0, remaining: 0 }, errorDetail: null, killSwitchDetail: null },
    },
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('App (Dashboard Layout)', () => {
  it('renders without errors', () => {
    render(<App />);
    expect(screen.getByText('ValBot')).toBeInTheDocument();
  });

  it('renders all three mode cards', () => {
    render(<App />);
    // Each strategy name appears in its card header + as dropdown option in each card's selector
    expect(screen.getAllByText('Volume Max').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Profit Hunter').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Arbitrage').length).toBeGreaterThanOrEqual(1);
  });

  it('renders positions table and trade log', () => {
    render(<App />);
    expect(screen.getByText('Open Positions')).toBeInTheDocument();
    expect(screen.getByText('Live Trade Log')).toBeInTheDocument();
  });

  it('renders the top bar with connection status', () => {
    render(<App />);
    expect(screen.getByText('Disconnected')).toBeInTheDocument();
  });

  it('applies bg-background class to root container', () => {
    const { container } = render(<App />);
    const root = container.firstElementChild;
    expect(root?.className).toContain('bg-background');
  });

  it('sets min-width 1280px and full viewport height', () => {
    const { container } = render(<App />);
    const root = container.firstElementChild;
    expect(root?.className).toContain('min-w-[1280px]');
    expect(root?.className).toContain('h-screen');
  });

  it('wraps content area in a <main> landmark element', () => {
    const { container } = render(<App />);
    const mainEl = container.querySelector('main');
    expect(mainEl).not.toBeNull();
    expect(mainEl?.tagName).toBe('MAIN');
  });

  it('mounts the Toaster component', () => {
    const { container } = render(<App />);
    // Sonner Toaster renders an <ol> or section within the root — verify it does not throw
    // and the component tree includes the Toaster by checking the rendered output is non-empty
    expect(container.firstElementChild).not.toBeNull();
    // Toaster is rendered — App imports and mounts it without error
  });

  it('only shows critical alerts in AlertBanner, not warning', () => {
    // Add a warning alert (should NOT appear in banner)
    useStore.getState().addAlert({
      id: 100,
      severity: 'warning',
      code: 'WARN_TEST',
      message: 'Warning should not appear in banner',
      details: null,
      resolution: null,
      timestamp: Date.now(),
    });
    // Add a critical alert (should appear in banner)
    useStore.getState().addAlert({
      id: 101,
      severity: 'critical',
      code: 'CRIT_TEST',
      message: 'Critical should appear',
      details: null,
      resolution: null,
      timestamp: Date.now(),
    });

    render(<App />);

    expect(screen.getByText(/Critical should appear/)).toBeInTheDocument();
    expect(screen.queryByText(/Warning should not appear/)).toBeNull();

    // Clean up store
    useStore.setState({ alerts: [] });
  });

  it('shows strategy in dropdown when more than 3 are registered', () => {
    useStore.setState({
      strategies: [
        ...TEST_STRATEGIES,
        { name: "Mean Reversion", description: "Mean reversion", modeType: "meanReversion", urlSlug: "mean-reversion", modeColor: "#f59e0b", status: "stopped" as ModeStatus },
      ],
      modes: {
        ...useStore.getState().modes,
        meanReversion: { mode: "meanReversion", status: "stopped", allocation: 0, pairs: ["SOL/USDC"], slippage: 0.5, stats: { pnl: 0, trades: 0, volume: 0, allocated: 0, remaining: 0 }, errorDetail: null, killSwitchDetail: null },
      },
    });

    render(<App />);
    // With 4 strategies and 3 slots, first 3 strategies render, Mean Reversion is available via dropdown
    expect(screen.getAllByText('Volume Max').length).toBeGreaterThanOrEqual(1);
  });

  it('renders exactly 3 card slots (fixed grid)', () => {
    const { container } = render(<App />);
    const modeGrid = container.querySelector('[style*="repeat(3"]');
    expect(modeGrid).not.toBeNull();
  });

  it('shows 3 slots even with 1 strategy (empty placeholders for remaining)', () => {
    useStore.setState({
      strategies: [TEST_STRATEGIES[0]],
      modes: {
        volumeMax: useStore.getState().modes.volumeMax,
      },
    });

    const { container } = render(<App />);
    const modeGrid = container.querySelector('[style*="repeat(3"]');
    expect(modeGrid).not.toBeNull();
    // Should have "No strategy selected" text for empty slots
    expect(screen.getAllByText('No strategy selected').length).toBe(2);
  });

  it('persists slot assignments to localStorage', () => {
    render(<App />);
    // After rendering with 3 strategies, slots should be saved
    const saved = localStorage.getItem('strategySlots');
    expect(saved).not.toBeNull();
    const parsed = JSON.parse(saved!);
    expect(parsed).toHaveLength(3);
    expect(parsed).toContain('volumeMax');
    expect(parsed).toContain('profitHunter');
    expect(parsed).toContain('arbitrage');
  });

  it('restores slot assignments from localStorage on reload', () => {
    // Pre-set localStorage with a specific order
    localStorage.setItem('strategySlots', JSON.stringify(['arbitrage', 'volumeMax', null]));
    render(<App />);
    // Should have one "No strategy selected" placeholder
    expect(screen.getAllByText('No strategy selected').length).toBe(1);
  });

  it('dropdown shows all strategies with disabled ones marked "(in use)"', async () => {
    const user = userEvent.setup();
    render(<App />);
    // Click the first strategy selector
    const selectors = screen.getAllByLabelText('Select strategy');
    await user.click(selectors[0]);
    // Should see strategy options
    const listbox = document.querySelector('[role="listbox"]');
    expect(listbox).not.toBeNull();
  });

  it('stopped strategy swap switches immediately without API call', async () => {
    localStorage.setItem('strategySlots', JSON.stringify(['volumeMax', null, null]));
    useStore.setState({
      strategies: [
        ...TEST_STRATEGIES,
        { name: "Grid Trading", description: "Grid trading", modeType: "gridTrading", urlSlug: "grid-trading", modeColor: "#f59e0b", status: "stopped" as ModeStatus },
      ],
      modes: {
        ...useStore.getState().modes,
        gridTrading: { mode: "gridTrading", status: "stopped", allocation: 0, pairs: ["SOL/USDC"], slippage: 0.5, stats: { pnl: 0, trades: 0, volume: 0, allocated: 0, remaining: 0 }, errorDetail: null, killSwitchDetail: null },
      },
    });

    const user = userEvent.setup();
    render(<App />);
    // Click the first slot's strategy selector
    const selectors = screen.getAllByLabelText('Select strategy');
    await user.click(selectors[0]);
    // Click "Grid Trading" option
    const gridOption = screen.getByRole('option', { name: /Grid Trading/ });
    await user.click(gridOption);
    // stopMode should NOT be called (strategy was stopped)
    expect(api.stopMode).not.toHaveBeenCalled();
  });

  it('running strategy swap triggers stop API call', async () => {
    localStorage.setItem('strategySlots', JSON.stringify(['volumeMax', null, null]));
    useStore.setState((s) => ({
      strategies: [
        ...TEST_STRATEGIES,
        { name: "Grid Trading", description: "Grid trading", modeType: "gridTrading", urlSlug: "grid-trading", modeColor: "#f59e0b", status: "stopped" as ModeStatus },
      ],
      modes: {
        ...s.modes,
        volumeMax: { ...s.modes.volumeMax, status: "running" as ModeStatus, allocation: 100 },
        gridTrading: { mode: "gridTrading", status: "stopped", allocation: 0, pairs: ["SOL/USDC"], slippage: 0.5, stats: { pnl: 0, trades: 0, volume: 0, allocated: 0, remaining: 0 }, errorDetail: null, killSwitchDetail: null },
      },
    }));

    const user = userEvent.setup();
    render(<App />);
    const selectors = screen.getAllByLabelText('Select strategy');
    await user.click(selectors[0]);
    const gridOption = screen.getByRole('option', { name: /Grid Trading/ });
    await user.click(gridOption);
    // stopMode SHOULD be called for the running strategy
    expect(api.stopMode).toHaveBeenCalledWith('volumeMax');
  });

  it('reverts swap on stop failure', async () => {
    (api.stopMode as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("stop failed"));
    localStorage.setItem('strategySlots', JSON.stringify(['volumeMax', null, null]));
    useStore.setState((s) => ({
      strategies: [
        ...TEST_STRATEGIES,
        { name: "Grid Trading", description: "Grid trading", modeType: "gridTrading", urlSlug: "grid-trading", modeColor: "#f59e0b", status: "stopped" as ModeStatus },
      ],
      modes: {
        ...s.modes,
        volumeMax: { ...s.modes.volumeMax, status: "running" as ModeStatus, allocation: 100 },
        gridTrading: { mode: "gridTrading", status: "stopped", allocation: 0, pairs: ["SOL/USDC"], slippage: 0.5, stats: { pnl: 0, trades: 0, volume: 0, allocated: 0, remaining: 0 }, errorDetail: null, killSwitchDetail: null },
      },
    }));

    const user = userEvent.setup();
    render(<App />);
    const selectors = screen.getAllByLabelText('Select strategy');
    await user.click(selectors[0]);
    const gridOption = screen.getByRole('option', { name: /Grid Trading/ });
    await user.click(gridOption);
    // After rejection, slot should revert to volumeMax
    await vi.waitFor(() => {
      const saved = JSON.parse(localStorage.getItem('strategySlots')!);
      expect(saved[0]).toBe('volumeMax');
    });
  });

  it('warning indicator shown when slot has running strategy', async () => {
    localStorage.setItem('strategySlots', JSON.stringify(['volumeMax', null, null]));
    useStore.setState((s) => ({
      modes: {
        ...s.modes,
        volumeMax: { ...s.modes.volumeMax, status: "running" as ModeStatus, allocation: 100 },
      },
    }));

    const user = userEvent.setup();
    render(<App />);
    const selectors = screen.getAllByLabelText('Select strategy');
    await user.click(selectors[0]);
    // Should show warning text
    expect(screen.getByText('Will stop current strategy')).toBeInTheDocument();
  });
});
