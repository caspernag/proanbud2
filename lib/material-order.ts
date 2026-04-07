import { getPriceListProducts, type PriceListProduct } from "@/lib/price-lists";
import { applyMarkupForSupplierKey, getSupplierMarkups } from "@/lib/price-markup";
import type { MaterialSection } from "@/lib/project-data";

export type SupplierKey = "byggmakker" | "monter_optimera" | "byggmax" | "xl_bygg";
export type OrderDeliveryMode = "delivery" | "pickup";
export type MaterialOrderCustomerType = "private" | "business";
export type MaterialOrderCheckoutFlow = "pay_now" | "klarna" | "business_invoice" | "financing";
export type MaterialOrderStatus =
  | "draft"
  | "pending_payment"
  | "paid"
  | "submitted"
  | "cancelled"
  | "failed";

export type MaterialOrderSupplier = {
  key: SupplierKey;
  label: string;
  leadTimeBusinessDays: {
    min: number;
    max: number;
  };
  researchNote: string;
};

export const MATERIAL_ORDER_SUPPLIERS: Record<SupplierKey, MaterialOrderSupplier> = {
  byggmakker: {
    key: "byggmakker",
    label: "Byggmakker",
    leadTimeBusinessDays: { min: 2, max: 5 },
    researchNote: "Byggmakker oppgir enkel levering på 2-5 virkedager.",
  },
  monter_optimera: {
    key: "monter_optimera",
    label: "Monter/Optimera",
    leadTimeBusinessDays: { min: 3, max: 6 },
    researchNote: "Optimera fremhever profflogistikk og byggeplassleveranser, men uten fast offentlig SLA.",
  },
  byggmax: {
    key: "byggmax",
    label: "Byggmax",
    leadTimeBusinessDays: { min: 2, max: 6 },
    researchNote: "Byggmax tilbyr hjemlevering og klikk-og-hent med lokal tilgjengelighet per varehus.",
  },
  xl_bygg: {
    key: "xl_bygg",
    label: "XL-Bygg",
    leadTimeBusinessDays: { min: 2, max: 7 },
    researchNote: "XL-Bygg tilbyr klikk-og-hent og varehusbasert tilgjengelighet.",
  },
};

export async function getAvailableMaterialOrderSupplierKeys() {
  const priceProducts = await getPriceListProducts();
  const keys = new Set<SupplierKey>();

  for (const product of priceProducts) {
    const key = inferSupplierKey(product.supplierName);

    if (key !== null) {
      keys.add(key);
    }
  }

  return Array.from(keys).sort((left, right) =>
    MATERIAL_ORDER_SUPPLIERS[left].label.localeCompare(MATERIAL_ORDER_SUPPLIERS[right].label, "nb-NO"),
  );
}

export async function getAvailableMaterialOrderSuppliers() {
  const keys = await getAvailableMaterialOrderSupplierKeys();
  return keys.map((key) => MATERIAL_ORDER_SUPPLIERS[key]);
}

export type MaterialOrderRow = {
  id: string;
  project_id: string;
  user_id: string;
  status: MaterialOrderStatus;
  currency: string;
  customer_type: MaterialOrderCustomerType;
  company_name: string | null;
  organization_number: string | null;
  delivery_mode: OrderDeliveryMode;
  desired_delivery_date: string | null;
  earliest_delivery_date: string | null;
  latest_delivery_date: string | null;
  shipping_contact_name: string | null;
  shipping_phone: string | null;
  shipping_address_line1: string | null;
  shipping_postal_code: string | null;
  shipping_city: string | null;
  delivery_instructions: string;
  express_delivery: boolean;
  carry_in_service: boolean;
  checkout_flow: MaterialOrderCheckoutFlow;
  financing_plan_months: number | null;
  contract_terms_version: string | null;
  contract_accepted_at: string | null;
  customer_note: string;
  subtotal_nok: number;
  delivery_fee_nok: number;
  vat_nok: number;
  total_nok: number;
  checkout_session_id: string | null;
  payment_intent_id: string | null;
  paid_at: string | null;
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
};

