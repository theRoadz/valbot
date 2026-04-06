import { HermesClient } from "@pythnetwork/hermes-client";
import type { EventSource } from "eventsource";
import { PYTH_FEED_IDS } from "../../shared/types.js";
import type { PythPriceData, PriceFeedEntry } from "../../shared/types.js";
import { EVENTS } from "../../shared/events.js";
import { logger } from "../lib/logger.js";
import { oracleConnectionFailedError, oracleStaleDataError } from "../lib/errors.js";
import type { EventName, EventPayloadMap } from "../../shared/events.js";

const HERMES_ENDPOINT = "https://hermes.pyth.network";
const MOVING_AVERAGE_WINDOW_MS = 300_000;
const STALE_THRESHOLD_MS = 30_000;
const BROADCAST_DEBOUNCE_MS = 500;
const MAX_SAMPLES_PER_PAIR = 2_000;
const MAX_RECONNECT_ATTEMPTS = 3;
const BACKOFF_BASE_MS = 1_000;
const HEARTBEAT_INTERVAL_MS = 10_000;
const MIN_DATA_FOR_MA_MS = 30_000;

interface PriceSample {
  price: number;
  timestamp: number;
}

interface PriceEntry {
  price: number;
  movingAverage: number | null;
  samples: PriceSample[];
  lastUpdate: number;
  feedId: string;
  rawData: PythPriceData | null;
}

type BroadcastFn = <E extends EventName>(event: E, data: EventPayloadMap[E]) => void;

export class OracleClient {
  private broadcast: BroadcastFn;
  private priceMap: Map<string, PriceEntry> = new Map();
  private feedIdToPair: Map<string, string> = new Map();
  private eventSource: EventSource | null = null;
  private isConnected = false;
  private reconnectAttempts = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lastBroadcast: Map<string, number> = new Map();
  private subscribedPairs: string[] = [];
  private hermesClient: HermesClient | null = null;
  private connecting = false;

  constructor(broadcast: BroadcastFn) {
    this.broadcast = broadcast;
  }

  async connect(pairs: string[]): Promise<void> {
    if (this.connecting) return;
    this.connecting = true;

    this.subscribedPairs = pairs;

    const feedIds: string[] = [];
    this.feedIdToPair.clear();

    // Remove priceMap entries for pairs no longer in the subscription
    const newPairSet = new Set(pairs);
    for (const key of this.priceMap.keys()) {
      if (!newPairSet.has(key)) {
        this.priceMap.delete(key);
      }
    }

    for (const pair of pairs) {
      const feedId = PYTH_FEED_IDS[pair];
      if (!feedId) {
        logger.warn({ pair }, "No Pyth feed ID found for pair — skipping");
        continue;
      }
      feedIds.push(feedId);
      this.feedIdToPair.set(feedId, pair);
    }

    if (feedIds.length === 0) {
      logger.error({ pairs }, "No valid Pyth feed IDs found for any pair");
      this.connecting = false;
      return;
    }

    this.hermesClient = new HermesClient(HERMES_ENDPOINT);

    try {
      this.eventSource = await this.hermesClient.getPriceUpdatesStream(feedIds, {
        parsed: true,
        allowUnordered: true,
      });

      this.eventSource.onmessage = (event: MessageEvent) => {
        this.handleMessage(event);
      };

      this.eventSource.onerror = () => {
        this.handleError();
      };

      this.isConnected = true;
      this.reconnectAttempts = 0;

      this.startHeartbeat();

      logger.info({ pairs, endpoint: HERMES_ENDPOINT }, "Pyth oracle connected");
    } catch (err) {
      logger.error({ err }, "Failed to connect to Pyth oracle");
      this.connecting = false;
      this.handleError();
      return;
    }

    this.connecting = false;
  }

