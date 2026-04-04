// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { ModeCard } from './mode-card';

afterEach(cleanup);

describe('ModeCard', () => {
  const volumeMax = { name: 'Volume Max', color: 'text-mode-volume' };

  it('renders the mode name', () => {
    render(<ModeCard mode={volumeMax} />);
    expect(screen.getByText('Volume Max')).toBeInTheDocument();
  });

  it('applies the mode color class to the name', () => {
    render(<ModeCard mode={volumeMax} />);
    const nameEl = screen.getByText('Volume Max');
    expect(nameEl.className).toContain('text-mode-volume');
  });

  it('shows Stopped badge', () => {
    render(<ModeCard mode={volumeMax} />);
    expect(screen.getByText('Stopped')).toBeInTheDocument();
  });

  it('renders a disabled switch', () => {
    render(<ModeCard mode={volumeMax} />);
    const switchEl = document.querySelector('[role="switch"]');
    expect(switchEl).not.toBeNull();
    expect(switchEl?.hasAttribute('disabled')).toBe(true);
  });

  it('shows zero-value stats in monospace', () => {
    render(<ModeCard mode={volumeMax} />);
    expect(screen.getByText('PnL')).toBeInTheDocument();
    expect(screen.getByText('Trades')).toBeInTheDocument();
    expect(screen.getByText('Volume')).toBeInTheDocument();
    expect(screen.getByText('Allocated')).toBeInTheDocument();
    const zeroValues = screen.getAllByText('$0.00');
    expect(zeroValues.length).toBe(3);
    expect(screen.getByText('0')).toBeInTheDocument();
  });

  it('shows fund allocation bar at 0% with Not allocated label', () => {
    render(<ModeCard mode={volumeMax} />);
    expect(screen.getByText('Not allocated')).toBeInTheDocument();
    expect(screen.getByText('Fund Allocation')).toBeInTheDocument();
  });

  it('renders all three mode variants correctly', () => {
    const modes = [
      { name: 'Volume Max', color: 'text-mode-volume' },
      { name: 'Profit Hunter', color: 'text-mode-profit' },
      { name: 'Arbitrage', color: 'text-mode-arb' },
    ];
    for (const mode of modes) {
      const { unmount } = render(<ModeCard mode={mode} />);
      expect(screen.getByText(mode.name)).toBeInTheDocument();
      unmount();
    }
  });
});