export type MaterialOrderItemRow = {
  id: string;
  order_id: string;
  user_id: string;
  section_title: string;
  product_name: string;
  quantity_value: number;
  quantity_unit: string;
  unit_price_nok: number;
  line_total_nok: number;
  supplier_key: SupplierKey;
  supplier_label: string;
  supplier_sku: string | null;
  estimated_delivery_days: number;
  estimated_delivery_date: string | null;
  note: string;
  is_included: boolean;
  position: number;
  created_at: string;
  updated_at: string;
};

export type MaterialOrderItemInput = {
  id?: string;
  sectionTitle: string;
  productName: string;
  quantityValue: number;
  quantityUnit: string;
  unitPriceNok: number;
  listPriceNok?: number | null;
  supplierKey: SupplierKey;
  supplierLabel?: string;
  supplierSku?: string | null;
  estimatedDeliveryDays?: number;
  estimatedDeliveryDate?: string | null;
  note?: string;
  isIncluded?: boolean;
  position?: number;
};

export type MaterialOrderSummary = {
  subtotalNok: number;
  deliveryFeeNok: number;
  vatNok: number;
  totalNok: number;
  earliestDeliveryDate: string | null;
  latestDeliveryDate: string | null;
};

export type MaterialOrderView = {
  id: string;
  projectId: string;
  userId: string;
  status: MaterialOrderStatus;
  currency: string;
  customerType: MaterialOrderCustomerType;
  companyName: string | null;
  organizationNumber: string | null;
  deliveryMode: OrderDeliveryMode;
  desiredDeliveryDate: string | null;
  earliestDeliveryDate: string | null;
  latestDeliveryDate: string | null;
  shippingContactName: string | null;
  shippingPhone: string | null;
  shippingAddressLine1: string | null;
  shippingPostalCode: string | null;
  shippingCity: string | null;
  deliveryInstructions: string;
  expressDelivery: boolean;
  carryInService: boolean;
  checkoutFlow: MaterialOrderCheckoutFlow;
  financingPlanMonths: number | null;
  contractTermsVersion: string | null;
  contractAcceptedAt: string | null;
  customerNote: string;
  subtotalNok: number;
  deliveryFeeNok: number;
  vatNok: number;
  totalNok: number;
  checkoutSessionId: string | null;
  paymentIntentId: string | null;
  paidAt: string | null;
  submittedAt: string | null;
  createdAt: string;
  updatedAt: string;
  items: MaterialOrderItemView[];
};

export const VAT_RATE = 0.25;

export function toVatInclusiveNok(value: number, vatRate = VAT_RATE) {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return Math.max(0, Math.round(value * (1 + vatRate)));
}

export type MaterialOrderItemView = {
  id: string;
  sectionTitle: string;
  productName: string;
  quantityValue: number;
  quantityUnit: string;
  unitPriceNok: number;
  listPriceNok: number | null;
  lineTotalNok: number;
  supplierKey: SupplierKey;
  supplierLabel: string;
  supplierSku: string | null;
  estimatedDeliveryDays: number;
  estimatedDeliveryDate: string | null;
  note: string;
  isIncluded: boolean;
  position: number;
};

export function materialOrderFromRows(order: MaterialOrderRow, items: MaterialOrderItemRow[]): MaterialOrderView {
  const mappedItems = items
    .slice()
    .sort((left, right) => left.position - right.position)
    .map((item) => ({
      id: item.id,
      sectionTitle: item.section_title,
      productName: item.product_name,
      quantityValue: item.quantity_value,
      quantityUnit: item.quantity_unit,
      unitPriceNok: item.unit_price_nok,
      listPriceNok: null,
      lineTotalNok: item.line_total_nok,
      supplierKey: item.supplier_key,
      supplierLabel: item.supplier_label,
      supplierSku: item.supplier_sku,
      estimatedDeliveryDays: item.estimated_delivery_days,
      estimatedDeliveryDate: item.estimated_delivery_date,
      note: item.note,
      isIncluded: item.is_included,
      position: item.position,
    }));

  return {
    id: order.id,
    projectId: order.project_id,
    userId: order.user_id,
    status: order.status,
    currency: order.currency,
    customerType: order.customer_type,
    companyName: order.company_name,
    organizationNumber: order.organization_number,
    deliveryMode: order.delivery_mode,
    desiredDeliveryDate: order.desired_delivery_date,
    earliestDeliveryDate: order.earliest_delivery_date,
    latestDeliveryDate: order.latest_delivery_date,
    shippingContactName: order.shipping_contact_name,
    shippingPhone: order.shipping_phone,
    shippingAddressLine1: order.shipping_address_line1,
    shippingPostalCode: order.shipping_postal_code,
    shippingCity: order.shipping_city,
    deliveryInstructions: order.delivery_instructions,
    expressDelivery: order.express_delivery,
    carryInService: order.carry_in_service,
    checkoutFlow: order.checkout_flow,
    financingPlanMonths: order.financing_plan_months,
    contractTermsVersion: order.contract_terms_version,
    contractAcceptedAt: order.contract_accepted_at,
    customerNote: order.customer_note,
    subtotalNok: order.subtotal_nok,
    deliveryFeeNok: order.delivery_fee_nok,
    vatNok: order.vat_nok,
    totalNok: order.total_nok,
    checkoutSessionId: order.checkout_session_id,
    paymentIntentId: order.payment_intent_id,
    paidAt: order.paid_at,
    submittedAt: order.submitted_at,
    createdAt: order.created_at,
    updatedAt: order.updated_at,
    items: mappedItems,
  };
}

