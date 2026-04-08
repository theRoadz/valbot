import { describe, it, expect, beforeEach } from "vitest";
import { CandleAggregator, calculateRsi, calculateEma } from "./candle-aggregator.js";

const PERIOD_MS = 300_000; // 5 minutes

describe("CandleAggregator", () => {
  let aggregator: CandleAggregator;

  beforeEach(() => {
    aggregator = new CandleAggregator(20);
  });

  describe("candle formation", () => {
    it("creates no completed candles from samples within one period", () => {
      const base = PERIOD_MS * 10; // starts at period 10
      aggregator.addPrice("SOL-PERP", 100_000_000, base, PERIOD_MS);
      aggregator.addPrice("SOL-PERP", 101_000_000, base + 60_000, PERIOD_MS);
      aggregator.addPrice("SOL-PERP", 99_000_000, base + 120_000, PERIOD_MS);

      expect(aggregator.getCandles("SOL-PERP")).toEqual([]);
    });

    it("completes a candle when price arrives in a new period", () => {
      const base = PERIOD_MS * 10;
      aggregator.addPrice("SOL-PERP", 100_000_000, base, PERIOD_MS);
      aggregator.addPrice("SOL-PERP", 105_000_000, base + 60_000, PERIOD_MS);
      aggregator.addPrice("SOL-PERP", 98_000_000, base + 120_000, PERIOD_MS);
      aggregator.addPrice("SOL-PERP", 102_000_000, base + 240_000, PERIOD_MS);

      // Trigger new period
      aggregator.addPrice("SOL-PERP", 103_000_000, base + PERIOD_MS, PERIOD_MS);

      const candles = aggregator.getCandles("SOL-PERP");
      expect(candles).toHaveLength(1);
      expect(candles[0]).toEqual({
        open: 100_000_000,
        high: 105_000_000,
        low: 98_000_000,
        close: 102_000_000,
        timestamp: base,
      });
    });

    it("tracks OHLC correctly across multiple periods", () => {
      const base = PERIOD_MS * 10;

      // Period 1
      aggregator.addPrice("SOL-PERP", 100_000_000, base, PERIOD_MS);
      aggregator.addPrice("SOL-PERP", 110_000_000, base + 60_000, PERIOD_MS);
      aggregator.addPrice("SOL-PERP", 95_000_000, base + 120_000, PERIOD_MS);

      // Period 2
      aggregator.addPrice("SOL-PERP", 96_000_000, base + PERIOD_MS, PERIOD_MS);
      aggregator.addPrice("SOL-PERP", 99_000_000, base + PERIOD_MS + 60_000, PERIOD_MS);

      // Period 3 (triggers period 2 completion)
      aggregator.addPrice("SOL-PERP", 101_000_000, base + PERIOD_MS * 2, PERIOD_MS);

      const candles = aggregator.getCandles("SOL-PERP");
      expect(candles).toHaveLength(2);
      expect(candles[0].open).toBe(100_000_000);
      expect(candles[0].close).toBe(95_000_000);
      expect(candles[1].open).toBe(96_000_000);
      expect(candles[1].close).toBe(99_000_000);
    });

    it("returns empty array for unknown feed key", () => {
      expect(aggregator.getCandles("UNKNOWN")).toEqual([]);
    });

    it("limits candles to maxCandles", () => {
      const smallAgg = new CandleAggregator(3);
      const base = PERIOD_MS * 10;

      // Create 5 complete candles
      for (let i = 0; i < 6; i++) {
        smallAgg.addPrice("SOL-PERP", 100_000_000 + i * 1_000_000, base + i * PERIOD_MS, PERIOD_MS);
      }

      const candles = smallAgg.getCandles("SOL-PERP");
      expect(candles.length).toBeLessThanOrEqual(3);
    });

    it("getCandles respects count parameter", () => {
      const base = PERIOD_MS * 10;
      for (let i = 0; i < 6; i++) {
        aggregator.addPrice("SOL-PERP", 100_000_000 + i * 1_000_000, base + i * PERIOD_MS, PERIOD_MS);
      }

      const candles = aggregator.getCandles("SOL-PERP", 2);
      expect(candles).toHaveLength(2);
    });

    it("tracks separate feeds independently", () => {
      const base = PERIOD_MS * 10;

      aggregator.addPrice("SOL-PERP", 100_000_000, base, PERIOD_MS);
      aggregator.addPrice("ETH-PERP", 200_000_000, base, PERIOD_MS);

      aggregator.addPrice("SOL-PERP", 101_000_000, base + PERIOD_MS, PERIOD_MS);
      aggregator.addPrice("ETH-PERP", 201_000_000, base + PERIOD_MS, PERIOD_MS);

      const solCandles = aggregator.getCandles("SOL-PERP");
      const ethCandles = aggregator.getCandles("ETH-PERP");

      expect(solCandles).toHaveLength(1);
      expect(ethCandles).toHaveLength(1);
      expect(solCandles[0].open).toBe(100_000_000);
      expect(ethCandles[0].open).toBe(200_000_000);
    });

    it("rejects out-of-order timestamps silently", () => {
      const base = PERIOD_MS * 10;

      // Period 1
      aggregator.addPrice("SOL-PERP", 100_000_000, base, PERIOD_MS);
      aggregator.addPrice("SOL-PERP", 105_000_000, base + 60_000, PERIOD_MS);

      // Period 2 starts
      aggregator.addPrice("SOL-PERP", 102_000_000, base + PERIOD_MS, PERIOD_MS);

      // Late-arriving sample from period 1 — should be rejected
      aggregator.addPrice("SOL-PERP", 99_000_000, base + 120_000, PERIOD_MS);

      // Period 3 triggers period 2 completion
      aggregator.addPrice("SOL-PERP", 103_000_000, base + PERIOD_MS * 2, PERIOD_MS);

      const candles = aggregator.getCandles("SOL-PERP");
      expect(candles).toHaveLength(2);
      // Period 1 should NOT include the rejected 99M sample
      expect(candles[0].low).toBe(100_000_000);
      expect(candles[0].close).toBe(105_000_000);
    });

    it("fills gap candles when periods are skipped", () => {
      const base = PERIOD_MS * 10;

      // Period 1
      aggregator.addPrice("SOL-PERP", 100_000_000, base, PERIOD_MS);

      // Skip period 2 and 3, jump to period 4
      aggregator.addPrice("SOL-PERP", 110_000_000, base + PERIOD_MS * 3, PERIOD_MS);

      const candles = aggregator.getCandles("SOL-PERP");
      // Should have: period 1 (real) + period 2 (gap fill) + period 3 (gap fill) = 3
      expect(candles).toHaveLength(3);

      // Gap candles use last known close
      expect(candles[1].open).toBe(100_000_000);
      expect(candles[1].close).toBe(100_000_000);
      expect(candles[1].high).toBe(100_000_000);
      expect(candles[1].low).toBe(100_000_000);
      expect(candles[1].timestamp).toBe(base + PERIOD_MS);

      expect(candles[2].open).toBe(100_000_000);
      expect(candles[2].close).toBe(100_000_000);
      expect(candles[2].timestamp).toBe(base + PERIOD_MS * 2);
    });

    it("limits gap candles to maxCandles", () => {
      const smallAgg = new CandleAggregator(5);
      const base = PERIOD_MS * 10;

      // Period 1
      smallAgg.addPrice("SOL-PERP", 100_000_000, base, PERIOD_MS);

      // Skip 10 periods (would create 10 gap candles + 1 real = 11, exceeds max 5)
      smallAgg.addPrice("SOL-PERP", 110_000_000, base + PERIOD_MS * 10, PERIOD_MS);

      const candles = smallAgg.getCandles("SOL-PERP");
      expect(candles.length).toBeLessThanOrEqual(5);
    });
  });

  describe("getRsi", () => {
    it("returns null when insufficient candles", () => {
      expect(aggregator.getRsi("SOL-PERP", 14)).toBeNull();
    });

    it("returns null for unknown feed", () => {
      expect(aggregator.getRsi("UNKNOWN", 14)).toBeNull();
    });

    it("returns valid RSI with enough candles", () => {
      const base = PERIOD_MS * 10;
      // Create 16 completed candles (need 15 for RSI(14) = 14+1 closes)
      const prices = [100, 102, 101, 103, 104, 102, 100, 99, 101, 103, 105, 104, 103, 102, 101, 100];
      for (let i = 0; i < prices.length + 1; i++) {
        const price = (prices[Math.min(i, prices.length - 1)]) * 1_000_000;
        aggregator.addPrice("SOL-PERP", price, base + i * PERIOD_MS, PERIOD_MS);
      }

      const rsi = aggregator.getRsi("SOL-PERP", 14);
      expect(rsi).not.toBeNull();
      expect(rsi!).toBeGreaterThanOrEqual(0);
      expect(rsi!).toBeLessThanOrEqual(100);
    });
  });
});

