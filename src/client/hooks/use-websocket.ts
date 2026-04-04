import { useEffect } from "react";
import useStore from "@client/store";
import type { WsMessage } from "@shared/events";

const MAX_RETRIES = 5;

function getWsUrl(): string {
  const protocol = location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${location.host}/ws`;
}

export function useWebSocket() {
  const status = useStore((s) => s.connection.status);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let attempts = 0;
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
    let unmounted = false;

    function connect() {
      if (unmounted) return;

      if (ws) {
        ws.onclose = null;
        ws.close();
      }
      ws = new WebSocket(getWsUrl());

      ws.onopen = () => {
        attempts = 0;
        useStore.getState().setConnectionStatus("connected");
      };

      ws.onmessage = (event) => {
        try {
          const parsed: unknown = JSON.parse(event.data as string);
          if (
            typeof parsed === "object" &&
            parsed !== null &&
            "event" in parsed &&
            "timestamp" in parsed &&
            "data" in parsed
          ) {
            useStore.getState().handleWsMessage(parsed as WsMessage);
          }
        } catch {
          // ignore malformed messages
        }
      };

      ws.onerror = () => {
        // let close handler deal with reconnection
      };

      ws.onclose = () => {
        if (unmounted) return;

        if (attempts < MAX_RETRIES) {
          useStore.getState().setConnectionStatus("reconnecting");
          const delay = Math.min(1000 * 2 ** attempts, 4000);
          attempts++;
          reconnectTimeout = setTimeout(connect, delay);
        } else {
          useStore.getState().setConnectionStatus("disconnected");
        }
      };
    }

    connect();

    return () => {
      unmounted = true;
      if (reconnectTimeout !== null) {
        clearTimeout(reconnectTimeout);
      }
      if (ws) {
        ws.onclose = null;
        ws.close();
      }
    };
  }, []);

  return { status };
}
