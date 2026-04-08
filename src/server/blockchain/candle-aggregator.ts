/** Candle aggregation and RSI calculation for oracle price feeds. */

export interface Candle {
  open: number;   // smallest-unit integer
  high: number;   // smallest-unit integer
  low: number;    // smallest-unit integer
  close: number;  // smallest-unit integer
  timestamp: number; // ms — candle open time
}

interface PendingCandle {
  open: number;
  high: number;
  low: number;
  close: number;
  openTime: number;
}

interface FeedState {
  candles: Candle[];
  pending: PendingCandle | null;
}

const DEFAULT_MAX_CANDLES = 20;

export class CandleAggregator {
  private feeds = new Map<string, FeedState>();
  private readonly maxCandles: number;

  constructor(maxCandles = DEFAULT_MAX_CANDLES) {
    this.maxCandles = maxCandles;
  }

  /** Feed a price sample into the aggregator. */
  addPrice(feedKey: string, price: number, timestamp: number, periodMs: number): void {
    let state = this.feeds.get(feedKey);
    if (!state) {
      state = { candles: [], pending: null };
      this.feeds.set(feedKey, state);
    }

    const candleOpenTime = Math.floor(timestamp / periodMs) * periodMs;

    // Reject out-of-order timestamps (earlier than current pending candle)
    if (state.pending && candleOpenTime < state.pending.openTime) {
      return;
    }

    if (state.pending && state.pending.openTime !== candleOpenTime) {
      // Finalize the pending candle
      this.finalizeCandle(state);

      // Fill gap candles with flat candles (close = last known close) for skipped periods
      const lastClose = state.candles[state.candles.length - 1]!.close;
      let gapStart = state.candles[state.candles.length - 1]!.timestamp + periodMs;
      while (gapStart < candleOpenTime) {
        state.candles.push({
          open: lastClose,
          high: lastClose,
          low: lastClose,
          close: lastClose,
          timestamp: gapStart,
        });
        gapStart += periodMs;
      }

      // Prune after gap fill
      if (state.candles.length > this.maxCandles) {
        state.candles = state.candles.slice(state.candles.length - this.maxCandles);
      }
    }

    if (!state.pending) {
      state.pending = {
        open: price,
        high: price,
        low: price,
        close: price,
        openTime: candleOpenTime,
      };
    } else {
      if (price > state.pending.high) state.pending.high = price;
      if (price < state.pending.low) state.pending.low = price;
      state.pending.close = price;
    }
  }

  private finalizeCandle(state: FeedState): void {
    if (!state.pending) return;
    state.candles.push({
      open: state.pending.open,
      high: state.pending.high,
      low: state.pending.low,
      close: state.pending.close,
      timestamp: state.pending.openTime,
    });
    if (state.candles.length > this.maxCandles) {
      state.candles = state.candles.slice(state.candles.length - this.maxCandles);
    }
    state.pending = null;
  }

  /** Get completed candles for a feed. */
  getCandles(feedKey: string, count?: number): Candle[] {
    const state = this.feeds.get(feedKey);
    if (!state) return [];
    const candles = state.candles;
    if (count === undefined || count >= candles.length) return [...candles];
    return candles.slice(candles.length - count);
  }

  /**
   * Calculate RSI from completed candle close prices.
   * Returns null if insufficient candles (need period + 1 closes for period changes).
   */
  getRsi(feedKey: string, period: number): number | null {
    const state = this.feeds.get(feedKey);
    if (!state) return null;

    const closes = state.candles.map((c) => c.close);
    return calculateRsi(closes, period);
  }
}

export function calculateRsi(closes: number[], period: number): number | null {
  if (closes.length < period + 1) return null;

  let avgGain = 0;
  let avgLoss = 0;

  // Initial average from first `period` changes
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) avgGain += change;
    else avgLoss += Math.abs(change);
  }
  avgGain /= period;
  avgLoss /= period;

  // Smoothed for remaining
  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) {
      avgGain = (avgGain * (period - 1) + change) / period;
      avgLoss = (avgLoss * (period - 1)) / period;
    } else {
      avgGain = (avgGain * (period - 1)) / period;
      avgLoss = (avgLoss * (period - 1) + Math.abs(change)) / period;
    }
  }

  if (avgLoss === 0 && avgGain === 0) return 50; // flat market — neutral
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}
