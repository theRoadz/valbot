// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { PositionsTable } from './positions-table';

afterEach(cleanup);

describe('PositionsTable', () => {
  it('renders the title', () => {
    render(<PositionsTable />);
    expect(screen.getByText('Open Positions')).toBeInTheDocument();
  });

  it('renders all table headers', () => {
    render(<PositionsTable />);
    const headers = ['Mode', 'Pair', 'Side', 'Size', 'Entry', 'Mark', 'PnL', 'Stop-Loss'];
    for (const header of headers) {
      expect(screen.getByText(header)).toBeInTheDocument();
    }
  });

  it('shows empty state message', () => {
    render(<PositionsTable />);
    expect(screen.getByText('No open positions')).toBeInTheDocument();
  });
});
