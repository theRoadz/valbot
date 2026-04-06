import { useEffect, useRef } from "react";
import { toast } from "sonner";
import useStore from "@client/store";
import type { Alert } from "@shared/types";

export function useAlertToast() {
  const toastQueue = useStore((s) => s.toastQueue);
  const clearToastQueue = useStore((s) => s.clearToastQueue);
  const processingRef = useRef(false);

  useEffect(() => {
    if (toastQueue.length === 0 || processingRef.current) return;
    processingRef.current = true;

    for (const alert of toastQueue) {
      fireToast(alert);
    }

    clearToastQueue();
    processingRef.current = false;
  }, [toastQueue, clearToastQueue]);
}

function fireToast(alert: Alert) {
  const { severity, code, message, details, resolution, timestamp, autoDismissMs } = alert;
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(timestamp);
  const descParts = [details, resolution, time].filter(Boolean).join(" · ");

  if (severity === "warning") {
    toast.warning(message, {
      id: code,
      duration: Infinity,
      description: descParts || undefined,
      cancel: { label: "✕", onClick: () => {} },
    });
  } else {
    // info
    toast.success(message, {
      id: code,
      duration: autoDismissMs ?? 5000,
      description: descParts || undefined,
    });
  }
}