export async function buildSuggestedOrderItems(sections: MaterialSection[]) {
  const priceProducts = await getPriceListProducts();
  const supplierMarkups = await getSupplierMarkups();
  const availableSupplierKeys = Array.from(
    new Set(
      priceProducts
        .map((product) => inferSupplierKey(product.supplierName))
        .filter((key): key is SupplierKey => key !== null),
    ),
  );

  return sections.flatMap((section, sectionIndex) => {
    return section.items.map((item, itemIndex) => {
      const match = findBestPriceMatch(item.item, item.note, priceProducts);
      const defaultSupplierKey = inferSupplierKey(match?.supplierName) ?? availableSupplierKeys[0] ?? "byggmakker";
      const quantityValue = parseQuantityValue(item.quantity);
      const quantityUnit = parseQuantityUnit(item.quantity);
      const baseListPriceNok =
        typeof match?.listPriceNok === "number" && Number.isFinite(match.listPriceNok) && match.listPriceNok > 0
          ? match.listPriceNok
          : null;
      const baseUnitPriceNok = estimateUnitPrice(item.item, section.title, match);
      const markedUnitPriceNok = Math.max(
        0,
        Math.round(
          applyMarkupForSupplierKey(baseUnitPriceNok, defaultSupplierKey, supplierMarkups, {
            maxPrice: baseListPriceNok,
          }),
        ),
      );
      const unitPriceNok = toVatInclusiveNok(markedUnitPriceNok);
      const listPriceNok =
        typeof baseListPriceNok === "number"
          ? toVatInclusiveNok(baseListPriceNok)
          : unitPriceNok;
      const estimatedDeliveryDays = estimateDeliveryDays(section.title, defaultSupplierKey);
      const estimatedDeliveryDate = toIsoDate(addBusinessDays(new Date(), estimatedDeliveryDays));

      return normalizeOrderItemInput(
        {
          sectionTitle: section.title,
          productName: item.item,
          quantityValue,
          quantityUnit,
          unitPriceNok,
            listPriceNok,
          supplierKey: defaultSupplierKey,
          supplierLabel: MATERIAL_ORDER_SUPPLIERS[defaultSupplierKey].label,
          supplierSku: match?.nobbNumber ?? null,
          estimatedDeliveryDays,
          estimatedDeliveryDate,
          note: item.note,
          isIncluded: true,
          position: sectionIndex * 1000 + itemIndex,
        },
        {
          fallbackDeliveryMode: "delivery",
        },
      );
    });
  });
}

