import { useEffect, useState } from "react";

// Location is optional and asked for only after the visitor acts. Positions
// stay in memory: never uploaded, logged, stored or synced.
export const MAX_START_ACCURACY_METERS = 100;

export type PositionResult =
  | { readonly accuracy: number; readonly kind: "ok"; readonly point: readonly [number, number] }
  | { readonly kind: "denied" | "unavailable" | "timeout" | "unsupported" };

function fromError(error: GeolocationPositionError): PositionResult {
  if (error.code === error.PERMISSION_DENIED) return { kind: "denied" };
  if (error.code === error.TIMEOUT) return { kind: "timeout" };
  return { kind: "unavailable" };
}

/** Polygon ring approximating the accuracy radius around `point`. */
export function accuracyRing(
  point: readonly [number, number],
  meters: number,
  steps = 48,
): [number, number][] {
  const latRadius = meters / 111_320;
  const lngRadius = latRadius / Math.cos((point[1] * Math.PI) / 180);
  const ring: [number, number][] = [];
  for (let i = 0; i <= steps; i += 1) {
    const angle = (i / steps) * 2 * Math.PI;
    ring.push([point[0] + lngRadius * Math.cos(angle), point[1] + latRadius * Math.sin(angle)]);
  }
  return ring;
}

/** A recent standard-accuracy fix with a 10-second timeout. */
export function requestPosition(): Promise<PositionResult> {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return Promise.resolve({ kind: "unsupported" });
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          accuracy: Math.round(position.coords.accuracy),
          kind: "ok",
          point: [position.coords.longitude, position.coords.latitude],
        }),
      (error) => resolve(fromError(error)),
      { enableHighAccuracy: false, maximumAge: 60_000, timeout: 10_000 },
    );
  });
}

/** Permissions API improves the message only; the request decides. */
export async function locationPermissionState(): Promise<PermissionState | "unknown"> {
  try {
    const status = await navigator.permissions?.query({ name: "geolocation" });
    return status?.state ?? "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Higher-accuracy tracking while `enabled` and the page is visible; cleared
 * when hidden, disabled or unmounted.
 */
export function useWatchedPosition(enabled: boolean) {
  const [position, setPosition] = useState<PositionResult | null>(null);
  useEffect(() => {
    if (!enabled || typeof navigator === "undefined" || !navigator.geolocation) {
      setPosition(null);
      return;
    }
    let watch: number | null = null;
    const start = () => {
      if (watch !== null || document.visibilityState !== "visible") return;
      watch = navigator.geolocation.watchPosition(
        (next) =>
          setPosition({
            accuracy: Math.round(next.coords.accuracy),
            kind: "ok",
            point: [next.coords.longitude, next.coords.latitude],
          }),
        (error) => setPosition(fromError(error)),
        { enableHighAccuracy: true, maximumAge: 5_000, timeout: 20_000 },
      );
    };
    const stop = () => {
      if (watch !== null) navigator.geolocation.clearWatch(watch);
      watch = null;
    };
    const onVisibility = () => (document.visibilityState === "visible" ? start() : stop());
    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
      setPosition(null);
    };
  }, [enabled]);
  return position;
}
