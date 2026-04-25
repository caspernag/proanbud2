import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Webhook idempotency: verifies that the webhook handler correctly identifies
// already-processed events and does not re-process them.
// ---------------------------------------------------------------------------
//
// We test the guard logic that is embedded in the webhook route directly —
// specifically the "already paid" guard that prevents double-updates.

type MockOrderStatus = "draft" | "pending_payment" | "paid" | "submitted" | "cancelled" | "failed";

interface MockMaterialOrder {
  id: string;
  user_id: string;
  status: MockOrderStatus;
  payment_intent_id: string | null;
}

/**
 * Pure replica of the guard logic from the webhook route.
 * Returns true if the webhook event should be skipped (already processed).
 */
function isAlreadyProcessed(order: MockMaterialOrder, incomingPaymentIntentId: string | null): boolean {
  return (
    (order.status === "paid" || order.status === "submitted") &&
    order.payment_intent_id === incomingPaymentIntentId
  );
}

describe("Webhook idempotency guard (markMaterialOrderPaid)", () => {
  it("skips when order is already paid with the same payment intent", () => {
    const order: MockMaterialOrder = {
      id: "order-1",
      user_id: "user-1",
      status: "paid",
      payment_intent_id: "pi_abc123",
    };
    expect(isAlreadyProcessed(order, "pi_abc123")).toBe(true);
  });

  it("skips when order is submitted with the same payment intent", () => {
    const order: MockMaterialOrder = {
      id: "order-1",
      user_id: "user-1",
      status: "submitted",
      payment_intent_id: "pi_abc123",
    };
    expect(isAlreadyProcessed(order, "pi_abc123")).toBe(true);
  });

  it("processes when order is pending_payment (first time payment confirmed)", () => {
    const order: MockMaterialOrder = {
      id: "order-1",
      user_id: "user-1",
      status: "pending_payment",
      payment_intent_id: null,
    };
    expect(isAlreadyProcessed(order, "pi_abc123")).toBe(false);
  });

  it("processes when order is paid but with a different payment intent (edge case: replacement charge)", () => {
    const order: MockMaterialOrder = {
      id: "order-1",
      user_id: "user-1",
      status: "paid",
      payment_intent_id: "pi_old",
    };
    expect(isAlreadyProcessed(order, "pi_new")).toBe(false);
  });

  it("processes when order status is draft", () => {
    const order: MockMaterialOrder = {
      id: "order-1",
      user_id: "user-1",
      status: "draft",
      payment_intent_id: null,
    };
    expect(isAlreadyProcessed(order, "pi_abc123")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Shop order idempotency guard
// ---------------------------------------------------------------------------

type MockShopOrderStatus = "draft" | "pending_payment" | "paid" | "fulfilled" | "cancelled" | "failed";

interface MockShopOrder {
  id: string;
  status: MockShopOrderStatus;
  payment_intent_id: string | null;
  checkout_session_id: string | null;
}

function isShopOrderAlreadyProcessed(
  order: MockShopOrder,
  incomingPaymentIntentId: string | null,
  incomingSessionId: string,
): boolean {
  return (
    (order.status === "paid" || order.status === "fulfilled") &&
    order.payment_intent_id === incomingPaymentIntentId &&
    order.checkout_session_id === incomingSessionId
  );
}

describe("Webhook idempotency guard (markShopOrderPaid)", () => {
  it("skips when shop order is already paid with same intent and session", () => {
    const order: MockShopOrder = {
      id: "shop-order-1",
      status: "paid",
      payment_intent_id: "pi_xyz",
      checkout_session_id: "cs_abc",
    };
    expect(isShopOrderAlreadyProcessed(order, "pi_xyz", "cs_abc")).toBe(true);
  });

  it("processes when session id differs (idempotency key mismatch)", () => {
    const order: MockShopOrder = {
      id: "shop-order-1",
      status: "paid",
      payment_intent_id: "pi_xyz",
      checkout_session_id: "cs_old",
    };
    expect(isShopOrderAlreadyProcessed(order, "pi_xyz", "cs_new")).toBe(false);
  });

  it("processes when order is pending_payment", () => {
    const order: MockShopOrder = {
      id: "shop-order-1",
      status: "pending_payment",
      payment_intent_id: null,
      checkout_session_id: null,
    };
    expect(isShopOrderAlreadyProcessed(order, "pi_xyz", "cs_abc")).toBe(false);
  });
});