  private handleMessage(event: MessageEvent): void {
    try {
      const data = JSON.parse(event.data as string);
      const parsed = data.parsed;
      if (!Array.isArray(parsed)) return;

      for (const entry of parsed) {
        const feedId = "0x" + (entry.id as string);
        const pair = this.feedIdToPair.get(feedId);
        if (!pair) continue;

        const rawPrice = parseInt(entry.price.price as string, 10);
        const expo = entry.price.expo as number;
        const publishTime = (entry.price.publish_time as number) * 1000; // convert to ms
        const confidence = parseInt(entry.price.conf as string, 10);

        if (isNaN(rawPrice) || isNaN(expo) || isNaN(publishTime)) {
          logger.warn({ feedId, pair }, "Pyth price update contains NaN fields — skipping");
          continue;
        }

        // Convert: rawPrice * 10^expo = USD float, then * 1e6 = smallest-unit
        const usdPrice = rawPrice * Math.pow(10, expo);
        const smallestUnit = Math.round(usdPrice * 1_000_000);

        if (!Number.isFinite(smallestUnit)) {
          logger.warn({ feedId, pair, rawPrice, expo }, "Pyth price conversion produced non-finite value — skipping");
          continue;
        }

        this.updatePrice(pair, smallestUnit, publishTime, feedId, confidence, rawPrice, expo);
      }
    } catch (err) {
      logger.error({ err }, "Failed to parse Pyth price update");
    }
  }

  private updatePrice(
    pair: string,
    price: number,
    timestamp: number,
    feedId: string,
    confidence: number,
    rawPrice: number,
    expo: number,
  ): void {
    // Guard against stale prices (e.g., replayed after SSE reconnection)
    const receiveTime = Date.now();
    if (receiveTime - timestamp > STALE_THRESHOLD_MS) {
      logger.info({ pair, publishTime: timestamp, age: receiveTime - timestamp }, "Rejecting stale Pyth price — publish_time too old");
      return;
    }

    let entry = this.priceMap.get(pair);

    if (!entry) {
      entry = { price: 0, movingAverage: null, samples: [], lastUpdate: 0, feedId, rawData: null };
      this.priceMap.set(pair, entry);
    }

    entry.price = price;
    entry.lastUpdate = receiveTime;
    entry.feedId = feedId;
    entry.rawData = {
      price: rawPrice,
      confidence,
      expo,
      publishTime: timestamp,
      feedId,
    };

    // Add sample and prune old ones
    entry.samples.push({ price, timestamp });
    const cutoff = timestamp - MOVING_AVERAGE_WINDOW_MS;
    while (entry.samples.length > 0 && entry.samples[0].timestamp < cutoff) {
      entry.samples.shift();
    }

    // Safety cap
    if (entry.samples.length > MAX_SAMPLES_PER_PAIR) {
      entry.samples = entry.samples.slice(entry.samples.length - MAX_SAMPLES_PER_PAIR);
    }

    // Calculate SMA
    if (entry.samples.length > 0) {
      const oldest = entry.samples[0].timestamp;
      const newest = entry.samples[entry.samples.length - 1].timestamp;
      if (newest - oldest >= MIN_DATA_FOR_MA_MS) {
        let sum = 0;
        for (const s of entry.samples) sum += s.price;
        entry.movingAverage = Math.round(sum / entry.samples.length);
      } else {
        entry.movingAverage = null;
      }
    }

    // Debounced broadcast
    const now = Date.now();
    const lastBroadcastTime = this.lastBroadcast.get(pair) ?? 0;
    if (now - lastBroadcastTime >= BROADCAST_DEBOUNCE_MS) {
      this.lastBroadcast.set(pair, now);
      this.broadcast(EVENTS.PRICE_UPDATED, {
        pair,
        price,
        movingAverage: entry.movingAverage,
        timestamp,
      });
    }
  }

