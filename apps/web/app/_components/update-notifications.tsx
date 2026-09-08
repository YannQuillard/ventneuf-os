"use client";

import { Button } from "@astryxdesign/core/Button";
import { useToast } from "@astryxdesign/core/Toast";
import { useEffect, useRef } from "react";

const localRunnerUrl = "http://127.0.0.1:41929";

interface RunnerUpdateStatus { latestVersion: string; available: boolean }

export function UpdateNotifications() {
  const toast = useToast();
  const webVersion = useRef<string | undefined>(undefined);
  const notifiedWebVersion = useRef<string | undefined>(undefined);
  const notifiedRunnerVersion = useRef<string | undefined>(undefined);

  useEffect(() => {
    let isDisposed = false;
    const check = async () => {
      try {
        const response = await fetch("/api/version", { cache: "no-store" });
        if (response.ok) {
          const { version } = await response.json() as { version?: string };
          if (version && webVersion.current && version !== webVersion.current && notifiedWebVersion.current !== version && !isDisposed) {
            notifiedWebVersion.current = version;
            toast({ body: "A new web version is available.", isAutoHide: false, uniqueID: "web-update",
              collisionBehavior: "overwrite", endContent: <Button label="Reload" size="sm" variant="secondary"
                onClick={() => window.location.reload()} /> });
          } else if (version && !webVersion.current) webVersion.current = version;
        }
      } catch { /* The current page remains usable while version discovery is unavailable. */ }

      try {
        const local = await fetch(`${localRunnerUrl}/status`, { cache: "no-store" });
        if (!local.ok || (await local.json() as { status?: string }).status !== "online") return;
        const response = await fetch(`${localRunnerUrl}/updates`, { cache: "no-store" });
        if (!response.ok) return;
        const status = await response.json() as RunnerUpdateStatus;
        if (status.available && notifiedRunnerVersion.current !== status.latestVersion && !isDisposed) {
          notifiedRunnerVersion.current = status.latestVersion;
          toast({ body: "A runner update is available.", isAutoHide: false, uniqueID: "runner-update",
            collisionBehavior: "overwrite", endContent: <Button label="View" href="/devices" size="sm" variant="secondary" /> });
        }
      } catch { /* A runner notification appears after the local bridge becomes reachable. */ }
    };
    const onFocus = () => void check();
    const onVisibilityChange = () => { if (document.visibilityState === "visible") void check(); };
    void check();
    const timer = window.setInterval(() => void check(), 30_000);
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      isDisposed = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [toast]);

  return null;
}
