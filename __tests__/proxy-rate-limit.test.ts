import { describe, it, expect, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Tests for the rate-limiting logic in proxy.ts.
// We import the exported `checkRateLimit` helper directly.
// ---------------------------------------------------------------------------

// Clear the module cache between tests so each test gets a fresh Map state.
// Since the rateLimitStore is module-level, we reload the module via vi.isolateModules
// or simply reset via the exported helper between tests.

import { checkRateLimit } from "@/proxy";

describe("checkRateLimit", () => {
  // Use unique IP strings per test to avoid cross-test interference.

  it("allows requests below the limit within the window", () => {
    const ip = "test-ip-1";
    const now = Date.now();

    // 9 requests should all be allowed (limit is 10)
    for (let i = 0; i < 9; i++) {
      expect(checkRateLimit(ip, now + i)).toBe(false);
    }
  });

  it("blocks the request that exceeds the limit", () => {
    const ip = "test-ip-2";
    const now = Date.now();

    for (let i = 0; i < 10; i++) {
      checkRateLimit(ip, now + i);
    }

    // The 11th request should be blocked
    expect(checkRateLimit(ip, now + 10)).toBe(true);
  });

  it("allows requests after the sliding window has passed", () => {
    const ip = "test-ip-3";
    const now = Date.now();

    // Exhaust the limit
    for (let i = 0; i < 10; i++) {
      checkRateLimit(ip, now + i);
    }
    expect(checkRateLimit(ip, now + 10)).toBe(true); // blocked

    // Advance time past the 60-second window
    const laterNow = now + 61_000;
    expect(checkRateLimit(ip, laterNow)).toBe(false); // allowed again
  });

  it("different IPs have independent rate limit buckets", () => {
    const now = Date.now();
    const ip1 = "test-ip-4a";
    const ip2 = "test-ip-4b";

    // Exhaust ip1
    for (let i = 0; i < 10; i++) {
      checkRateLimit(ip1, now + i);
    }
    expect(checkRateLimit(ip1, now + 10)).toBe(true); // blocked

    // ip2 should still be allowed
    expect(checkRateLimit(ip2, now + 10)).toBe(false);
  });

  it("returns false (allowed) for an unknown IP on first request", () => {
    expect(checkRateLimit("brand-new-ip-xyz", Date.now())).toBe(false);
  });
});