export function recalculateOrderSummary(
  items: MaterialOrderItemInput[],
  deliveryMode: OrderDeliveryMode,
  options?: {
    expressDelivery?: boolean;
    carryInService?: boolean;
  },
): MaterialOrderSummary {
  const normalizedItems = items.map((item) => normalizeOrderItemInput(item, { fallbackDeliveryMode: deliveryMode }));
  const includedItems = normalizedItems.filter((item) => item.isIncluded);

  const subtotalNok = includedItems.reduce((sum, item) => sum + item.lineTotalNok, 0);
  const baseDeliveryFeeNok =
    deliveryMode === "pickup" || includedItems.length === 0
      ? 0
      : clamp(Math.round(subtotalNok * 0.025), 390, 2490);
  const expressFeeNok =
    deliveryMode === "pickup" || !options?.expressDelivery || includedItems.length === 0
      ? 0
      : Math.max(0, Math.round(subtotalNok * 0.015));
  const carryInFeeNok =
    deliveryMode === "pickup" || !options?.carryInService || includedItems.length === 0
      ? 0
      : 690;
  const deliveryFeeNok = baseDeliveryFeeNok + expressFeeNok + carryInFeeNok;
  const totalNok = subtotalNok + deliveryFeeNok;
  const vatNok = Math.round(totalNok * 0.2);

  const estimatedDates = includedItems
    .map((item) => item.estimatedDeliveryDate)
    .filter((value): value is string => Boolean(value));

  const earliestDeliveryDate = estimatedDates.length > 0 ? estimatedDates.slice().sort()[0] : null;
  const latestDeliveryDate =
    estimatedDates.length > 0 ? estimatedDates.slice().sort()[estimatedDates.length - 1] : null;

  return {
    subtotalNok,
    deliveryFeeNok,
    vatNok,
    totalNok,
    earliestDeliveryDate,
    latestDeliveryDate,
  };
}

export function normalizeOrderItemInput(
  item: MaterialOrderItemInput,
  options: { fallbackDeliveryMode: OrderDeliveryMode },
): MaterialOrderItemView {
  const supplierKey = isSupplierKey(item.supplierKey) ? item.supplierKey : "byggmakker";
  const supplier = MATERIAL_ORDER_SUPPLIERS[supplierKey];
  const quantityValue = clampNumber(item.quantityValue, 0, 100000);
  const quantityUnit = normalizeText(item.quantityUnit, 20, "stk");
  const unitPriceNok = Math.max(0, Math.round(item.unitPriceNok));
  const listPriceNok =
    typeof item.listPriceNok === "number" && Number.isFinite(item.listPriceNok)
      ? Math.max(0, Math.round(item.listPriceNok))
      : null;
  const lineTotalNok = Math.round(quantityValue * unitPriceNok);
  const estimatedDeliveryDays =
    item.estimatedDeliveryDays && item.estimatedDeliveryDays > 0
      ? Math.round(item.estimatedDeliveryDays)
      : estimateDeliveryDays(item.sectionTitle, supplierKey);
  const estimatedDeliveryDate =
    item.estimatedDeliveryDate ??
    (options.fallbackDeliveryMode === "pickup" ? null : toIsoDate(addBusinessDays(new Date(), estimatedDeliveryDays)));

  return {
    id: item.id ?? crypto.randomUUID(),
    sectionTitle: normalizeText(item.sectionTitle, 120, "Uklassifisert"),
    productName: normalizeText(item.productName, 200, "Produkt"),
    quantityValue,
    quantityUnit,
    unitPriceNok,
    listPriceNok,
    lineTotalNok,
    supplierKey,
    supplierLabel: normalizeText(item.supplierLabel ?? supplier.label, 80, supplier.label),
    supplierSku: item.supplierSku ? normalizeText(item.supplierSku, 80, "") : null,
    estimatedDeliveryDays,
    estimatedDeliveryDate,
    note: normalizeText(item.note ?? "", 400, ""),
    isIncluded: item.isIncluded !== false,
    position: Math.max(0, Math.round(item.position ?? 0)),
  };
}

export function estimateDeliveryDays(sectionTitle: string, supplierKey: SupplierKey) {
  const supplier = MATERIAL_ORDER_SUPPLIERS[supplierKey];
  const normalized = sectionTitle.toLowerCase();
  const base = Math.round((supplier.leadTimeBusinessDays.min + supplier.leadTimeBusinessDays.max) / 2);

  if (/konstruksjon|grunn|b.ring|b.re/.test(normalized)) {
    return base + 1;
  }

  if (/finish|overflate|maling|list/.test(normalized)) {
    return Math.max(1, base - 1);
  }

  return base;
}

