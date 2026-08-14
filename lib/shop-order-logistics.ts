import {
  SHOP_ORDER_TRANSPORT_LABELS,
  type ShopOrderStatus,
  type ShopOrderTransportStatus,
} from "@/lib/shop-order";

/* ── Transportører ──────────────────────────────────────────────────────── */

export type CarrierPreset = {
  code: string;
  label: string;
  /** Bygger en offentlig sporingslenke. null = transportøren har ingen sporing. */
  trackingUrl: ((trackingNumber: string) => string) | null;
};

/**
 * Best-effort offentlige sporingslenker. Admin kan alltid overstyre med en
 * manuell lenke i skjemaet, så en utdatert URL her er ikke kritisk.
 */
export const CARRIERS: CarrierPreset[] = [
  {
    code: "bring",
    label: "Bring",
    trackingUrl: (n) => `https://sporing.bring.no/sporing/${encodeURIComponent(n)}`,
  },
  {
    code: "posten",
    label: "Posten",
    trackingUrl: (n) => `https://sporing.posten.no/sporing/${encodeURIComponent(n)}`,
  },
  {
    code: "postnord",
    label: "PostNord",
    trackingUrl: (n) => `https://tracking.postnord.com/no/?id=${encodeURIComponent(n)}`,
  },
  {
    code: "schenker",
    label: "DB Schenker",
    trackingUrl: (n) => `https://www.dbschenker.com/app/tracking-public/?refNumber=${encodeURIComponent(n)}`,
  },
  {
    code: "dhl",
    label: "DHL",
    trackingUrl: (n) => `https://www.dhl.com/no-no/home/tracking.html?tracking-id=${encodeURIComponent(n)}`,
  },
  { code: "byggmakker", label: "Byggmakker-transport", trackingUrl: null },
  { code: "egen_bil", label: "Egen bil", trackingUrl: null },
  { code: "henting", label: "Hentes av kunde", trackingUrl: null },
  { code: "annen", label: "Annen transportør", trackingUrl: null },
];

const CARRIER_BY_CODE = new Map(CARRIERS.map((carrier) => [carrier.code, carrier]));

export function getCarrier(code: string | null | undefined): CarrierPreset | null {
  if (!code) return null;
  return CARRIER_BY_CODE.get(code) ?? null;
}

export function carrierLabel(code: string | null | undefined, fallback: string | null | undefined) {
  return getCarrier(code)?.label ?? (fallback?.trim() || null);
}

/**
 * Sporingslenke for en ordre. En manuelt satt lenke vinner alltid over
 * den automatisk genererte, slik at admin kan lime inn en direktelenke.
 */
