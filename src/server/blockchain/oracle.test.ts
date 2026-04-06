import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { OracleClient } from "./oracle.js";
import { EVENTS } from "../../shared/events.js";

// Mock HermesClient
function createMockEventSource() {
  return {
    onmessage: null as ((event: MessageEvent) => void) | null,
    onerror: null as (() => void) | null,
    close: vi.fn(),
  };
}

let mockEventSources: ReturnType<typeof createMockEventSource>[] = [];
let getPriceUpdatesStreamImpl: (...args: unknown[]) => Promise<ReturnType<typeof createMockEventSource>>;

vi.mock("@pythnetwork/hermes-client", () => {
  class MockHermesClient {
    constructor(_endpoint: string) {}
    async getPriceUpdatesStream(...args: unknown[]) {
      return getPriceUpdatesStreamImpl(...args);
    }
  }
  return { HermesClient: MockHermesClient };
});

// Mock logger
vi.mock("../lib/logger.js", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

function createMockBroadcast() {
  return vi.fn();
}

// Helper to create a Pyth SSE message event
function makePriceMessage(feedId: string, price: string, expo: number, publishTimeSec: number, conf = "100") {
  return {
    data: JSON.stringify({
      parsed: [
        {
          id: feedId.replace("0x", ""),
          price: { price, conf, expo, publish_time: publishTimeSec },
          ema_price: { price, conf, expo, publish_time: publishTimeSec },
        },
      ],
    }),
  } as MessageEvent;
}

const SOL_FEED = "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";
const BTC_FEED = "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43";

describe("OracleClient", () => {
  let broadcast: ReturnType<typeof createMockBroadcast>;
  let oracle: OracleClient;

  beforeEach(() => {
    vi.useFakeTimers();
    broadcast = createMockBroadcast();
    oracle = new OracleClient(broadcast);
    mockEventSources = [];
    getPriceUpdatesStreamImpl = async () => {
      const es = createMockEventSource();
      mockEventSources.push(es);
      return es;
    };
  });

  afterEach(() => {
    oracle.disconnect();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function getEs(index = 0) {
    return mockEventSources[index];
  }

  it("constructor creates instance with broadcast function", () => {
    expect(oracle).toBeInstanceOf(OracleClient);
  });

  it("connect() creates HermesClient and opens SSE stream", async () => {
    await oracle.connect(["SOL-PERP"]);
    expect(mockEventSources.length).toBe(1);
  });

  it("onmessage handler parses Pyth price and converts to smallest-unit integers", async () => {
    await oracle.connect(["SOL-PERP"]);
    const es = getEs();

    // SOL price: 3847250000 * 10^-8 = $38.4725 → 38_472_500 smallest-unit
    es.onmessage!(makePriceMessage(SOL_FEED, "3847250000", -8, 1700000000));

    expect(oracle.getPrice("SOL-PERP")).toBe(38_472_500);
  });

  it("moving average calculation is correct with known sample data", async () => {
    await oracle.connect(["SOL-PERP"]);
    const es = getEs();

    // Send 4 price updates over 31 seconds (enough for MA)
    const prices = [
      { price: "3800000000", time: 1700000000 },
      { price: "3900000000", time: 1700000010 },
      { price: "4000000000", time: 1700000020 },
      { price: "4100000000", time: 1700000031 },
    ];

    for (const p of prices) {
      es.onmessage!(makePriceMessage(SOL_FEED, p.price, -8, p.time));
    }

    // Prices in smallest-unit: 38_000_000, 39_000_000, 40_000_000, 41_000_000
    // SMA = (38_000_000 + 39_000_000 + 40_000_000 + 41_000_000) / 4 = 39_500_000
    expect(oracle.getMovingAverage("SOL-PERP")).toBe(39_500_000);
  });

  it("moving average returns null when insufficient data (<30s of samples)", async () => {
    await oracle.connect(["SOL-PERP"]);
    const es = getEs();

    // Only 10 seconds of data
    es.onmessage!(makePriceMessage(SOL_FEED, "3800000000", -8, 1700000000));
    es.onmessage!(makePriceMessage(SOL_FEED, "3900000000", -8, 1700000010));

    expect(oracle.getMovingAverage("SOL-PERP")).toBeNull();
  });

  it("getPrice() returns latest price or null when no data", async () => {
    await oracle.connect(["SOL-PERP"]);

    expect(oracle.getPrice("SOL-PERP")).toBeNull();
    expect(oracle.getPrice("NONEXISTENT")).toBeNull();
  });

  it("getMovingAverage() returns null when no data", async () => {
    await oracle.connect(["SOL-PERP"]);

    expect(oracle.getMovingAverage("SOL-PERP")).toBeNull();
    expect(oracle.getMovingAverage("NONEXISTENT")).toBeNull();
  });

  it("isAvailable() returns false when no updates received in 30s", async () => {
    await oracle.connect(["SOL-PERP"]);
    const es = getEs();

    // Send a price update now
    const nowSec = Math.floor(Date.now() / 1000);
    es.onmessage!(makePriceMessage(SOL_FEED, "3800000000", -8, nowSec));

    // Advance past stale threshold
    vi.advanceTimersByTime(31_000);

    expect(oracle.isAvailable()).toBe(false);
  });

  it("isAvailable(pair) returns per-pair availability correctly", async () => {
    await oracle.connect(["SOL-PERP", "BTC-PERP"]);
    const es = getEs();

    const nowSec = Math.floor(Date.now() / 1000);
    // BTC: will become stale
    es.onmessage!(makePriceMessage(BTC_FEED, "6100000000000", -8, nowSec));

    // Advance 31s so BTC goes stale
    vi.advanceTimersByTime(31_000);

    // SOL: fresh (sent after time advance)
    es.onmessage!(makePriceMessage(SOL_FEED, "3800000000", -8, nowSec));

    expect(oracle.isAvailable("SOL-PERP")).toBe(true);
    expect(oracle.isAvailable("BTC-PERP")).toBe(false);
  });

  it("SSE error triggers reconnection with exponential backoff", async () => {
    await oracle.connect(["SOL-PERP"]);
    const es = getEs();

    // Trigger error
    es.onerror!();

    expect(es.close).toHaveBeenCalled();

    // Advance past first retry (1s)
    await vi.advanceTimersByTimeAsync(1100);
    // A new event source should have been created for reconnection
    expect(mockEventSources.length).toBe(2);
  });

  it("after 3 failed reconnections, broadcasts critical alert", async () => {
    await oracle.connect(["SOL-PERP"]);
    const es = getEs();

    // Make reconnection attempts fail
    let failCount = 0;
    getPriceUpdatesStreamImpl = async () => {
      failCount++;
      throw new Error("Connection failed");
    };

    // Trigger error
    es.onerror!();

    // Advance through all 3 retry attempts (1s + 2s + 4s)
    await vi.advanceTimersByTimeAsync(1100); // Attempt 1
    await vi.advanceTimersByTimeAsync(2100); // Attempt 2
    await vi.advanceTimersByTimeAsync(4100); // Attempt 3

    // Should have broadcast critical alert
    const alertCalls = broadcast.mock.calls.filter(
      (call: unknown[]) => call[0] === EVENTS.ALERT_TRIGGERED && (call[1] as { severity: string }).severity === "critical",
    );
    expect(alertCalls.length).toBeGreaterThanOrEqual(1);
    expect(failCount).toBe(3);
  });

  it("disconnect() closes SSE and clears buffers", async () => {
    await oracle.connect(["SOL-PERP"]);
    const es = getEs();

    // Add some data
    es.onmessage!(makePriceMessage(SOL_FEED, "3800000000", -8, 1700000000));
    expect(oracle.getPrice("SOL-PERP")).not.toBeNull();

    oracle.disconnect();

    expect(es.close).toHaveBeenCalled();
    expect(oracle.getPrice("SOL-PERP")).toBeNull();
    expect(oracle.isAvailable()).toBe(false);
  });

  it("price broadcast is debounced (max 1 per 500ms per pair)", async () => {
    await oracle.connect(["SOL-PERP"]);
    const es = getEs();

    // Send 5 rapid updates
    for (let i = 0; i < 5; i++) {
      es.onmessage!(makePriceMessage(SOL_FEED, `${3800000000 + i * 1000000}`, -8, 1700000000 + i));
    }

    // Only 1 broadcast should have been sent (the first one)
    const priceBroadcasts = broadcast.mock.calls.filter(
      (call: unknown[]) => call[0] === EVENTS.PRICE_UPDATED,
    );
    expect(priceBroadcasts.length).toBe(1);

    // Advance past debounce window
    vi.advanceTimersByTime(600);

    // Send another update
    es.onmessage!(makePriceMessage(SOL_FEED, "3900000000", -8, 1700000010));

    const priceBroadcasts2 = broadcast.mock.calls.filter(
      (call: unknown[]) => call[0] === EVENTS.PRICE_UPDATED,
    );
    expect(priceBroadcasts2.length).toBe(2);
  });

  it("staleness heartbeat triggers reconnection when no updates for 30s", async () => {
    await oracle.connect(["SOL-PERP"]);
    const es = getEs();

    // Send a price update "now"
    const nowSec = Math.floor(Date.now() / 1000);
    es.onmessage!(makePriceMessage(SOL_FEED, "3800000000", -8, nowSec));

    // Advance time past stale threshold + heartbeat interval
    vi.advanceTimersByTime(31_000 + 10_000);

    // Event source should have been closed for reconnection
    expect(es.close).toHaveBeenCalled();
  });

  it("getFeedEntry() returns PriceFeedEntry with all fields", async () => {
    await oracle.connect(["SOL-PERP"]);
    const es = getEs();

    es.onmessage!(makePriceMessage(SOL_FEED, "3847250000", -8, 1700000000));

    const entry = oracle.getFeedEntry("SOL-PERP");
    expect(entry).not.toBeNull();
    expect(entry!.pair).toBe("SOL-PERP");
    expect(entry!.price).toBe(38_472_500);
    expect(entry!.feedId).toBe(SOL_FEED);
    expect(entry!.lastUpdate).toBeGreaterThan(0);
    expect(entry!.movingAverage).toBeNull(); // insufficient data
  });

  it("getFeedEntry() returns null for unknown pair", async () => {
    await oracle.connect(["SOL-PERP"]);
    expect(oracle.getFeedEntry("NONEXISTENT")).toBeNull();
  });

  it("getRawData() returns raw PythPriceData", async () => {
    await oracle.connect(["SOL-PERP"]);
    const es = getEs();

    es.onmessage!(makePriceMessage(SOL_FEED, "3847250000", -8, 1700000000, "5000"));

    const raw = oracle.getRawData("SOL-PERP");
    expect(raw).not.toBeNull();
    expect(raw!.price).toBe(3847250000);
    expect(raw!.confidence).toBe(5000);
    expect(raw!.expo).toBe(-8);
    expect(raw!.publishTime).toBe(1700000000000); // ms
    expect(raw!.feedId).toBe(SOL_FEED);
  });

  it("getRawData() returns null for unknown pair", async () => {
    await oracle.connect(["SOL-PERP"]);
    expect(oracle.getRawData("NONEXISTENT")).toBeNull();
  });

  it("reconnect with fewer pairs clears stale priceMap entries", async () => {
    // First connection with both pairs
    await oracle.connect(["SOL-PERP", "BTC-PERP"]);
    const es = getEs();

    // Populate both pairs
    es.onmessage!(makePriceMessage(SOL_FEED, "3800000000", -8, 1700000000));
    es.onmessage!(makePriceMessage(BTC_FEED, "6100000000000", -8, 1700000000));

    expect(oracle.getPrice("SOL-PERP")).not.toBeNull();
    expect(oracle.getPrice("BTC-PERP")).not.toBeNull();

    // Simulate error triggering reconnect — but make reconnect use fewer pairs
    // by patching subscribedPairs before the timer fires
    es.onerror!();

    // Override to only SOL-PERP
    (oracle as any).subscribedPairs = ["SOL-PERP"];

    // Advance past first retry (1s)
    await vi.advanceTimersByTimeAsync(1100);

    // BTC-PERP should have been pruned from priceMap during reconnect
    expect(oracle.getPrice("BTC-PERP")).toBeNull();
    // SOL-PERP data persists (may be stale but entry exists)
    // Note: SOL entry survived the reconnect since it's still in the new pair set
  });

  it("handleError broadcasts warning alert when connection was active", async () => {
    await oracle.connect(["SOL-PERP"]);
    const es = getEs();

    // Trigger error on active connection
    es.onerror!();

    const warningAlerts = broadcast.mock.calls.filter(
      (call: unknown[]) => call[0] === EVENTS.ALERT_TRIGGERED && (call[1] as { severity: string }).severity === "warning",
    );
    expect(warningAlerts.length).toBeGreaterThanOrEqual(1);
    expect((warningAlerts[0][1] as { code: string }).code).toBe("ORACLE_FEED_UNAVAILABLE");
  });

  it("skips NaN price data without crashing", async () => {
    await oracle.connect(["SOL-PERP"]);
    const es = getEs();

    // Send malformed price
    const badMsg = {
      data: JSON.stringify({
        parsed: [{
          id: SOL_FEED.replace("0x", ""),
          price: { price: "not-a-number", conf: "100", expo: -8, publish_time: 1700000000 },
          ema_price: { price: "not-a-number", conf: "100", expo: -8, publish_time: 1700000000 },
        }],
      }),
    } as MessageEvent;

    es.onmessage!(badMsg);
    expect(oracle.getPrice("SOL-PERP")).toBeNull();
  });
});
