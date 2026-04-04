// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { TradeLog } from './trade-log';

afterEach(cleanup);

describe('TradeLog', () => {
  it('renders the title', () => {
    render(<TradeLog />);
    expect(screen.getByText('Live Trade Log')).toBeInTheDocument();
  });

  it('shows empty state message', () => {
    render(<TradeLog />);
    expect(screen.getByText('Waiting for trades...')).toBeInTheDocument();
  });
});
