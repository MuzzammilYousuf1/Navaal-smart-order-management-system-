import { useEffect, useRef, useCallback } from "react";
import { WS_URL } from "../api/client";

export function useWebSocket(onMessage) {
  const wsRef = useRef(null);
  const pingRef = useRef(null);

  const connect = useCallback(() => {
    try {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log("WS connected");
        // Ping every 25s to keep alive
        pingRef.current = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send("ping");
        }, 25000);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          onMessage?.(data);
        } catch {}
      };

      ws.onclose = () => {
        clearInterval(pingRef.current);
        // Reconnect after 3 seconds
        setTimeout(connect, 3000);
      };

      ws.onerror = () => ws.close();
    } catch (e) {
      setTimeout(connect, 5000);
    }
  }, [onMessage]);

  useEffect(() => {
    connect();
    return () => {
      clearInterval(pingRef.current);
      wsRef.current?.close();
    };
  }, [connect]);
}
