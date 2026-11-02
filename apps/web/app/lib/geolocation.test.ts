import { afterEach, describe, expect, it, vi } from "vitest";
import { accuracyRing, requestPosition } from "./geolocation";

const original = navigator.geolocation;
afterEach(() => {
  Object.defineProperty(navigator, "geolocation", { configurable: true, value: original });
});

const stub = (implementation: Partial<Geolocation>) =>
  Object.defineProperty(navigator, "geolocation", { configurable: true, value: implementation });

describe("requestPosition", () => {
  it("asks once with a 10-second standard-accuracy request", async () => {
    const getCurrentPosition = vi.fn(
      (
        success: PositionCallback,
        _failure?: PositionErrorCallback | null,
        _options?: PositionOptions,
      ) =>
        success({
          coords: { accuracy: 42.4, latitude: 59.31, longitude: 18.06 },
        } as GeolocationPosition),
    );
    stub({ getCurrentPosition } as never);
    expect(await requestPosition()).toEqual({ accuracy: 42, kind: "ok", point: [18.06, 59.31] });
    expect(getCurrentPosition.mock.calls[0]?.[2]).toMatchObject({
      enableHighAccuracy: false,
      timeout: 10_000,
    });
  });

  it("maps denied, timeout and unavailable errors", async () => {
    for (const [code, kind] of [
      [1, "denied"],
      [3, "timeout"],
      [2, "unavailable"],
    ] as const) {
      stub({
        getCurrentPosition: (_: PositionCallback, failure?: PositionErrorCallback | null) =>
          failure?.({
            code,
            PERMISSION_DENIED: 1,
            POSITION_UNAVAILABLE: 2,
            TIMEOUT: 3,
          } as GeolocationPositionError),
      } as never);
      expect(await requestPosition()).toEqual({ kind });
    }
    stub(undefined as never);
    expect(await requestPosition()).toEqual({ kind: "unsupported" });
  });
});

describe("accuracyRing", () => {
  it("closes a ring whose points lie at the accuracy radius", () => {
    const point = [18.07, 59.31] as const;
    const ring = accuracyRing(point, 50);
    expect(ring[0]).toEqual(ring.at(-1));
    for (const [lng, lat] of ring) {
      const dy = (lat - point[1]) * 111_320;
      const dx = (lng - point[0]) * 111_320 * Math.cos((point[1] * Math.PI) / 180);
      expect(Math.hypot(dx, dy)).toBeCloseTo(50, 3);
    }
  });
});
