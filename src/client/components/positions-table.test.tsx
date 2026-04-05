// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { PositionsTable } from './positions-table';
import useStore from '@client/store';

beforeEach(() => {
  useStore.setState({
    positions: [],
    closingPositions: [],
  });
});

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

  it('shows empty state message when positions array is empty', () => {
    render(<PositionsTable />);
    expect(screen.getByText('No open positions')).toBeInTheDocument();
  });

  it('renders position rows with correct mode tag abbreviation and color class', () => {
    useStore.setState({
      positions: [
        { id: 1, mode: 'volumeMax', pair: 'SOL-PERP', side: 'Long', size: 100, entryPrice: 150, stopLoss: 140, timestamp: 1000 },
        { id: 2, mode: 'profitHunter', pair: 'ETH-PERP', side: 'Short', size: 50, entryPrice: 3000, stopLoss: 3100, timestamp: 2000 },
        { id: 3, mode: 'arbitrage', pair: 'BTC-PERP', side: 'Long', size: 10, entryPrice: 60000, stopLoss: 58000, timestamp: 3000 },
      ],
    });

    render(<PositionsTable />);

    const volTag = screen.getByText('VOL');
    expect(volTag.className).toContain('text-mode-volume');

    const proTag = screen.getByText('PRO');
    expect(proTag.className).toContain('text-mode-profit');

    const arbTag = screen.getByText('ARB');
    expect(arbTag.className).toContain('text-mode-arb');
  });

  it('renders Side with correct color classes', () => {
    useStore.setState({
      positions: [
        { id: 1, mode: 'volumeMax', pair: 'SOL-PERP', side: 'Long', size: 100, entryPrice: 150, stopLoss: 140, timestamp: 1000 },
        { id: 2, mode: 'profitHunter', pair: 'ETH-PERP', side: 'Short', size: 50, entryPrice: 3000, stopLoss: 3100, timestamp: 2000 },
      ],
    });

    render(<PositionsTable />);

    const longEl = screen.getByText('Long');
    expect(longEl.className).toContain('text-profit');

    const shortEl = screen.getByText('Short');
    expect(shortEl.className).toContain('text-loss');
  });

  it('renders financial values with font-mono class', () => {
    useStore.setState({
      positions: [
        { id: 1, mode: 'volumeMax', pair: 'SOL-PERP', side: 'Long', size: 100, entryPrice: 150, stopLoss: 140, timestamp: 1000 },
      ],
    });

    render(<PositionsTable />);

    // Size, Entry, Stop-Loss should all have font-mono cells
    const sizeCell = screen.getByText('$100.00');
    expect(sizeCell.closest('td')?.className).toContain('font-mono');

    const entryCell = screen.getByText('$150.00');
    expect(entryCell.closest('td')?.className).toContain('font-mono');

    const stopLossCell = screen.getByText('$140.00');
    expect(stopLossCell.closest('td')?.className).toContain('font-mono');
  });

  it('renders mark and PnL as dashes when mark price is unavailable', () => {
    useStore.setState({
      positions: [
        { id: 1, mode: 'volumeMax', pair: 'SOL-PERP', side: 'Long', size: 100, entryPrice: 150, stopLoss: 140, timestamp: 1000 },
      ],
    });

    render(<PositionsTable />);

    // Mark and PnL columns show em-dash when no mark price data
    const dashes = screen.getAllByText('—');
    expect(dashes.length).toBe(2); // Mark and PnL
  });

  it('closing positions get yellow highlight class', () => {
    useStore.setState({
      positions: [
        { id: 1, mode: 'volumeMax', pair: 'SOL-PERP', side: 'Long', size: 100, entryPrice: 150, stopLoss: 140, timestamp: 1000 },
        { id: 2, mode: 'profitHunter', pair: 'ETH-PERP', side: 'Short', size: 50, entryPrice: 3000, stopLoss: 3100, timestamp: 2000 },
      ],
      closingPositions: [1],
    });

    render(<PositionsTable />);

    // Find the row containing VOL (position id 1 is closing)
    const volTag = screen.getByText('VOL');
    const closingRow = volTag.closest('tr');
    expect(closingRow?.className).toContain('bg-warning/20');

    // The other row should NOT have the highlight
    const proTag = screen.getByText('PRO');
    const normalRow = proTag.closest('tr');
    expect(normalRow?.className).not.toContain('bg-warning/20');
  });

  it('all table headers render correctly with expected count', () => {
    render(<PositionsTable />);
    const headers = ['Mode', 'Pair', 'Side', 'Size', 'Entry', 'Mark', 'PnL', 'Stop-Loss'];
    for (const header of headers) {
      expect(screen.getByText(header)).toBeInTheDocument();
    }
  });

  it('does not show empty state when positions exist', () => {
    useStore.setState({
      positions: [
        { id: 1, mode: 'volumeMax', pair: 'SOL-PERP', side: 'Long', size: 100, entryPrice: 150, stopLoss: 140, timestamp: 1000 },
      ],
    });

    render(<PositionsTable />);
    expect(screen.queryByText('No open positions')).not.toBeInTheDocument();
  });

  it('number header cells have text-right alignment', () => {
    render(<PositionsTable />);

    const sizeHeader = screen.getByText('Size');
    expect(sizeHeader.className).toContain('text-right');

    const entryHeader = screen.getByText('Entry');
    expect(entryHeader.className).toContain('text-right');

    const markHeader = screen.getByText('Mark');
    expect(markHeader.className).toContain('text-right');

    const pnlHeader = screen.getByText('PnL');
    expect(pnlHeader.className).toContain('text-right');

    const stopLossHeader = screen.getByText('Stop-Loss');
    expect(stopLossHeader.className).toContain('text-right');
  });
});