describe("CandleAggregator.getEma", () => {
  it("returns null when insufficient candles", () => {
    const aggregator = new CandleAggregator(20);
    expect(aggregator.getEma("SOL-PERP", 9)).toBeNull();
  });

  it("returns null for unknown feed", () => {
    const aggregator = new CandleAggregator(20);
    expect(aggregator.getEma("UNKNOWN", 9)).toBeNull();
  });

  it("returns valid EMA with enough candles", () => {
    const aggregator = new CandleAggregator(20);
    const base = PERIOD_MS * 10;
    // Create 10 completed candles (enough for EMA(9))
    const prices = [100, 102, 101, 103, 104, 102, 100, 99, 101, 103, 105];
    for (let i = 0; i < prices.length; i++) {
      aggregator.addPrice("SOL-PERP", prices[i] * 1_000_000, base + i * PERIOD_MS, PERIOD_MS);
    }

    const ema = aggregator.getEma("SOL-PERP", 9);
    expect(ema).not.toBeNull();
    expect(ema!).toBeGreaterThan(0);
  });
});

describe("calculateEma", () => {
  it("returns null when period <= 0", () => {
    expect(calculateEma([100, 101, 102], 0)).toBeNull();
    expect(calculateEma([100, 101, 102], -1)).toBeNull();
  });

  it("returns null when closes.length < period", () => {
    expect(calculateEma([100, 101, 102], 9)).toBeNull();
  });

  it("returns SMA when closes.length == period (no smoothing steps)", () => {
    const closes = [100, 102, 104, 106, 108, 110, 112, 114, 116];
    const ema = calculateEma(closes, 9);
    const sma = closes.reduce((a, b) => a + b, 0) / 9;
    expect(ema).toBeCloseTo(sma, 5);
  });

  it("weights recent prices more heavily (uptrend → EMA > SMA)", () => {
    // Strong uptrend: EMA should track closer to recent high prices
    const closes = [100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 120];
    const ema = calculateEma(closes, 9);
    const sma = closes.reduce((a, b) => a + b, 0) / closes.length;
    expect(ema!).toBeGreaterThan(sma); // EMA reacts faster to uptrend
  });

  it("produces known EMA value for simple series", () => {
    // Prices: [10, 11, 12, 13, 14] with period=3
    // SMA(first 3) = (10+11+12)/3 = 11
    // k = 2/(3+1) = 0.5
    // EMA after 13: 13*0.5 + 11*0.5 = 12
    // EMA after 14: 14*0.5 + 12*0.5 = 13
    const closes = [10, 11, 12, 13, 14];
    const ema = calculateEma(closes, 3);
    expect(ema).toBeCloseTo(13, 5);
  });

  it("returns constant value for flat prices", () => {
    const closes = [100, 100, 100, 100, 100, 100, 100, 100, 100];
    const ema = calculateEma(closes, 5);
    expect(ema).toBeCloseTo(100, 5);
  });
});

