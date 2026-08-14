import { describe, it, expect } from "vitest";

import {
  detectOrderIssues,
  hoursInStage,
  matchesSearch,
  nextTransportStatus,
  orderReference,
  osloDateIso,
  resolveTrackingUrl,
  stageEnteredAt,
  stageForTransportStatus,
  type LogisticsOrder,
} from "@/lib/shop-order-logistics";
import { parseByggmakkerEventType } from "@/lib/shop-order-logistics-admin";

const NOW = new Date("2026-08-14T12:00:00.000Z");

function makeOrder(overrides: Partial<LogisticsOrder> = {}): LogisticsOrder {
  return {
    id: "3f6b1c2d-0000-4000-8000-000000000001",
    slug: "ordre-20260814-3f6b1c2d",
    public_token: "8b0a1e77-1111-4111-8111-111111111111",
    status: "paid",
    transport_status: "pending",
    carrier: null,
    carrier_code: null,
    tracking_number: null,
    tracking_url: null,
    estimated_delivery_date: null,
    customer_name: "Anders Christensen",
    customer_email: "anders@example.no",
    customer_phone: "90077027",
    shipping_address_line1: "Golmvegen 334",
    shipping_postal_code: "6590",
    shipping_city: "TUSTNA",
    customer_note: "",
    internal_note: "",
    last_status_note: "",
    total_nok: 11400,
    created_at: "2026-08-14T10:00:00.000Z",
    paid_at: "2026-08-14T10:05:00.000Z",
    confirmed_at: null,
    packed_at: null,
    shipped_at: null,
    delivered_at: null,
    ...overrides,
  };
}

describe("resolveTrackingUrl", () => {
  it("builds a carrier tracking URL from the tracking number", () => {
    expect(
      resolveTrackingUrl({ carrierCode: "bring", trackingNumber: "TESTPKG123", trackingUrl: null }),
    ).toBe("https://sporing.bring.no/sporing/TESTPKG123");
  });

  it("lets a manually entered URL override the generated one", () => {
    expect(
      resolveTrackingUrl({
        carrierCode: "bring",
        trackingNumber: "TESTPKG123",
        trackingUrl: "https://egen-sporing.no/abc",
      }),
    ).toBe("https://egen-sporing.no/abc");
  });

  it("ignores a manual value that is not a real URL", () => {
    expect(
      resolveTrackingUrl({ carrierCode: "posten", trackingNumber: "X1", trackingUrl: "kommer senere" }),
    ).toBe("https://sporing.posten.no/sporing/X1");
  });

  it("returns null for carriers without public tracking", () => {
    expect(
      resolveTrackingUrl({ carrierCode: "egen_bil", trackingNumber: "123", trackingUrl: null }),
    ).toBeNull();
  });

  it("returns null when there is no tracking number", () => {
    expect(resolveTrackingUrl({ carrierCode: "bring", trackingNumber: "  ", trackingUrl: null })).toBeNull();
  });

  it("escapes tracking numbers so they cannot break out of the URL", () => {
    expect(
      resolveTrackingUrl({ carrierCode: "bring", trackingNumber: "a b&c", trackingUrl: null }),
    ).toBe("https://sporing.bring.no/sporing/a%20b%26c");
  });
});

describe("nextTransportStatus", () => {
  it("walks the full flow from pending to delivered", () => {
    expect(nextTransportStatus("pending")).toBe("confirmed");
    expect(nextTransportStatus("confirmed")).toBe("packing");
    expect(nextTransportStatus("packing")).toBe("shipped");
    expect(nextTransportStatus("shipped")).toBe("delivered");
    expect(nextTransportStatus("out_for_delivery")).toBe("delivered");
  });

  it("stops at delivered and cancelled", () => {
    expect(nextTransportStatus("delivered")).toBeNull();
    expect(nextTransportStatus("cancelled")).toBeNull();
  });
});

describe("stageEnteredAt", () => {
  it("uses the timestamp of the current stage", () => {
    const order = makeOrder({
      transport_status: "packing",
      confirmed_at: "2026-08-14T10:30:00.000Z",
      packed_at: "2026-08-14T11:00:00.000Z",
    });
    expect(stageEnteredAt(order)).toBe("2026-08-14T11:00:00.000Z");
  });

  it("falls back to the previous milestone when the stage timestamp is missing", () => {
    const order = makeOrder({ transport_status: "packing", confirmed_at: "2026-08-14T10:30:00.000Z" });
    expect(stageEnteredAt(order)).toBe("2026-08-14T10:30:00.000Z");
  });

  it("measures unconfirmed orders from when they were paid", () => {
    const order = makeOrder({ transport_status: "pending" });
    expect(stageEnteredAt(order)).toBe("2026-08-14T10:05:00.000Z");
    expect(hoursInStage(order, NOW)).toBeCloseTo(1.9167, 3);
  });
});