  private handleError(): void {
    const wasConnected = this.isConnected;
    this.isConnected = false;
    logger.warn("Pyth oracle SSE disconnected, attempting reconnect");

    this.stopHeartbeat();
    this.closeEventSource();

    // Notify running consumers that oracle data may become stale
    if (wasConnected) {
      this.broadcast(EVENTS.ALERT_TRIGGERED, {
        severity: "warning",
        code: "ORACLE_FEED_UNAVAILABLE",
        message: "Pyth oracle feed disconnected — attempting reconnection",
        details: null,
        resolution: "Oracle price feed lost. Reconnection in progress. Active strategies using price data may operate on stale values.",
      });
    }

    this.attemptReconnect();
  }

  private attemptReconnect(): void {
    this.reconnectAttempts++;

    if (this.reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
      logger.error(
        { attempts: this.reconnectAttempts - 1 },
        "Pyth oracle reconnection failed after all retries",
      );
      const err = oracleConnectionFailedError("SSE reconnection exhausted after " + (this.reconnectAttempts - 1) + " attempts");
      this.broadcast(EVENTS.ALERT_TRIGGERED, {
        severity: err.severity,
        code: err.code,
        message: err.message,
        details: err.details ?? null,
        resolution: err.resolution ?? null,
      });
      return;
    }

    const delay = BACKOFF_BASE_MS * Math.pow(2, this.reconnectAttempts - 1);
    logger.warn(
      { attempt: this.reconnectAttempts, delay },
      "Pyth oracle reconnection attempt",
    );

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.connect(this.subscribedPairs);
      } catch {
        this.attemptReconnect();
      }
    }, delay);
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (!this.isConnected) return;

      // Check if any pair has been updated recently
      const now = Date.now();
      let mostRecentUpdate = 0;
      for (const entry of this.priceMap.values()) {
        if (entry.lastUpdate > mostRecentUpdate) {
          mostRecentUpdate = entry.lastUpdate;
        }
      }

      // If we have data and it's stale, trigger reconnection
      if (mostRecentUpdate > 0 && now - mostRecentUpdate > STALE_THRESHOLD_MS) {
        const staleErr = oracleStaleDataError("all", mostRecentUpdate);
        logger.warn(
          { staleSince: now - mostRecentUpdate, code: staleErr.code },
          "Pyth oracle data stale — triggering proactive reconnection",
        );
        this.isConnected = false;
        this.closeEventSource();
        this.reconnectAttempts = 0; // Reset since this is a proactive reconnect
        this.attemptReconnect();
      }
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private closeEventSource(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }

  getPrice(pair: string): number | null {
    const entry = this.priceMap.get(pair);
    if (!entry) return null;
    return entry.price;
  }

  getMovingAverage(pair: string): number | null {
    const entry = this.priceMap.get(pair);
    if (!entry) return null;
    return entry.movingAverage;
  }

  isAvailable(pair?: string): boolean {
    const now = Date.now();

    if (pair) {
      if (!this.isConnected) return false;
      const entry = this.priceMap.get(pair);
      if (!entry) return false;
      return now - entry.lastUpdate < STALE_THRESHOLD_MS;
    }

    // Global check: SSE connected and any pair updated within threshold
    if (!this.isConnected) return false;
    for (const entry of this.priceMap.values()) {
      if (now - entry.lastUpdate < STALE_THRESHOLD_MS) return true;
    }
    return false;
  }

  getFeedEntry(pair: string): PriceFeedEntry | null {
    const entry = this.priceMap.get(pair);
    if (!entry) return null;
    return {
      pair,
      price: entry.price,
      movingAverage: entry.movingAverage,
      lastUpdate: entry.lastUpdate,
      feedId: entry.feedId,
    };
  }

  getRawData(pair: string): PythPriceData | null {
    const entry = this.priceMap.get(pair);
    if (!entry) return null;
    return entry.rawData;
  }

  disconnect(): void {
    this.stopHeartbeat();
    this.closeEventSource();

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    this.isConnected = false;
    this.priceMap.clear();
    this.lastBroadcast.clear();
    this.feedIdToPair.clear();

    logger.info("Pyth oracle disconnected");
  }
}
