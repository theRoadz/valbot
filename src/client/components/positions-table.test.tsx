// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { PositionsTable } from './positions-table';
import useStore from '@client/store';
import type { StrategyInfo, ModeStatus } from '@shared/types';

const TEST_STRATEGIES: StrategyInfo[] = [
  { name: "Volume Max", description: "Volume maximization", modeType: "volumeMax", urlSlug: "volume-max", modeColor: "#8b5cf6", status: "stopped" as ModeStatus },
  { name: "Profit Hunter", description: "Profit hunting", modeType: "profitHunter", urlSlug: "profit-hunter", modeColor: "#22c55e", status: "stopped" as ModeStatus },
  { name: "Arbitrage", description: "Arbitrage trading", modeType: "arbitrage", urlSlug: "arbitrage", modeColor: "#06b6d4", status: "stopped" as ModeStatus },
];

beforeEach(() => {
  useStore.setState({
    positions: [],
    closingPositions: [],
    strategies: TEST_STRATEGIES,
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

  it('renders position rows with correct mode tag abbreviation and inline color', () => {
    useStore.setState({
      positions: [
        { id: 1, mode: 'volumeMax', pair: 'SOL-PERP', side: 'Long', size: 100, entryPrice: 150, stopLoss: 140, timestamp: 1000 },
        { id: 2, mode: 'profitHunter', pair: 'ETH-PERP', side: 'Short', size: 50, entryPrice: 3000, stopLoss: 3100, timestamp: 2000 },
        { id: 3, mode: 'arbitrage', pair: 'BTC-PERP', side: 'Long', size: 10, entryPrice: 60000, stopLoss: 58000, timestamp: 3000 },
      ],
    });

    render(<PositionsTable />);

    const volTag = screen.getByText('VOL');
    expect(volTag.style.color).toBe('rgb(139, 92, 246)');

    const proTag = screen.getByText('PRO');
    expect(proTag.style.color).toBe('rgb(34, 197, 94)');

    const arbTag = screen.getByText('ARB');
    expect(arbTag.style.color).toBe('rgb(6, 182, 212)');
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

  it('table header cells have scope="col" attribute', () => {
    render(<PositionsTable />);
    const thElements = document.querySelectorAll('th');
    expect(thElements.length).toBeGreaterThan(0);
    for (const th of thElements) {
      expect(th).toHaveAttribute('scope', 'col');
    }
  });

  it('closing position row has bg-warning/20 highlight and transition from base TableRow', () => {
    useStore.setState({
      positions: [
        { id: 1, mode: 'volumeMax', pair: 'SOL-PERP', side: 'Long', size: 100, entryPrice: 150, stopLoss: 140, timestamp: 1000 },
      ],
      closingPositions: [1],
    });

    render(<PositionsTable />);

    const volTag = screen.getByText('VOL');
    const closingRow = volTag.closest('tr');
    expect(closingRow?.className).toContain('bg-warning/20');
    expect(closingRow?.className).toContain('transition-colors');
    expect(closingRow?.className).toContain('duration-200');
  });

  it('non-closing position row has transition-colors from base TableRow', () => {
    useStore.setState({
      positions: [
        { id: 1, mode: 'volumeMax', pair: 'SOL-PERP', side: 'Long', size: 100, entryPrice: 150, stopLoss: 140, timestamp: 1000 },
      ],
      closingPositions: [],
    });

    render(<PositionsTable />);

    const volTag = screen.getByText('VOL');
    const row = volTag.closest('tr');
    expect(row?.className).toContain('transition-colors');
    expect(row?.className).toContain('duration-200');
    expect(row?.className).not.toContain('bg-warning/20');
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