describe("detectOrderIssues", () => {
  it("flags a paid order the supplier never received", () => {
    const issues = detectOrderIssues(makeOrder(), { byggmakkerState: "none", now: NOW });
    expect(issues.map((issue) => issue.code)).toContain("supplier_not_ordered");
    expect(issues[0].severity).toBe("high");
  });

  it("does not flag the supplier once the order email was sent", () => {
    const issues = detectOrderIssues(makeOrder(), { byggmakkerState: "sent", now: NOW });
    expect(issues.map((issue) => issue.code)).not.toContain("supplier_not_ordered");
  });

  it("flags a shipped order without a tracking number", () => {
    const order = makeOrder({
      transport_status: "shipped",
      shipped_at: "2026-08-14T11:00:00.000Z",
    });
    const issues = detectOrderIssues(order, { byggmakkerState: "sent", now: NOW });
    expect(issues.map((issue) => issue.code)).toContain("missing_tracking");
  });

  it("does not flag a shipped order that has tracking", () => {
    const order = makeOrder({
      transport_status: "shipped",
      shipped_at: "2026-08-14T11:00:00.000Z",
      tracking_number: "TESTPKG123",
    });
    const issues = detectOrderIssues(order, { byggmakkerState: "sent", now: NOW });
    expect(issues.map((issue) => issue.code)).not.toContain("missing_tracking");
  });

  it("flags an order past its promised delivery date", () => {
    const order = makeOrder({
      transport_status: "shipped",
      shipped_at: "2026-08-10T08:00:00.000Z",
      tracking_number: "TESTPKG123",
      estimated_delivery_date: "2026-08-12",
    });
    const issues = detectOrderIssues(order, { byggmakkerState: "sent", now: NOW });
    expect(issues.map((issue) => issue.code)).toContain("eta_passed");
  });

  it("does not flag a delivery date still in the future", () => {
    const order = makeOrder({
      transport_status: "shipped",
      shipped_at: "2026-08-14T09:00:00.000Z",
      tracking_number: "TESTPKG123",
      estimated_delivery_date: "2026-08-20",
    });
    const issues = detectOrderIssues(order, { byggmakkerState: "sent", now: NOW });
    expect(issues.map((issue) => issue.code)).not.toContain("eta_passed");
  });

  it("flags an order sitting too long in its stage", () => {
    // Ubekreftet i 12 timer — SLA for steget er 4 timer.
    const order = makeOrder({ paid_at: "2026-08-14T00:00:00.000Z" });
    const issues = detectOrderIssues(order, { byggmakkerState: "sent", now: NOW });
    expect(issues.map((issue) => issue.code)).toContain("stage_overdue");
  });

  it("does not apply transport SLA to unpaid orders", () => {
    const order = makeOrder({
      status: "pending_payment",
      paid_at: null,
      created_at: "2026-08-14T11:00:00.000Z",
    });
    const issues = detectOrderIssues(order, { byggmakkerState: "none", now: NOW });
    expect(issues).toHaveLength(0);
  });

  it("flags a checkout that was never paid after a day", () => {
    const order = makeOrder({
      status: "pending_payment",
      paid_at: null,
      created_at: "2026-08-12T11:00:00.000Z",
    });
    const issues = detectOrderIssues(order, { byggmakkerState: "none", now: NOW });
    expect(issues.map((issue) => issue.code)).toEqual(["abandoned_checkout"]);
  });

  it("reports no issues for cancelled orders", () => {
    const order = makeOrder({ status: "cancelled", transport_status: "cancelled" });
    expect(detectOrderIssues(order, { byggmakkerState: "none", now: NOW })).toHaveLength(0);
  });

  it("sorts the most severe issue first", () => {
    const order = makeOrder({
      transport_status: "shipped",
      shipped_at: "2026-08-01T08:00:00.000Z",
      estimated_delivery_date: "2026-08-05",
    });
    const issues = detectOrderIssues(order, { byggmakkerState: "failed", now: NOW });
    expect(issues.length).toBeGreaterThan(1);
    expect(issues[0].severity).toBe("high");
  });
});

describe("stageForTransportStatus", () => {
  it("groups shipped and out_for_delivery into the transit stage", () => {
    expect(stageForTransportStatus("shipped")?.id).toBe("transit");
    expect(stageForTransportStatus("out_for_delivery")?.id).toBe("transit");
  });

  it("has no stage for cancelled orders", () => {
    expect(stageForTransportStatus("cancelled")).toBeNull();
  });
});

describe("matchesSearch", () => {
  const order = makeOrder({ tracking_number: "TESTPKG123" });

  it("matches on customer name regardless of case", () => {
    expect(matchesSearch(order, "anders")).toBe(true);
  });

  it("matches on order slug, city and tracking number", () => {
    expect(matchesSearch(order, "ordre-20260814")).toBe(true);
    expect(matchesSearch(order, "tustna")).toBe(true);
    expect(matchesSearch(order, "TESTPKG")).toBe(true);
  });

  it("returns false for a miss and true for an empty query", () => {
    expect(matchesSearch(order, "bergen")).toBe(false);
    expect(matchesSearch(order, "   ")).toBe(true);
  });
});

describe("osloDateIso", () => {
  it("uses Norwegian local time, not UTC", () => {
    // 22:30 UTC er 00:30 neste dag i norsk sommertid.
    expect(osloDateIso(new Date("2026-08-14T22:30:00.000Z"))).toBe("2026-08-15");
  });
});

describe("orderReference", () => {
  it("prefers the slug and falls back to a short id", () => {
    expect(orderReference({ id: "abc", slug: "ordre-1" })).toBe("ordre-1");
    expect(orderReference({ id: "3f6b1c2d-0000-4000-8000-000000000001", slug: null })).toBe("#3F6B1C2D");
  });
});

describe("parseByggmakkerEventType", () => {
  it("maps event types to supplier states", () => {
    expect(parseByggmakkerEventType("byggmakker_order_email_sent")).toBe("sent");
    expect(parseByggmakkerEventType("byggmakker_order_email_failed")).toBe("failed");
    expect(parseByggmakkerEventType("byggmakker_order_email_skipped")).toBe("skipped");
    expect(parseByggmakkerEventType("noe_annet")).toBe("none");
  });
});
