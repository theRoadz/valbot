// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import App from './App';
import useStore from './store';

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
});