describe("calculateRsi", () => {
  it("returns null when closes.length < period + 1", () => {
    expect(calculateRsi([100, 101, 102], 14)).toBeNull();
  });

  it("returns 100 when all changes are gains (no losses)", () => {
    const closes = [100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114];
    expect(calculateRsi(closes, 14)).toBe(100);
  });

  it("returns value near 0 when all changes are losses", () => {
    const closes = [114, 113, 112, 111, 110, 109, 108, 107, 106, 105, 104, 103, 102, 101, 100];
    const rsi = calculateRsi(closes, 14);
    expect(rsi).not.toBeNull();
    expect(rsi!).toBeLessThan(1);
  });

  it("returns ~50 for equal gains and losses", () => {
    // Alternating +1 / -1
    const closes = [100, 101, 100, 101, 100, 101, 100, 101, 100, 101, 100, 101, 100, 101, 100];
    const rsi = calculateRsi(closes, 14);
    expect(rsi).not.toBeNull();
    expect(rsi!).toBeCloseTo(50, 0);
  });

  it("returns value between 0 and 100", () => {
    const closes = [100, 102, 101, 103, 104, 102, 100, 99, 101, 103, 105, 104, 103, 102, 101];
    const rsi = calculateRsi(closes, 14);
    expect(rsi).not.toBeNull();
    expect(rsi!).toBeGreaterThanOrEqual(0);
    expect(rsi!).toBeLessThanOrEqual(100);
  });

  it("returns 50 for flat/constant prices (no movement)", () => {
    const closes = [100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 100];
    const rsi = calculateRsi(closes, 14);
    expect(rsi).toBe(50);
  });

  it("calculates correctly with smoothed RSI for longer series", () => {
    // 20 prices: strong downtrend
    const closes = [120, 118, 116, 114, 112, 110, 108, 106, 104, 102, 100, 99, 98, 97, 96, 95, 94, 93, 92, 91];
    const rsi = calculateRsi(closes, 14);
    expect(rsi).not.toBeNull();
    // Sustained downtrend should produce RSI well below 50
    expect(rsi!).toBeLessThan(20);
  });
});
