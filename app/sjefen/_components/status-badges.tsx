import {
  SHOP_ORDER_TRANSPORT_LABELS,
  type ShopOrderTransportStatus,
} from "@/lib/shop-order";

import { Badge, type BadgeTone } from "./ui";

/**
 * Én kilde til hvordan statuser ser ut i hele adminpanelet. Tidligere hadde
 * Dashboard, Bestillinger og Økonomi hver sin lokale kopi som drev fra hverandre.
 */

const ORDER_STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  draft: { label: "Utkast", tone: "neutral" },
  pending_payment: { label: "Venter betaling", tone: "warn" },
  paid: { label: "Betalt", tone: "info" },
  submitted: { label: "Sendt leverandør", tone: "accent" },
  fulfilled: { label: "Fullført", tone: "good" },
  cancelled: { label: "Kansellert", tone: "neutral" },
  failed: { label: "Feilet", tone: "danger" },
};

const PARTNER_STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  pending: { label: "Ny", tone: "warn" },
  processing: { label: "Behandles", tone: "info" },
  out_for_delivery: { label: "Kjørt ut", tone: "accent" },
  delivered: { label: "Levert", tone: "good" },
  cancelled: { label: "Kansellert", tone: "neutral" },
};

const TRANSPORT_TONE: Record<ShopOrderTransportStatus, BadgeTone> = {
  pending: "warn",
  confirmed: "info",
  packing: "info",
  shipped: "accent",
  out_for_delivery: "accent",
  delivered: "good",
  cancelled: "neutral",
};

export function OrderStatusBadge({ status }: { status: string }) {
  const config = ORDER_STATUS[status] ?? { label: status, tone: "neutral" as BadgeTone };
  return <Badge tone={config.tone}>{config.label}</Badge>;
}

export function PartnerStatusBadge({ status }: { status: string }) {
  const config = PARTNER_STATUS[status] ?? { label: status, tone: "neutral" as BadgeTone };
  return <Badge tone={config.tone}>{config.label}</Badge>;
}

export function TransportBadge({ status }: { status: string }) {
  const known = status in SHOP_ORDER_TRANSPORT_LABELS ? (status as ShopOrderTransportStatus) : null;
  if (!known) return <Badge tone="neutral">{status}</Badge>;
  return <Badge tone={TRANSPORT_TONE[known]}>{SHOP_ORDER_TRANSPORT_LABELS[known]}</Badge>;
}

export function orderStatusLabel(status: string): string {
  return ORDER_STATUS[status]?.label ?? status;
}
