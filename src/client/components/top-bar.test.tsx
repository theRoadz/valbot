// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { TopBar } from './top-bar';

afterEach(cleanup);

describe('TopBar', () => {
  it('renders the ValBot title', () => {
    render(<TopBar />);
    expect(screen.getByText('ValBot')).toBeInTheDocument();
  });

  it('shows disconnected status with label', () => {
    render(<TopBar />);
    expect(screen.getByText('Disconnected')).toBeInTheDocument();
  });

  it('renders all stat placeholders with zero values', () => {
    render(<TopBar />);
    expect(screen.getByText('Wallet:')).toBeInTheDocument();
    expect(screen.getByText('Total PnL:')).toBeInTheDocument();
    expect(screen.getByText('Session PnL:')).toBeInTheDocument();
    expect(screen.getByText('Trades:')).toBeInTheDocument();
    expect(screen.getByText('Volume:')).toBeInTheDocument();
    const zeroValues = screen.getAllByText('$0.00');
    expect(zeroValues.length).toBe(4);
    expect(screen.getByText('0')).toBeInTheDocument();
  });
});
