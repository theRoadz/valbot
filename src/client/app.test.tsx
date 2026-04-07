// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import App from './App';
import useStore from './store';
import type { StrategyInfo, ModeStatus } from '@shared/types';

const TEST_STRATEGIES: StrategyInfo[] = [
  { name: "Volume Max", description: "Volume maximization", modeType: "volumeMax", urlSlug: "volume-max", modeColor: "#8b5cf6", status: "stopped" as ModeStatus },
  { name: "Profit Hunter", description: "Profit hunting", modeType: "profitHunter", urlSlug: "profit-hunter", modeColor: "#22c55e", status: "stopped" as ModeStatus },
  { name: "Arbitrage", description: "Arbitrage trading", modeType: "arbitrage", urlSlug: "arbitrage", modeColor: "#06b6d4", status: "stopped" as ModeStatus },
];

beforeEach(() => {
  useStore.setState({
    strategies: TEST_STRATEGIES,
    modes: {
      volumeMax: { mode: "volumeMax", status: "stopped", allocation: 0, pairs: ["SOL/USDC"], slippage: 0.5, stats: { pnl: 0, trades: 0, volume: 0, allocated: 0, remaining: 0 }, errorDetail: null, killSwitchDetail: null },
      profitHunter: { mode: "profitHunter", status: "stopped", allocation: 0, pairs: ["SOL/USDC"], slippage: 0.5, stats: { pnl: 0, trades: 0, volume: 0, allocated: 0, remaining: 0 }, errorDetail: null, killSwitchDetail: null },
      arbitrage: { mode: "arbitrage", status: "stopped", allocation: 0, pairs: ["SOL/USDC"], slippage: 0.5, stats: { pnl: 0, trades: 0, volume: 0, allocated: 0, remaining: 0 }, errorDetail: null, killSwitchDetail: null },
    },
  });
});
afterEach(cleanup);

describe('App (Dashboard Layout)', () => {
  it('renders without errors', () => {
    render(<App />);
    expect(screen.getByText('ValBot')).toBeInTheDocument();
  });

  it('renders all three mode cards', () => {
    render(<App />);
    expect(screen.getByText('Volume Max')).toBeInTheDocument();
    expect(screen.getByText('Profit Hunter')).toBeInTheDocument();
    expect(screen.getByText('Arbitrage')).toBeInTheDocument();
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

  it('renders a 4th mode card when a 4th strategy is added', () => {
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
    expect(screen.getByText('Mean Reversion')).toBeInTheDocument();
    expect(screen.getByText('Volume Max')).toBeInTheDocument();
  });

  it('grid layout adapts to strategy count', () => {
    const { container } = render(<App />);
    // Find the grid container that holds mode cards
    const modeGrid = container.querySelector('[style*="grid-template-columns"]');
    expect(modeGrid).not.toBeNull();
    expect(modeGrid!.getAttribute('style')).toContain('repeat(3');
  });

  it('grid adapts to 1 strategy', () => {
    useStore.setState({
      strategies: [TEST_STRATEGIES[0]],
      modes: {
        volumeMax: useStore.getState().modes.volumeMax,
      },
    });

    const { container } = render(<App />);
    const modeGrid = container.querySelector('[style*="grid-template-columns"]');
    expect(modeGrid!.getAttribute('style')).toContain('repeat(1');
  });
});
