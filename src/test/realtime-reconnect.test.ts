import { describe, expect, it } from "vitest";
import { getRealtimeReconnectDelay } from "@/lib/realtime-reconnect";

describe("Neon Realtime reconnect backoff", () => {
  it("starts quickly and doubles the delay after each consecutive failure", () => {
    expect([0, 1, 2, 3, 4, 5].map(getRealtimeReconnectDelay)).toEqual([
      1_000, 2_000, 4_000, 8_000, 16_000, 30_000,
    ]);
  });

  it("caps repeated failures at 30 seconds", () => {
    expect(getRealtimeReconnectDelay(6)).toBe(30_000);
    expect(getRealtimeReconnectDelay(100)).toBe(30_000);
  });

  it("handles negative, fractional, and non-finite attempts safely", () => {
    expect(getRealtimeReconnectDelay(-4)).toBe(1_000);
    expect(getRealtimeReconnectDelay(2.9)).toBe(4_000);
    expect(getRealtimeReconnectDelay(Number.NaN)).toBe(1_000);
    expect(getRealtimeReconnectDelay(Number.POSITIVE_INFINITY)).toBe(1_000);
  });
});
