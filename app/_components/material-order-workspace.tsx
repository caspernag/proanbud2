"use client";

import { startTransition, useEffect, useMemo, useState } from "react";

import { DatePicker } from "@/components/ui/date-picker";
import { formatCurrency } from "@/lib/utils";

type SupplierKey = "byggmakker" | "monter_optimera" | "byggmax" | "xl_bygg";
type DeliveryMode = "delivery" | "pickup";
type CustomerType = "private" | "business";
type CheckoutFlow = "pay_now" | "klarna";
type StoredCheckoutFlow = CheckoutFlow | "business_invoice" | "financing";

type BrregCompanyHit = {
  name: string;
  organizationNumber: string;
  addressLine: string | null;
  postalLine: string | null;
};

type AddressHit = {
  label: string;
  addressLine1: string;
  postalCode: string;
  city: string;
  municipality: string | null;
};

type SupplierOption = {
  key: SupplierKey;
  label: string;
  minLeadDays: number;
  maxLeadDays: number;
  defaultLeadDays: number;
  researchNote: string;
};

type OrderItem = {
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

type OrderSummary = {
  subtotalNok: number;
  deliveryFeeNok: number;
  vatNok: number;
  totalNok: number;
  earliestDeliveryDate: string | null;
  latestDeliveryDate: string | null;
};

type ImagePreviewDialogState = {
  nobbNumber: string;
  productName: string;
};

type MaterialOrderWorkspaceProps = {
  projectSlug: string;
  projectTitle: string;
  orderId: string;
  orderStatus: string;
  initialCustomerType: CustomerType;
  initialCompanyName: string | null;
  initialOrganizationNumber: string | null;
  initialDeliveryMode: DeliveryMode;
  initialDesiredDeliveryDate: string | null;
  initialShippingContactName: string | null;
  initialShippingPhone: string | null;
  initialShippingAddressLine1: string | null;
  initialShippingPostalCode: string | null;
  initialShippingCity: string | null;
  initialDeliveryInstructions: string;
  initialExpressDelivery: boolean;
  initialCarryInService: boolean;
  initialCheckoutFlow: StoredCheckoutFlow;
  initialFinancingPlanMonths: number | null;
  initialContractTermsVersion: string | null;
  initialContractAcceptedAt: string | null;
  initialCustomerNote: string;
  initialItems: OrderItem[];
  initialSummary: OrderSummary;
  availableSupplierKeys: SupplierKey[];
  paymentCancelled: boolean;
  paidInReturn: boolean;
  testMode: boolean;
  submittedInReturn: boolean;
  submittedFlow: string;
};

const SUPPLIERS: SupplierOption[] = [
  {
    key: "byggmakker",
    label: "Byggmakker",
    minLeadDays: 2,
    maxLeadDays: 5,
    defaultLeadDays: 4,
    researchNote: "Enkel levering 2-5 virkedager.",
  },
  {
    key: "monter_optimera",
    label: "Montér/Optimera",
    minLeadDays: 3,
    maxLeadDays: 6,
    defaultLeadDays: 5,
    researchNote: "Profflogistikk og byggeplassleveranser.",
  },
  {
    key: "byggmax",
    label: "Byggmax",
    minLeadDays: 2,
    maxLeadDays: 6,
    defaultLeadDays: 4,
    researchNote: "Hjemlevering og klikk-og-hent.",
  },
  {
    key: "xl_bygg",
    label: "XL-Bygg",
    minLeadDays: 2,
    maxLeadDays: 7,
    defaultLeadDays: 5,
    researchNote: "Varehusbasert klikk-og-hent og bestilling.",
  },
];

const SUPPLIER_BY_KEY: Record<SupplierKey, SupplierOption> = {
  byggmakker: SUPPLIERS[0],
  monter_optimera: SUPPLIERS[1],
  byggmax: SUPPLIERS[2],
  xl_bygg: SUPPLIERS[3],
};

const MINIMUM_ORDER_VALUE_NOK = 5000;
const COMPANY_SEARCH_MIN_QUERY = 2;
const ADDRESS_SEARCH_MIN_QUERY = 3;
const SEARCH_DEBOUNCE_MS = 250;

export function MaterialOrderWorkspace({
  projectSlug,
  projectTitle,
  orderId,
  orderStatus,
  initialCustomerType,
  initialCompanyName,
  initialOrganizationNumber,
  initialDesiredDeliveryDate,
  initialShippingContactName,
  initialShippingPhone,
  initialShippingAddressLine1,
  initialShippingPostalCode,
  initialShippingCity,
  initialDeliveryInstructions,
  initialCheckoutFlow,
  initialContractTermsVersion,
  initialContractAcceptedAt,
  initialCustomerNote,
  initialItems,
  initialSummary,
  availableSupplierKeys,
  paymentCancelled,
  paidInReturn,
  testMode,
  submittedInReturn,
  submittedFlow,
}: MaterialOrderWorkspaceProps) {
  const [customerType, setCustomerType] = useState<CustomerType>(initialCustomerType);
  const [companyName, setCompanyName] = useState(initialCompanyName ?? "");
  const [organizationNumber, setOrganizationNumber] = useState(initialOrganizationNumber ?? "");
  const deliveryMode: DeliveryMode = "delivery";
  const [desiredDeliveryDate, setDesiredDeliveryDate] = useState(initialDesiredDeliveryDate ?? "");
  const [shippingContactName, setShippingContactName] = useState(initialShippingContactName ?? "");
  const [shippingPhone, setShippingPhone] = useState(initialShippingPhone ?? "");
  const [shippingAddressLine1, setShippingAddressLine1] = useState(initialShippingAddressLine1 ?? "");
  const [shippingPostalCode, setShippingPostalCode] = useState(initialShippingPostalCode ?? "");
  const [shippingCity, setShippingCity] = useState(initialShippingCity ?? "");
  const [addressSearchQuery, setAddressSearchQuery] = useState(
    formatAddressSearchValue(initialShippingAddressLine1 ?? "", initialShippingPostalCode ?? "", initialShippingCity ?? ""),
  );
  const [addressSearchPending, setAddressSearchPending] = useState(false);
  const [addressHits, setAddressHits] = useState<AddressHit[]>([]);
  const [addressSearchError, setAddressSearchError] = useState("");
  const [deliveryInstructions, setDeliveryInstructions] = useState(initialDeliveryInstructions);
  const [checkoutFlow, setCheckoutFlow] = useState<CheckoutFlow>(toSupportedCheckoutFlow(initialCheckoutFlow));
  const [companySearchQuery, setCompanySearchQuery] = useState(initialCompanyName ?? "");
  const [companySearchPending, setCompanySearchPending] = useState(false);
  const [companyHits, setCompanyHits] = useState<BrregCompanyHit[]>([]);
  const [companySearchError, setCompanySearchError] = useState("");
  const [contractAccepted, setContractAccepted] = useState(Boolean(initialContractAcceptedAt));
  const [contractAcceptedAt, setContractAcceptedAt] = useState<string | null>(initialContractAcceptedAt);
  const [contractTermsVersion] = useState(initialContractTermsVersion ?? "2026-04");
  const [customerNote, setCustomerNote] = useState(initialCustomerNote);
  const [items, setItems] = useState<OrderItem[]>(initialItems);
  const [serverSummary, setServerSummary] = useState<OrderSummary>(initialSummary);
  const [isDirty, setIsDirty] = useState(false);
  const [savePending, setSavePending] = useState(false);
  const [checkoutPending, setCheckoutPending] = useState(false);
  const [message, setMessage] = useState("");
  const [quantityDraftById, setQuantityDraftById] = useState<Record<string, string>>({});
  const [imagePreviewDialog, setImagePreviewDialog] = useState<ImagePreviewDialogState | null>(null);

  const suppliers = useMemo(() => {
    const keys = availableSupplierKeys.length > 0 ? availableSupplierKeys : (["byggmakker"] as SupplierKey[]);
    return keys.map((key) => SUPPLIER_BY_KEY[key]).filter(Boolean);
  }, [availableSupplierKeys]);

  const localSummary = useMemo(
    () =>
      calculateSummary(items, deliveryMode, {
        expressDelivery: false,
        carryInService: false,
      }),
    [deliveryMode, items],
  );
  const desiredDeliveryDateValue = useMemo(() => parseIsoDateInput(desiredDeliveryDate), [desiredDeliveryDate]);
  const displaySummary = isDirty ? localSummary : serverSummary;
  const meetsMinimumOrderValue = displaySummary.subtotalNok >= MINIMUM_ORDER_VALUE_NOK;
  const isLocked = ["paid", "submitted", "cancelled"].includes(orderStatus);

  const supplierRollup = useMemo(() => {
    return suppliers.map((supplier) => {
      const supplierLines = items.filter((item) => item.isIncluded && item.supplierKey === supplier.key);
      const amountNok = supplierLines.reduce((sum, line) => sum + line.lineTotalNok, 0);

      return {
        ...supplier,
        lineCount: supplierLines.length,
        amountNok,
      };
    });
  }, [items, suppliers]);

  const includedLineCount = useMemo(() => items.filter((item) => item.isIncluded).length, [items]);

  const orderChecklist = useMemo(
    () => [
      {
        label: "Kontrakt signert",
        complete: contractAccepted,
      },
      {
        label: "Kontaktperson + telefon",
        complete: shippingContactName.trim().length > 0 && shippingPhone.trim().length > 0,
      },
      {
        label: "Leveringsdata",
        complete:
          shippingAddressLine1.trim().length > 0 &&
          shippingPostalCode.trim().length > 0 &&
          shippingCity.trim().length > 0,
      },
      {
        label: "Minst én aktiv varelinje",
        complete: includedLineCount > 0,
      },
      {
        label: `Minste bestillingsverdi (${formatCurrency(MINIMUM_ORDER_VALUE_NOK)})`,
        complete: meetsMinimumOrderValue,
      },
    ],
    [
      contractAccepted,
      includedLineCount,
      shippingAddressLine1,
      shippingCity,
      shippingContactName,
      shippingPhone,
      shippingPostalCode,
      meetsMinimumOrderValue,
    ],
  );

  useEffect(() => {
    if (customerType !== "business") {
      setCompanyHits([]);
      setCompanySearchPending(false);
      setCompanySearchError("");
      return;
    }

    const query = companySearchQuery.trim();

    if (query.length < COMPANY_SEARCH_MIN_QUERY) {
      setCompanyHits([]);
      setCompanySearchPending(false);
      setCompanySearchError("");
      return;
    }

    const abortController = new AbortController();

    const timeout = setTimeout(async () => {
      setCompanySearchPending(true);
      setCompanySearchError("");

      try {
        const response = await fetch(`/api/brreg/search?q=${encodeURIComponent(query)}`, {
          signal: abortController.signal,
        });

        if (!response.ok) {
          setCompanyHits([]);
          setCompanySearchError("Kunne ikke hente firma akkurat nå.");
          return;
        }

        const payload = (await response.json()) as { items?: BrregCompanyHit[] };
        setCompanyHits(payload.items ?? []);
      } catch {
        if (!abortController.signal.aborted) {
          setCompanyHits([]);
          setCompanySearchError("Kunne ikke hente firma akkurat nå.");
        }
      } finally {
        if (!abortController.signal.aborted) {
          setCompanySearchPending(false);
        }
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      abortController.abort();
      clearTimeout(timeout);
    };
  }, [companySearchQuery, customerType]);

  useEffect(() => {
    const query = addressSearchQuery.trim();

    if (query.length < ADDRESS_SEARCH_MIN_QUERY) {
      setAddressHits([]);
      setAddressSearchPending(false);
      setAddressSearchError("");
      return;
    }

    const abortController = new AbortController();

    const timeout = setTimeout(async () => {
      setAddressSearchPending(true);
      setAddressSearchError("");

      try {
        const response = await fetch(`/api/addresses/search?q=${encodeURIComponent(query)}`, {
          signal: abortController.signal,
        });

        if (!response.ok) {
          setAddressHits([]);
          setAddressSearchError("Kunne ikke hente adresser akkurat nå.");
          return;
        }

        const payload = (await response.json()) as { items?: AddressHit[] };
        setAddressHits(payload.items ?? []);
      } catch {
        if (!abortController.signal.aborted) {
          setAddressHits([]);
          setAddressSearchError("Kunne ikke hente adresser akkurat nå.");
        }
      } finally {
        if (!abortController.signal.aborted) {
          setAddressSearchPending(false);
        }
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      abortController.abort();
      clearTimeout(timeout);
    };
  }, [addressSearchQuery]);

  function markDirty() {
    if (!isDirty) {
      setIsDirty(true);
    }
  }

  function updateItem(itemId: string, updater: (item: OrderItem) => OrderItem) {
    setItems((current) =>
      current.map((item) => {
        if (item.id !== itemId) {
          return item;
        }

        const next = updater(item);
        return {
          ...next,
          lineTotalNok: Math.round(next.quantityValue * next.unitPriceNok),
        };
      }),
    );
    markDirty();
  }

  function addEmptyLine() {
    const defaultSupplier = suppliers[0] ?? SUPPLIERS[0];
    const leadDays = defaultSupplier.defaultLeadDays;

    setItems((current) => [
      ...current,
      {
        id: crypto.randomUUID(),
        sectionTitle: "Manuell",
        productName: "Nytt produkt",
        quantityValue: 1,
        quantityUnit: "stk",
        unitPriceNok: 0,
        listPriceNok: null,
        lineTotalNok: 0,
        supplierKey: defaultSupplier.key,
        supplierLabel: defaultSupplier.label,
        supplierSku: null,
        estimatedDeliveryDays: leadDays,
        estimatedDeliveryDate: toIsoDate(addBusinessDays(new Date(), leadDays)),
        note: "",
        isIncluded: true,
        position: current.length,
      },
    ]);
    markDirty();
  }

  function removeLine(itemId: string) {
    setItems((current) => current.filter((item) => item.id !== itemId).map((item, index) => ({ ...item, position: index })));
    setQuantityDraftById((current) => {
      if (!(itemId in current)) {
        return current;
      }

      const next = { ...current };
      delete next[itemId];
      return next;
    });
    markDirty();
  }

  function selectCompany(hit: BrregCompanyHit) {
    setCompanyName(hit.name);
    setOrganizationNumber(hit.organizationNumber);
    setCompanySearchQuery(hit.name);
    setCompanyHits([]);
    setCompanySearchError("");
    markDirty();
  }

  function selectAddress(hit: AddressHit) {
    setShippingAddressLine1(hit.addressLine1);
    setShippingPostalCode(hit.postalCode);
    setShippingCity(hit.city);
    setAddressSearchQuery(hit.label);
    setAddressHits([]);
    setAddressSearchError("");
    markDirty();
  }

  async function saveOrder() {
    if (isLocked) {
      return true;
    }

    startTransition(() => {
      setSavePending(true);
      setMessage("");
    });

    try {
      const response = await fetch(`/api/material-orders/${orderId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          customerType,
          companyName: customerType === "business" ? companyName : null,
          organizationNumber: customerType === "business" ? organizationNumber : null,
          deliveryMode,
          desiredDeliveryDate: desiredDeliveryDate || null,
          shippingContactName,
          shippingPhone,
          shippingAddressLine1: deliveryMode === "delivery" ? shippingAddressLine1 : null,
          shippingPostalCode: deliveryMode === "delivery" ? shippingPostalCode : null,
          shippingCity: deliveryMode === "delivery" ? shippingCity : null,
          deliveryInstructions,
          expressDelivery: false,
          carryInService: false,
          checkoutFlow,
          financingPlanMonths: null,
          contractTermsVersion,
          contractAccepted,
          contractAcceptedAt,
          customerNote,
          items: items.map((item) => ({
            id: item.id,
            sectionTitle: item.sectionTitle,
            productName: item.productName,
            quantityValue: item.quantityValue,
            quantityUnit: item.quantityUnit,
            unitPriceNok: item.unitPriceNok,
            listPriceNok: item.listPriceNok,
            supplierKey: item.supplierKey,
            supplierLabel: item.supplierLabel,
            supplierSku: item.supplierSku ?? undefined,
            estimatedDeliveryDays: item.estimatedDeliveryDays,
            estimatedDeliveryDate: item.estimatedDeliveryDate,
            note: item.note,
            isIncluded: item.isIncluded,
          })),
        }),
      });

      const payload = (await response.json()) as {
        error?: string;
        summary?: OrderSummary;
        items?: OrderItem[];
        order?: {
          contractAcceptedAt?: string | null;
        };
      };

      if (!response.ok || !payload.summary || !payload.items) {
        setMessage(payload.error ?? "Kunne ikke lagre bestillingen.");
        return false;
      }

      setItems(payload.items);
      setServerSummary(payload.summary);
      setQuantityDraftById({});
      if (payload.order?.contractAcceptedAt) {
        setContractAcceptedAt(payload.order.contractAcceptedAt);
      }
      setIsDirty(false);
      setMessage("Bestillingen er lagret.");
      return true;
    } catch {
      setMessage("Nettverksfeil under lagring.");
      return false;
    } finally {
      setSavePending(false);
    }
  }

  async function checkoutOrder() {
    if (isLocked) {
      return;
    }

    if (!contractAccepted) {
      setMessage("Godkjenn kontraktsvilkår før innsending.");
      return;
    }

    if (!shippingContactName.trim() || !shippingPhone.trim()) {
      setMessage("Legg inn kontaktperson og telefon før innsending.");
      return;
    }

    if (customerType === "business" && !companyName.trim()) {
      setMessage("Legg inn firmanavn for bedriftsbestilling.");
      return;
    }

    if (!shippingAddressLine1.trim() || !shippingPostalCode.trim() || !shippingCity.trim()) {
      setMessage("Legg inn komplett leveringsadresse før innsending.");
      return;
    }

    if (!meetsMinimumOrderValue) {
      setMessage(`Minste bestillingsverdi for ProAnbud er ${formatCurrency(MINIMUM_ORDER_VALUE_NOK)}.`);
      return;
    }

    if (isDirty) {
      const ok = await saveOrder();
      if (!ok) {
        return;
      }
    }

    startTransition(() => {
      setCheckoutPending(true);
      setMessage("");
    });

    try {
      const response = await fetch(`/api/material-orders/${orderId}/checkout`, {
        method: "POST",
      });
      const payload = (await response.json()) as { error?: string; url?: string };

      if (!response.ok || !payload.url) {
        setMessage(payload.error ?? "Kunne ikke starte betaling.");
        setCheckoutPending(false);
        return;
      }

      window.location.href = payload.url;
    } catch {
      setMessage("Nettverksfeil under betaling.");
      setCheckoutPending(false);
    }
  }

  return (
    <div className="space-y-4 overflow-x-hidden">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-4">
          <section className="panel rounded-2xl p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-stone-900">Økonomi og oppgjør</h3>
                <p className="mt-0.5 text-xs text-stone-600">Kun kortbetaling eller Klarna via Stripe.</p>
              </div>
              <span
                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                  meetsMinimumOrderValue ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"
                }`}
              >
                Min {formatCurrency(MINIMUM_ORDER_VALUE_NOK)}
              </span>
            </div>

            <div className="mt-3 grid gap-2 md:grid-cols-2">
              <label
                className={`cursor-pointer rounded-lg border px-3 py-2 transition ${
                  checkoutFlow === "pay_now"
                    ? "border-stone-900 bg-stone-100"
                    : "border-stone-200 bg-white hover:border-stone-400"
                }`}
              >
                <input
                  type="radio"
                  name="checkoutFlow"
                  value="pay_now"
                  checked={checkoutFlow === "pay_now"}
                  onChange={() => {
                    setCheckoutFlow("pay_now");
                    markDirty();
                  }}
                  disabled={isLocked}
                  className="sr-only"
                />
                <p className="text-xs font-semibold text-stone-900">Kortbetaling</p>
                <p className="mt-0.5 text-[11px] text-stone-600">Umiddelbar betaling i Stripe Checkout.</p>
              </label>

              <label
                className={`relative cursor-pointer rounded-lg border px-3 py-2 transition ${
                  checkoutFlow === "klarna"
                    ? "border-stone-900 bg-stone-100"
                    : "border-stone-200 bg-white hover:border-stone-400"
                }`}
              >
                <input
                  type="radio"
                  name="checkoutFlow"
                  value="klarna"
                  checked={checkoutFlow === "klarna"}
                  onChange={() => {
                    setCheckoutFlow("klarna");
                    markDirty();
                  }}
                  disabled={isLocked}
                  className="sr-only"
                />
                <span className="absolute right-2 top-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-emerald-700">
                  Mest populær
                </span>
                <p className="text-xs font-semibold text-stone-900">Klarna via Stripe</p>
                <p className="mt-0.5 text-[11px] text-stone-600">Faktura/delbetaling der Klarna er tilgjengelig.</p>
              </label>
            </div>

            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <label className="text-xs text-stone-700">
                Kundeprofil
                <select
                  value={customerType}
                  onChange={(event) => {
                    setCustomerType(event.target.value as CustomerType);
                    markDirty();
                  }}
                  disabled={isLocked}
                  className="mt-1 h-8 w-full rounded-sm border border-stone-300 bg-white px-2 text-xs text-stone-900 outline-none focus:border-stone-900 disabled:cursor-not-allowed"
                >
                  <option value="private">Privatperson</option>
                  <option value="business">Bedrift</option>
                </select>
              </label>

              <div
                className={`rounded-md border px-2.5 py-2 text-xs ${
                  meetsMinimumOrderValue
                    ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                    : "border-amber-200 bg-amber-50 text-amber-800"
                }`}
              >
                Minste bestillingsverdi: <span className="font-semibold">{formatCurrency(MINIMUM_ORDER_VALUE_NOK)}</span>
              </div>
            </div>

            {customerType === "business" ? (
              <div className="mt-3 space-y-2">
                <label className="block text-xs text-stone-700">
                  Firma (Brreg)
                  <input
                    value={companySearchQuery}
                    onChange={(event) => {
                      const next = event.target.value;
                      setCompanySearchQuery(next);

                      if (next.trim().length === 0 && (companyName || organizationNumber)) {
                        setCompanyName("");
                        setOrganizationNumber("");
                        markDirty();
                      }
                    }}
                    disabled={isLocked}
                    placeholder="Søk firmanavn..."
                    className="mt-1 h-8 w-full rounded-sm border border-stone-300 bg-white px-2 text-xs text-stone-900 outline-none focus:border-stone-900 disabled:cursor-not-allowed"
                  />
                </label>

                {companySearchPending ? <p className="text-[11px] text-stone-500">Søker i Brreg...</p> : null}
                {companySearchError ? <p className="text-[11px] text-amber-700">{companySearchError}</p> : null}

                {companyHits.length > 0 ? (
                  <div className="max-h-44 overflow-y-auto rounded-md border border-stone-200 bg-white">
                    {companyHits.map((hit) => (
                      <button
                        key={`${hit.organizationNumber}:${hit.name}`}
                        type="button"
                        onClick={() => selectCompany(hit)}
                        className="block w-full border-b border-stone-100 px-2.5 py-2 text-left last:border-b-0 hover:bg-stone-50"
                      >
                        <p className="text-xs font-semibold text-stone-900">{hit.name}</p>
                        <p className="text-[11px] text-stone-600">Org.nr {hit.organizationNumber}</p>
                        {hit.addressLine || hit.postalLine ? (
                          <p className="text-[11px] text-stone-500">{[hit.addressLine, hit.postalLine].filter(Boolean).join(", ")}</p>
                        ) : null}
                      </button>
                    ))}
                  </div>
                ) : null}

                <div className="rounded-md border border-stone-200 bg-stone-50 px-2.5 py-2 text-xs text-stone-700">
                  Valgt org.nr: <span className="font-semibold text-stone-900">{organizationNumber || "Ikke valgt"}</span>
                </div>
              </div>
            ) : null}

            <div className="mt-3 rounded-md border border-stone-200 bg-stone-50 px-2.5 py-2 text-xs text-stone-700">
              Prosjektkode: <span className="font-semibold text-stone-900">{projectSlug}</span>
            </div>
          </section>

          <section className="panel rounded-2xl p-3">
            <h3 className="text-sm font-semibold text-stone-900">Leveranse</h3>
            <p className="mt-0.5 text-xs text-stone-600">Fast metode: lastebil til adresse. Velg norsk adresse fra oppslag.</p>

            <div className="mt-3 space-y-2 rounded-lg border border-stone-200 bg-stone-50 p-2.5">
              <label className="block text-xs text-stone-700">
                Søk leveringsadresse
                <input
                  value={addressSearchQuery}
                  onChange={(event) => {
                    const nextQuery = event.target.value;
                    setAddressSearchQuery(nextQuery);

                    if (shippingAddressLine1 || shippingPostalCode || shippingCity) {
                      setShippingAddressLine1("");
                      setShippingPostalCode("");
                      setShippingCity("");
                      markDirty();
                    }
                  }}
                  disabled={isLocked}
                  placeholder="F.eks. Storgata 1, Oslo"
                  className="mt-1 h-8 w-full rounded-sm border border-stone-300 bg-white px-2 text-xs text-stone-900 outline-none focus:border-stone-900 disabled:cursor-not-allowed"
                />
              </label>

              {shippingAddressLine1 && shippingPostalCode && shippingCity ? (
                <div className="rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-2 text-xs text-emerald-800">
                  Valgt adresse: <span className="font-semibold">{shippingAddressLine1}, {shippingPostalCode} {shippingCity}</span>
                </div>
              ) : null}

              {addressSearchPending ? <p className="text-[11px] text-stone-500">Søker adresser...</p> : null}
              {addressSearchError ? <p className="text-[11px] text-amber-700">{addressSearchError}</p> : null}

              {addressHits.length > 0 ? (
                <div className="max-h-44 overflow-y-auto rounded-md border border-stone-200 bg-white">
                  {addressHits.map((hit) => (
                    <button
                      key={`${hit.addressLine1}:${hit.postalCode}:${hit.city}`}
                      type="button"
                      onClick={() => selectAddress(hit)}
                      className="block w-full border-b border-stone-100 px-2.5 py-2 text-left last:border-b-0 hover:bg-stone-50"
                    >
                      <p className="text-xs font-semibold text-stone-900">{hit.addressLine1}</p>
                      <p className="text-[11px] text-stone-600">{hit.postalCode} {hit.city}</p>
                      {hit.municipality ? <p className="text-[11px] text-stone-500">{hit.municipality}</p> : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
              <label className="text-xs text-stone-700">
                Ønsket leveringsdato
                <DatePicker
                  value={desiredDeliveryDateValue}
                  onChange={(nextValue) => {
                    setDesiredDeliveryDate(nextValue ? formatIsoDateInput(nextValue) : "");
                    markDirty();
                  }}
                  disabled={isLocked}
                  placeholder="Velg dato"
                />
              </label>

              <label className="text-xs text-stone-700">
                Kontaktperson
                <input
                  value={shippingContactName}
                  onChange={(event) => {
                    setShippingContactName(event.target.value);
                    markDirty();
                  }}
                  disabled={isLocked}
                  className="mt-1 h-8 w-full rounded-sm border border-stone-300 bg-white px-2 text-xs text-stone-900 outline-none focus:border-stone-900 disabled:cursor-not-allowed"
                />
              </label>

              <label className="text-xs text-stone-700">
                Telefon
                <input
                  value={shippingPhone}
                  onChange={(event) => {
                    setShippingPhone(event.target.value);
                    markDirty();
                  }}
                  disabled={isLocked}
                  className="mt-1 h-8 w-full rounded-sm border border-stone-300 bg-white px-2 text-xs text-stone-900 outline-none focus:border-stone-900 disabled:cursor-not-allowed"
                />
              </label>

              <label className="text-xs text-stone-700 sm:col-span-2 xl:col-span-4">
                Fraktinstruksjoner
                <textarea
                  value={deliveryInstructions}
                  onChange={(event) => {
                    setDeliveryInstructions(event.target.value);
                    markDirty();
                  }}
                  disabled={isLocked}
                  rows={2}
                  className="mt-1 w-full rounded-sm border border-stone-300 bg-white px-2 py-2 text-xs text-stone-900 outline-none focus:border-stone-900 disabled:cursor-not-allowed"
                />
              </label>
            </div>
          </section>

          <section className="panel rounded-2xl p-4">
            <h3 className="text-base font-semibold text-stone-900">Kontrakt og merknader</h3>
            <p className="mt-1 text-sm text-stone-600">Kontrakt må godkjennes før innsending og kjøp.</p>

            <label className="mt-3 inline-flex items-start gap-2 rounded-md border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-700">
              <input
                type="checkbox"
                checked={contractAccepted}
                onChange={(event) => {
                  const checked = event.target.checked;
                  setContractAccepted(checked);
                  setContractAcceptedAt(checked ? new Date().toISOString() : null);
                  markDirty();
                }}
                disabled={isLocked}
                className="mt-0.5 h-4 w-4"
              />
              <span>
                Jeg godkjenner kontraktsvilkår for materialkjøp og leveranse (versjon {contractTermsVersion}).
              </span>
            </label>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div className="rounded-md border border-stone-200 bg-white px-3 py-2 text-sm text-stone-700">
                Kontrakt signert: <span className="font-semibold text-stone-900">{contractAcceptedAt ? formatDateTime(contractAcceptedAt) : "Nei"}</span>
              </div>
              <div className="rounded-md border border-stone-200 bg-white px-3 py-2 text-sm text-stone-700">
                Ordrelinjer med leverandørvalg: <span className="font-semibold text-stone-900">Ja</span>
              </div>
            </div>

            <label className="mt-3 block text-sm text-stone-700">
              Kommentar til ordre / leveranse
              <textarea
                value={customerNote}
                onChange={(event) => {
                  setCustomerNote(event.target.value);
                  markDirty();
                }}
                disabled={isLocked}
                rows={3}
                className="mt-1 w-full rounded-sm border border-stone-300 bg-white px-2 py-2 text-sm text-stone-900 outline-none focus:border-stone-900 disabled:cursor-not-allowed"
              />
            </label>
          </section>

          <section className="panel rounded-2xl p-0">
            <div className="flex items-center justify-between border-b border-stone-200 px-3 py-3">
              <div>
                <p className="text-sm font-semibold text-stone-900">Bestillingslinjer</p>
                <p className="text-xs text-stone-500">Dokumentaktiv visning med linjenummer, varetekst, leverandør, pris og sum.</p>
              </div>
              <button
                type="button"
                onClick={addEmptyLine}
                disabled={isLocked}
                className="h-8 rounded-sm border border-stone-300 bg-white px-2.5 text-xs font-semibold text-stone-700 transition hover:border-stone-900 hover:text-stone-900 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Legg til linje
              </button>
            </div>

            <div className="max-w-full overflow-x-auto">
              <table className="w-full min-w-[1180px] border-collapse text-[13px]">
                <thead>
                  <tr className="bg-stone-50 text-[10px] font-semibold uppercase tracking-[0.08em] text-stone-600">
                    <th className="w-[24%] border border-stone-200 px-2 py-1.5 text-left">Produkt</th>
                    <th className="w-[8%] border border-stone-200 px-2 py-1.5 text-left">Mengde</th>
                    <th className="w-[7%] border border-stone-200 px-2 py-1.5 text-left">Enhet</th>
                    <th className="w-[14%] border border-stone-200 px-2 py-1.5 text-left">Leverandør</th>
                    <th className="w-[9%] border border-stone-200 px-2 py-1.5 text-left">Veil. pris</th>
                    <th className="w-[9%] border border-stone-200 px-2 py-1.5 text-left">Din Pris</th>
                    <th className="w-[9%] border border-stone-200 px-2 py-1.5 text-left">Linjesum</th>
                    <th className="w-[8%] border border-stone-200 px-2 py-1.5 text-left">NOBB</th>
                    <th className="w-[6%] border border-stone-200 px-2 py-1.5 text-left">Aktiv</th>
                    <th className="w-[6%] border border-stone-200 px-2 py-1.5 text-left">Handling</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id} className={`align-top ${item.isIncluded ? "bg-white" : "bg-stone-50/70"}`}>
                      <td className="border border-stone-200 px-2 py-1.5 break-words">
                        <div className="flex min-w-0 items-start gap-2.5">
                          <OrderLineThumbnail
                            nobbNumber={item.supplierSku}
                            productName={item.productName}
                            onPreview={(nobbNumber, productName) =>
                              setImagePreviewDialog({ nobbNumber, productName })
                            }
                          />
                          <div className="min-w-0 flex-1">
                            {item.supplierSku ? (
                              <a
                                href={`https://nobb.no/item/${encodeURIComponent(item.supplierSku)}`}
                                target="_blank"
                                rel="noreferrer"
                                className="block truncate text-[14px] font-semibold text-stone-900 underline decoration-stone-300 underline-offset-2 hover:decoration-stone-900"
                                title={item.productName}
                              >
                                {item.productName}
                              </a>
                            ) : (
                              <p title={item.productName} className="truncate text-[14px] font-semibold text-stone-900">
                                {item.productName}
                              </p>
                            )}
                            <p className="mt-1 text-[11px] text-stone-500">{item.sectionTitle}</p>
                          </div>
                        </div>
                      </td>
                      <td className="border border-stone-200 px-2 py-1.5">
                        <input
                          type="number"
                          step="1"
                          min="0"
                          value={quantityDraftById[item.id] ?? String(item.quantityValue)}
                          onChange={(event) => {
                            const nextValue = event.target.value;

                            setQuantityDraftById((current) => ({
                              ...current,
                              [item.id]: nextValue,
                            }));

                            if (nextValue.trim().length === 0) {
                              return;
                            }

                            updateItem(item.id, (current) => ({
                              ...current,
                              quantityValue: toPositiveInteger(nextValue, current.quantityValue),
                            }));
                          }}
                          onBlur={() => {
                            const draft = quantityDraftById[item.id];

                            if (draft === undefined) {
                              return;
                            }

                            const trimmed = draft.trim();

                            updateItem(item.id, (current) => ({
                              ...current,
                              quantityValue: trimmed.length === 0 ? 0 : toPositiveInteger(trimmed, current.quantityValue),
                            }));

                            setQuantityDraftById((current) => {
                              if (!(item.id in current)) {
                                return current;
                              }

                              const next = { ...current };
                              delete next[item.id];
                              return next;
                            });
                          }}
                          onFocus={(event) => {
                            event.currentTarget.select();
                          }}
                          onKeyDown={(event) => {
                            if ([".", ",", "e", "E", "+", "-"].includes(event.key)) {
                              event.preventDefault();
                            }
                          }}
                          disabled={isLocked}
                          className="h-8 w-16 rounded-sm border border-stone-300 bg-white px-2 text-right font-mono text-[13px] text-stone-900 outline-none focus:border-stone-900 disabled:cursor-not-allowed"
                        />
                      </td>
                      <td className="border border-stone-200 px-2 py-1.5">
                        <p className="py-1.5 text-[13px] text-stone-800">{item.quantityUnit}</p>
                      </td>
                      <td className="border border-stone-200 px-2 py-1.5">
                        <select
                          value={item.supplierKey}
                          onChange={(event) => {
                            const nextSupplierKey = event.target.value as SupplierKey;
                            const supplier = SUPPLIER_BY_KEY[nextSupplierKey];
                            const leadDays = averageLeadDays(supplier);

                            updateItem(item.id, (current) => ({
                              ...current,
                              supplierKey: nextSupplierKey,
                              supplierLabel: supplier.label,
                              listPriceNok: null,
                              estimatedDeliveryDays: leadDays,
                              estimatedDeliveryDate: toIsoDate(addBusinessDays(new Date(), leadDays)),
                            }));
                          }}
                          disabled={isLocked || suppliers.length <= 1}
                          className="h-8 w-full rounded-sm border border-stone-300 bg-white px-2 text-[13px] text-stone-900 outline-none focus:border-stone-900 disabled:cursor-not-allowed"
                        >
                          {getSupplierOptions(item.supplierKey, suppliers).map((supplier) => (
                            <option key={supplier.key} value={supplier.key}>
                              {supplier.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="border border-stone-200 px-2 py-1.5">
                        <p className="py-1.5 text-right font-mono text-[13px] text-stone-700">
                          {getVeilPriceNok(item) === null ? "-" : formatCurrency(getVeilPriceNok(item) ?? 0)}
                        </p>
                      </td>
                      <td className="border border-stone-200 px-2 py-1.5">
                        <p className="py-1.5 text-right font-mono text-[13px] text-stone-900">{formatCurrency(item.unitPriceNok)}</p>
                      </td>
                      <td className="border border-stone-200 px-2 py-1.5 text-right font-mono text-sm font-semibold text-stone-900">
                        {formatCurrency(item.lineTotalNok)}
                      </td>
                      <td className="border border-stone-200 px-2 py-1.5 break-all">
                        {item.supplierSku ? (
                          <a
                            href={`/api/nobb/${encodeURIComponent(item.supplierSku)}`}
                            target="_blank"
                            rel="noreferrer"
                            className="font-mono text-[13px] text-stone-800 underline decoration-stone-300 underline-offset-2 hover:decoration-stone-900"
                          >
                            {item.supplierSku}
                          </a>
                        ) : (
                          <p className="font-mono text-[13px] text-stone-400">-</p>
                        )}
                      </td>
                      <td className="border border-stone-200 px-2 py-1.5 text-center">
                        <input
                          type="checkbox"
                          checked={item.isIncluded}
                          onChange={(event) => updateItem(item.id, (current) => ({ ...current, isIncluded: event.target.checked }))}
                          disabled={isLocked}
                          className="h-4 w-4"
                        />
                      </td>
                      <td className="border border-stone-200 px-2 py-1.5">
                        <button
                          type="button"
                          onClick={() => removeLine(item.id)}
                          disabled={isLocked}
                          className="h-8 rounded-sm border border-stone-300 bg-white px-2 text-[11px] font-semibold text-stone-700 transition hover:border-[var(--danger)] hover:text-[var(--danger)] disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Fjern
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>

        <aside className="space-y-4 xl:sticky xl:top-4 xl:self-start">
          <section className="panel-strong rounded-2xl p-4">
            <p className="text-sm font-semibold text-stone-900">Økonomisk oversikt</p>
            <div className="mt-3 space-y-2">
              <SummaryLine label="Estimert subtotal" value={formatCurrency(displaySummary.subtotalNok)} />
              <SummaryLine label="Leveringsgebyr" value={formatCurrency(displaySummary.deliveryFeeNok)} />
              <SummaryLine label="MVA (andel)" value={formatCurrency(displaySummary.vatNok)} />
              <SummaryLine label="Å betale" value={formatCurrency(displaySummary.totalNok)} strong />
            </div>
            <div className="mt-3 rounded-md border border-stone-200 bg-white px-3 py-2 text-xs text-stone-600">
              Estimert levering: <span className="font-semibold text-stone-900">{formatWindow(displaySummary.earliestDeliveryDate, displaySummary.latestDeliveryDate)}</span>
            </div>
          </section>

          <section className="panel rounded-2xl p-4">
            <p className="text-sm font-semibold text-stone-900">Leverandørfordeling</p>
            <p className="mt-1 text-xs text-stone-500">
              {suppliers.length > 1
                ? "Ordren kan inneholde flere leverandører samtidig."
                : "Ordren følger leverandører som finnes i prislister."}
            </p>
            <div className="mt-3 space-y-2">
              {supplierRollup.map((supplier) => (
                <div key={supplier.key} className="rounded-md border border-stone-200 bg-stone-50 px-3 py-2">
                  <p className="text-xs font-semibold text-stone-700">{supplier.label}</p>
                  <p className="mt-1 text-xs text-stone-500">{supplier.lineCount} linjer</p>
                  <p className="text-sm font-semibold text-stone-900">{formatCurrency(supplier.amountNok)}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="panel rounded-2xl p-4">
            <p className="text-sm font-semibold text-stone-900">Klar-for-innsending sjekk</p>
            <div className="mt-3 space-y-2">
              {orderChecklist.map((item) => (
                <div
                  key={item.label}
                  className={`flex items-center justify-between rounded-md border px-3 py-2 text-sm ${
                    item.complete
                      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
                      : "border-amber-200 bg-amber-50 text-amber-800"
                  }`}
                >
                  <span>{item.label}</span>
                  <span className="font-semibold">{item.complete ? "OK" : "Mangler"}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="panel rounded-2xl p-4">
            <p className="text-sm font-semibold text-stone-900">Betaling og innsending</p>
            <p className="mt-1 text-xs text-stone-600">
              Oppgjørsform: {checkoutFlow === "pay_now" ? "Kortbetaling via Stripe" : "Klarna via Stripe"}
            </p>
            {!meetsMinimumOrderValue ? (
              <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Minste bestillingsverdi for innsending er {formatCurrency(MINIMUM_ORDER_VALUE_NOK)}.
              </p>
            ) : null}

            <div className="mt-3 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => {
                  void saveOrder();
                }}
                disabled={savePending || checkoutPending || isLocked}
                className="inline-flex h-10 items-center justify-center rounded-sm border border-stone-300 bg-white px-4 text-sm font-semibold text-stone-700 transition hover:border-stone-900 hover:text-stone-900 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {savePending ? "Lagrer..." : "Lagre endringer"}
              </button>
              <button
                type="button"
                onClick={() => {
                  void checkoutOrder();
                }}
                disabled={savePending || checkoutPending || isLocked || !contractAccepted || !meetsMinimumOrderValue}
                className="inline-flex h-10 items-center justify-center rounded-sm bg-stone-900 px-4 text-sm font-semibold text-white transition hover:bg-stone-800 disabled:cursor-not-allowed disabled:bg-stone-500"
              >
                {checkoutPending
                  ? "Starter behandling..."
                  : checkoutFlow === "pay_now"
                    ? "Betal med kort og bestill"
                    : "Betal med Klarna og bestill"}
              </button>
            </div>

            <p className="mt-3 min-h-6 text-sm text-stone-600">{message}</p>
          </section>
        </aside>
      </div>

      {imagePreviewDialog ? (
        <OrderLineImagePreviewDialog
          nobbNumber={imagePreviewDialog.nobbNumber}
          productName={imagePreviewDialog.productName}
          onClose={() => setImagePreviewDialog(null)}
        />
      ) : null}
    </div>
  );
}

function OrderLineThumbnail({
  nobbNumber,
  productName,
  onPreview,
}: {
  nobbNumber: string | null;
  productName: string;
  onPreview: (nobbNumber: string, productName: string) => void;
}) {
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    setHasError(false);
  }, [nobbNumber]);

  if (!nobbNumber) {
    return (
      <div className="mt-0.5 h-10 w-10 shrink-0 overflow-hidden rounded-sm border border-stone-300 bg-stone-50">
        <div className="flex h-full w-full items-center justify-center text-[9px] font-semibold uppercase tracking-[0.06em] text-stone-500">
          IMG
        </div>
      </div>
    );
  }

  const imageUrl = buildNobbImageUrl(nobbNumber, "SQUARE");

  return (
    <button
      type="button"
      onClick={() => onPreview(nobbNumber, productName)}
      className="mt-0.5 h-10 w-10 shrink-0 overflow-hidden rounded-sm border border-stone-300 bg-stone-50 transition hover:border-stone-900"
      title="Vis bilde"
      aria-label="Vis produktbilde"
    >
      {!hasError ? (
        <img
          src={imageUrl}
          alt={productName}
          loading="lazy"
          draggable={false}
          onError={() => setHasError(true)}
          className="h-full w-full object-contain object-center"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-[9px] font-semibold uppercase tracking-[0.06em] text-stone-500">
          IMG
        </div>
      )}
    </button>
  );
}

function OrderLineImagePreviewDialog({
  nobbNumber,
  productName,
  onClose,
}: {
  nobbNumber: string;
  productName: string;
  onClose: () => void;
}) {
  const [imageSrc, setImageSrc] = useState(() => buildNobbImageUrl(nobbNumber, "ORIGINAL"));
  const [usedFallback, setUsedFallback] = useState(false);

  useEffect(() => {
    setImageSrc(buildNobbImageUrl(nobbNumber, "ORIGINAL"));
    setUsedFallback(false);
  }, [nobbNumber]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/60 p-4">
      <div className="w-full max-w-4xl overflow-hidden rounded-md border border-stone-300 bg-white shadow-xl">
        <div className="flex items-center justify-between gap-3 border-b border-stone-200 bg-stone-50 px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-stone-900">Produktbilde</p>
            <p className="text-xs text-stone-500">{productName} · NOBB {nobbNumber}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-8 rounded-sm border border-stone-300 bg-white px-2.5 text-xs font-semibold text-stone-700 transition hover:border-stone-900 hover:text-stone-900"
          >
            Lukk
          </button>
        </div>
        <div className="flex min-h-[360px] items-center justify-center bg-stone-100 p-4 sm:p-6">
          {imageSrc ? (
            <img
              src={imageSrc}
              alt={productName}
              onError={() => {
                if (!usedFallback) {
                  setImageSrc(buildNobbImageUrl(nobbNumber, "SQUARE"));
                  setUsedFallback(true);
                  return;
                }

                setImageSrc("");
              }}
              className="max-h-[70vh] w-auto max-w-full object-contain"
            />
          ) : (
            <p className="text-sm text-stone-600">Fant ikke bilde for dette produktet.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function buildNobbImageUrl(nobbNumber: string, imageSize: "SQUARE" | "ORIGINAL") {
  return `https://export.byggtjeneste.no/api/v1/media/images/items/${encodeURIComponent(nobbNumber)}/${imageSize}`;
}

function SummaryLine({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex items-center justify-between rounded-md border px-3 py-2 ${strong ? "border-stone-900 bg-stone-900 text-white" : "border-stone-200 bg-white text-stone-700"}`}>
      <p className={`text-xs ${strong ? "text-stone-200" : "text-stone-500"}`}>{label}</p>
      <p className={`font-mono text-sm ${strong ? "font-semibold" : "font-medium"}`}>{value}</p>
    </div>
  );
}

function calculateSummary(
  items: OrderItem[],
  deliveryMode: DeliveryMode,
  options: { expressDelivery: boolean; carryInService: boolean },
): OrderSummary {
  const included = items.filter((item) => item.isIncluded);
  const subtotalNok = included.reduce((sum, item) => sum + item.lineTotalNok, 0);
  const baseDeliveryFeeNok =
    deliveryMode === "pickup" || included.length === 0
      ? 0
      : Math.max(390, Math.min(2490, Math.round(subtotalNok * 0.025)));
  const expressFeeNok =
    deliveryMode === "pickup" || !options.expressDelivery || included.length === 0
      ? 0
      : Math.max(0, Math.round(subtotalNok * 0.015));
  const carryInFeeNok =
    deliveryMode === "pickup" || !options.carryInService || included.length === 0
      ? 0
      : 690;
  const deliveryFeeNok = baseDeliveryFeeNok + expressFeeNok + carryInFeeNok;
  const totalNok = subtotalNok + deliveryFeeNok;
  const vatNok = Math.round(totalNok * 0.2);

  const sortedDates = included
    .map((item) => item.estimatedDeliveryDate)
    .filter((value): value is string => Boolean(value))
    .sort();

  return {
    subtotalNok,
    deliveryFeeNok,
    vatNok,
    totalNok,
    earliestDeliveryDate: sortedDates[0] ?? null,
    latestDeliveryDate: sortedDates[sortedDates.length - 1] ?? null,
  };
}

function getVeilPriceNok(item: OrderItem) {
  if (typeof item.listPriceNok === "number" && Number.isFinite(item.listPriceNok)) {
    return Math.max(0, Math.round(item.listPriceNok));
  }

  return null;
}

function averageLeadDays(supplier: SupplierOption) {
  return Math.max(1, Math.round((supplier.minLeadDays + supplier.maxLeadDays) / 2));
}

function getSupplierOptions(currentKey: SupplierKey, availableSuppliers: SupplierOption[]) {
  if (availableSuppliers.some((supplier) => supplier.key === currentKey)) {
    return availableSuppliers;
  }

  const currentSupplier = SUPPLIER_BY_KEY[currentKey];

  if (!currentSupplier) {
    return availableSuppliers;
  }

  return [currentSupplier, ...availableSuppliers];
}

function toSupportedCheckoutFlow(flow: StoredCheckoutFlow): CheckoutFlow {
  return flow === "klarna" ? "klarna" : "pay_now";
}

function formatAddressSearchValue(addressLine1: string, postalCode: string, city: string) {
  if (!addressLine1.trim() || !postalCode.trim() || !city.trim()) {
    return "";
  }

  return `${addressLine1.trim()}, ${postalCode.trim()} ${city.trim()}`;
}

function parseIsoDateInput(value: string) {
  const trimmed = value.trim();

  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return undefined;
  }

  const [yearText, monthText, dayText] = trimmed.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return undefined;
  }

  return new Date(year, month - 1, day);
}

function formatIsoDateInput(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function toPositiveInteger(value: string, fallback: number) {
  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return fallback;
  }

  const parsed = Number.parseInt(trimmed, 10);

  if (!Number.isFinite(parsed) || parsed < 0) {
    return fallback;
  }

  return parsed;
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

function formatDate(value: string | null) {
  if (!value) {
    return "-";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleDateString("nb-NO", {
    dateStyle: "medium",
  });
}

function formatDateTime(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("nb-NO", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatWindow(start: string | null, end: string | null) {
  if (!start && !end) {
    return "Ikke beregnet";
  }

  if (start && end && start !== end) {
    return `${formatDate(start)} til ${formatDate(end)}`;
  }

  return formatDate(start ?? end);
}