export function resolveTrackingUrl(input: {
  carrierCode: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
}): string | null {
  const manual = input.trackingUrl?.trim();
  if (manual && /^https?:\/\//i.test(manual)) return manual;

  const number = input.trackingNumber?.trim();
  if (!number) return null;

  const carrier = getCarrier(input.carrierCode);
  return carrier?.trackingUrl ? carrier.trackingUrl(number) : null;
}

/* ── Stegene i arbeidsflyten ────────────────────────────────────────────── */

export type LogisticsStageId = "ubekreftet" | "klargjoring" | "pakking" | "transit" | "levert";

export type LogisticsStage = {
  id: LogisticsStageId;
  label: string;
  description: string;
  /** Transportstatuser som havner i dette steget. */
  statuses: ShopOrderTransportStatus[];
  /** Statusen «neste steg»-knappen setter. null for siste steg. */
  nextStatus: ShopOrderTransportStatus | null;
  /** Tekst på hurtigknappen. */
  actionLabel: string | null;
  /** Timer i steget før ordren regnes som forsinket. */
  slaHours: number;
  accent: string;
};

export const LOGISTICS_STAGES: LogisticsStage[] = [
  {
    id: "ubekreftet",
    label: "Må bekreftes",
    description: "Betalt, men ikke bekreftet mot leverandør.",
    statuses: ["pending"],
    nextStatus: "confirmed",
    actionLabel: "Bekreft ordre",
    slaHours: 4,
    accent: "amber",
  },
  {
    id: "klargjoring",
    label: "Klar for plukk",
    description: "Bekreftet og venter på plukking.",
    statuses: ["confirmed"],
    nextStatus: "packing",
    actionLabel: "Start plukking",
    slaHours: 24,
    accent: "blue",
  },
  {
    id: "pakking",
    label: "Plukkes og pakkes",
    description: "Under plukking. Legg inn transportør og sporing før utsending.",
    statuses: ["packing"],
    nextStatus: "shipped",
    actionLabel: "Marker som sendt",
    slaHours: 24,
    accent: "violet",
  },
  {
    id: "transit",
    label: "I transit",
    description: "På vei til kunde.",
    statuses: ["shipped", "out_for_delivery"],
    nextStatus: "delivered",
    actionLabel: "Marker som levert",
    slaHours: 72,
    accent: "cyan",
  },
  {
    id: "levert",
    label: "Levert",
    description: "Fullført leveranse.",
    statuses: ["delivered"],
    nextStatus: null,
    actionLabel: null,
    slaHours: Number.POSITIVE_INFINITY,
    accent: "emerald",
  },
];

const STAGE_BY_STATUS = new Map<ShopOrderTransportStatus, LogisticsStage>();
for (const stage of LOGISTICS_STAGES) {
  for (const status of stage.statuses) {
    STAGE_BY_STATUS.set(status, stage);
  }
}

export function stageForTransportStatus(status: ShopOrderTransportStatus): LogisticsStage | null {
  return STAGE_BY_STATUS.get(status) ?? null;
}

export function stageById(id: string): LogisticsStage | null {
  return LOGISTICS_STAGES.find((stage) => stage.id === id) ?? null;
}

/** Neste transportstatus i flyten, eller null hvis ordren er ferdig/kansellert. */
export function nextTransportStatus(status: ShopOrderTransportStatus): ShopOrderTransportStatus | null {
  return stageForTransportStatus(status)?.nextStatus ?? null;
}

/* ── Ordre i logistikkøen ───────────────────────────────────────────────── */

export type LogisticsOrder = {
  id: string;
  slug: string | null;
  public_token: string;
  status: ShopOrderStatus;
  transport_status: ShopOrderTransportStatus;
  carrier: string | null;
  carrier_code: string | null;
  tracking_number: string | null;
  tracking_url: string | null;
  estimated_delivery_date: string | null;
  customer_name: string;
  customer_email: string;
  customer_phone: string | null;
  shipping_address_line1: string | null;
  shipping_postal_code: string | null;
  shipping_city: string | null;
  pickup_store_id: string | null;
  pickup_store_name: string | null;
  customer_note: string;
  internal_note: string;
  last_status_note: string;
  total_nok: number;
  created_at: string;
  paid_at: string | null;
  confirmed_at: string | null;
  packed_at: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
};

/** Når ordren gikk inn i sitt nåværende steg — grunnlaget for køalder og SLA. */
export function stageEnteredAt(order: LogisticsOrder): string | null {
  switch (order.transport_status) {
    case "pending":
      return order.paid_at ?? order.created_at;
    case "confirmed":
      return order.confirmed_at ?? order.paid_at ?? order.created_at;
    case "packing":
      return order.packed_at ?? order.confirmed_at ?? order.paid_at ?? order.created_at;
    case "shipped":
    case "out_for_delivery":
      return order.shipped_at ?? order.packed_at ?? order.paid_at ?? order.created_at;
    case "delivered":
      return order.delivered_at ?? order.shipped_at ?? order.created_at;
    default:
      return order.created_at;
  }
}

export function hoursSince(iso: string | null, now: Date): number | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return null;
  return (now.getTime() - then) / 3_600_000;
}

export function hoursInStage(order: LogisticsOrder, now: Date): number | null {
  return hoursSince(stageEnteredAt(order), now);
}

/** Dagens dato i norsk tid som YYYY-MM-DD, for sammenligning med `date`-kolonner. */
export function osloDateIso(now: Date): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Oslo" }).format(now);
}

/* ── Avvik ──────────────────────────────────────────────────────────────── */

export type ByggmakkerState = "sent" | "failed" | "skipped" | "none";

export type OrderIssueCode =
  | "payment_failed"
  | "supplier_not_ordered"
  | "eta_passed"
  | "missing_tracking"
  | "stage_overdue"
  | "abandoned_checkout";

export type OrderIssue = {
  code: OrderIssueCode;
  severity: "high" | "medium" | "low";
  label: string;
  detail: string;
};

const ABANDONED_CHECKOUT_HOURS = 24;

/**
 * Alt som krever menneskelig oppfølging på én ordre. Rekkefølgen er
 * alvorlighetsgrad-sortert, så første element er det mest akutte.
 */