export function toOrderItemRowsInput(orderId: string, userId: string, items: MaterialOrderItemView[]) {
  return items.map((item, index) => ({
    id: item.id,
    order_id: orderId,
    user_id: userId,
    section_title: item.sectionTitle,
    product_name: item.productName,
    quantity_value: item.quantityValue,
    quantity_unit: item.quantityUnit,
    unit_price_nok: item.unitPriceNok,
    line_total_nok: item.lineTotalNok,
    supplier_key: item.supplierKey,
    supplier_label: item.supplierLabel,
    supplier_sku: item.supplierSku,
    estimated_delivery_days: item.estimatedDeliveryDays,
    estimated_delivery_date: item.estimatedDeliveryDate,
    note: item.note,
    is_included: item.isIncluded,
    position: index,
  }));
}

function findBestPriceMatch(itemName: string, itemNote: string, products: PriceListProduct[]) {
  const directNobb = extractNobb(itemName) || extractNobb(itemNote);

  if (directNobb) {
    const direct = products.find((product) => product.nobbNumber === directNobb);

    if (direct) {
      return direct;
    }
  }

  const queryTokens = tokenize(itemName);

  if (queryTokens.length === 0) {
    return null;
  }

  let bestScore = 0;
  let bestMatch: PriceListProduct | null = null;

  for (const product of products) {
    const targetTokens = tokenize(product.productName);
    if (targetTokens.length === 0) {
      continue;
    }

    const overlap = queryTokens.filter((token) => targetTokens.includes(token)).length;
    const score = overlap / Math.max(queryTokens.length, targetTokens.length);

    if (score > bestScore) {
      bestScore = score;
      bestMatch = product;
    }

    if (product.productName.toLowerCase().includes(itemName.toLowerCase())) {
      bestMatch = product;
      bestScore = 1;
      break;
    }
  }

  return bestScore >= 0.18 ? bestMatch : null;
}

function extractNobb(value: string) {
  const match = value.match(/\b(\d{6,10})\b/);
  return match ? match[1] : "";
}

function tokenize(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1);
}

function inferSupplierKey(value?: string): SupplierKey | null {
  const normalized = (value ?? "").toLowerCase();

  if (normalized.includes("byggmakker")) {
    return "byggmakker";
  }

  if (normalized.includes("byggmax")) {
    return "byggmax";
  }

  if (normalized.includes("monter") || normalized.includes("optimera")) {
    return "monter_optimera";
  }

  if (normalized.includes("xl")) {
    return "xl_bygg";
  }

  return null;
}

function estimateUnitPrice(itemName: string, sectionTitle: string, match: PriceListProduct | null) {
  const basePriceFromList = match?.priceNok ?? fallbackUnitPrice(itemName, sectionTitle);
  return Math.max(10, Math.round(basePriceFromList));
}

function fallbackUnitPrice(itemName: string, sectionTitle: string) {
  const text = `${itemName} ${sectionTitle}`.toLowerCase();

  if (/skrue|beslag|feste|spiker/.test(text)) {
    return 145;
  }

  if (/isolasjon|mineralull|vindsperre|dampsperre/.test(text)) {
    return 389;
  }

  if (/gips|plate|panel/.test(text)) {
    return 249;
  }

  if (/maling|sparkel|fug|akryl/.test(text)) {
    return 199;
  }

  if (/terrasse|kledning|bjelke|virke/.test(text)) {
    return 459;
  }

  return 279;
}

function parseQuantityValue(quantity: string) {
  const normalized = quantity.replace(",", ".");
  const match = normalized.match(/(\d+(?:\.\d+)?)/);

  if (!match) {
    return 1;
  }

  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function parseQuantityUnit(quantity: string) {
  const normalized = quantity.trim();
  const match = normalized.match(/\d+(?:[.,]\d+)?\s*(.*)$/);

  if (!match) {
    return "stk";
  }

  const extracted = match[1]?.trim();
  return extracted?.length ? extracted.slice(0, 20) : "stk";
}

function addBusinessDays(date: Date, days: number) {
  const result = new Date(date);
  let remaining = Math.max(0, Math.round(days));

  while (remaining > 0) {
    result.setDate(result.getDate() + 1);
    const day = result.getDay();

    if (day !== 0 && day !== 6) {
      remaining -= 1;
    }
  }

  return result;
}

function toIsoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function normalizeText(value: string, maxLength: number, fallback: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return fallback;
  }

  return trimmed.slice(0, maxLength);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }

  return Math.min(max, Math.max(min, value));
}

export function isSupplierKey(value: string): value is SupplierKey {
  return value in MATERIAL_ORDER_SUPPLIERS;
}
