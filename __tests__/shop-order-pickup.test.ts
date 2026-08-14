import { describe, expect, it } from "vitest";

import { normalizeShopOrderFulfillment } from "@/lib/shop-order";

describe("shop order fulfillment metadata", () => {
  it("persists pickup store info without a delivery address", () => {
    const normalized = normalizeShopOrderFulfillment({
      deliveryMode: "pickup",
      addressLine1: "Storgata 1",
      postalCode: "0123",
      city: "Oslo",
      pickupStoreId: "store-1",
      pickupStoreName: "Oslo",
    });

    expect(normalized.delivery_mode).toBe("pickup");
    expect(normalized.shipping_address_line1).toBeNull();
    expect(normalized.shipping_postal_code).toBeNull();
    expect(normalized.shipping_city).toBeNull();
    expect(normalized.pickup_store_id).toBe("store-1");
    expect(normalized.pickup_store_name).toBe("Oslo");
  });

  it("stores delivery address data for home delivery orders", () => {
    const normalized = normalizeShopOrderFulfillment({
      deliveryMode: "delivery",
      addressLine1: "Storgata 1",
      postalCode: "0123",
      city: "Oslo",
      pickupStoreId: "store-1",
      pickupStoreName: "Oslo",
    });

    expect(normalized.delivery_mode).toBe("delivery");
    expect(normalized.shipping_address_line1).toBe("Storgata 1");
    expect(normalized.shipping_postal_code).toBe("0123");
    expect(normalized.shipping_city).toBe("Oslo");
    expect(normalized.pickup_store_id).toBeNull();
    expect(normalized.pickup_store_name).toBeNull();
  });
});