export function detectOrderIssues(
  order: LogisticsOrder,
  options: { byggmakkerState: ByggmakkerState; now: Date },
): OrderIssue[] {
  const { byggmakkerState, now } = options;
  const issues: OrderIssue[] = [];

  if (order.status === "cancelled") return issues;

  if (order.status === "failed") {
    issues.push({
      code: "payment_failed",
      severity: "high",
      label: "Betaling feilet",
      detail: "Stripe rapporterte at betalingen ikke gikk gjennom.",
    });
  }

  if (order.status === "pending_payment") {
    const age = hoursSince(order.created_at, now);
    if (age != null && age > ABANDONED_CHECKOUT_HOURS) {
      issues.push({
        code: "abandoned_checkout",
        severity: "low",
        label: "Betaling aldri fullført",
        detail: `Ordren ble opprettet for ${formatHours(age)} siden og er fortsatt ubetalt.`,
      });
    }
    // En ubetalt ordre skal ikke måles mot transport-SLA.
    return issues;
  }

  const isPaid = order.status === "paid" || order.status === "fulfilled";

  if (isPaid && byggmakkerState !== "sent") {
    issues.push({
      code: "supplier_not_ordered",
      severity: "high",
      label:
        byggmakkerState === "failed"
          ? "Bestilling til Byggmakker feilet"
          : byggmakkerState === "skipped"
            ? "Bestilling til Byggmakker hoppet over"
            : "Ikke bestilt hos Byggmakker",
      detail: "Kunden har betalt, men leverandøren har ikke fått bestillingen.",
    });
  }

  if (order.transport_status === "cancelled") return issues;

  if (order.estimated_delivery_date && order.transport_status !== "delivered") {
    if (order.estimated_delivery_date < osloDateIso(now)) {
      issues.push({
        code: "eta_passed",
        severity: "high",
        label: "Forbi estimert levering",
        detail: `Lovet levering ${formatDateNo(order.estimated_delivery_date)}, men ordren er ikke levert.`,
      });
    }
  }

  if (
    (order.transport_status === "shipped" || order.transport_status === "out_for_delivery") &&
    !order.tracking_number?.trim()
  ) {
    issues.push({
      code: "missing_tracking",
      severity: "medium",
      label: "Mangler sporing",
      detail: "Ordren er sendt, men kunden har ingen sporingsnummer å følge.",
    });
  }

  const stage = stageForTransportStatus(order.transport_status);
  if (stage && Number.isFinite(stage.slaHours)) {
    const hours = hoursInStage(order, now);
    if (hours != null && hours > stage.slaHours) {
      issues.push({
        code: "stage_overdue",
        severity: "medium",
        label: `Står for lenge i «${stage.label}»`,
        detail: `${formatHours(hours)} i steget — grensen er ${stage.slaHours} timer.`,
      });
    }
  }

  return issues.sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
}

function severityRank(severity: OrderIssue["severity"]) {
  return severity === "high" ? 2 : severity === "medium" ? 1 : 0;
}

/* ── Formattering ───────────────────────────────────────────────────────── */

export function formatHours(hours: number): string {
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`;
  if (hours < 48) return `${Math.round(hours)} t`;
  return `${Math.round(hours / 24)} dager`;
}

export function formatDateNo(value: string): string {
  const date = new Date(value.length === 10 ? `${value}T12:00:00Z` : value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("nb-NO", { day: "2-digit", month: "short", year: "numeric" });
}

export function formatDateTimeNo(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("nb-NO", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function orderReference(order: Pick<LogisticsOrder, "id" | "slug">): string {
  return order.slug ?? `#${order.id.slice(0, 8).toUpperCase()}`;
}

export function transportLabel(status: ShopOrderTransportStatus): string {
  return SHOP_ORDER_TRANSPORT_LABELS[status] ?? status;
}

/* ── Søk ────────────────────────────────────────────────────────────────── */

/** Fritekstsøk over de feltene en admin faktisk søker på ved telefonhenvendelser. */
export function matchesSearch(order: LogisticsOrder, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;

  return [
    order.slug,
    order.id,
    order.customer_name,
    order.customer_email,
    order.customer_phone,
    order.shipping_city,
    order.shipping_postal_code,
    order.shipping_address_line1,
    order.pickup_store_name,
    order.pickup_store_id,
    order.tracking_number,
  ]
    .filter((value): value is string => Boolean(value))
    .some((value) => value.toLowerCase().includes(q));
}
