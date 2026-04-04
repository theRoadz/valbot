// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import App from './App';

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
});
