import type { SupplierKey } from "@/lib/material-order";

export type MaterialReturnType = "return" | "complaint";

export type MaterialReturnReasonCode =
  | "wrong_item"
  | "changed_mind"
  | "damaged_in_transit"
  | "defective"
  | "missing_parts"
  | "not_as_described"
  | "other";

export type MaterialReturnStatus =
  | "submitted"
  | "documents_received"
  | "supplier_notified"
  | "label_ready"
  | "in_transit"
  | "received"
  | "reviewing"
  | "resolved"
  | "rejected";

export type MaterialReturnResolution = "refund" | "replacement" | "repair" | "other";

export type MaterialReturnReason = {
  code: MaterialReturnReasonCode;
  label: string;
  detail: string;
  recommendedType: MaterialReturnType;
};

export type SupplierReturnTerms = {
  supplierKey: SupplierKey;
  supplierLabel: string;
  angerrettDays: number;
  openPurchaseDays: number;
  complaintYears: number;
  returnShipping: "gratis" | "kundebetalt";
  handlingFeeNok: number;
  notes: string[];
};

export const MATERIAL_RETURN_REASONS: MaterialReturnReason[] = [
  {
    code: "wrong_item",
    label: "Feil vare bestilt",
    detail: "Brukes ved feil bestilling eller feil leveranse.",
    recommendedType: "return",
  },
  {
    code: "changed_mind",
    label: "Angrer kjøpet",
    detail: "Privatkunder kan bruke angreretten innen fristen.",
    recommendedType: "return",
  },
  {
    code: "damaged_in_transit",
    label: "Skadet under transport",
    detail: "Last opp tydelige bilder av emballasje og vare.",
    recommendedType: "complaint",
  },
  {
    code: "defective",
    label: "Defekt vare",
    detail: "Beskriv feilen og legg ved dokumentasjon.",
    recommendedType: "complaint",
  },
  {
    code: "missing_parts",
    label: "Mangler deler",
    detail: "Spesifiser hvilke deler som mangler.",
    recommendedType: "complaint",
  },
  {
    code: "not_as_described",
    label: "Varen avviker fra beskrivelse",
    detail: "Brukes når spesifikasjon eller kvalitet ikke stemmer.",
    recommendedType: "complaint",
  },
  {
    code: "other",
    label: "Annet",
    detail: "Fritekst for spesielle avvik eller ønsker.",
    recommendedType: "return",
  },
];

export const MATERIAL_RETURN_STATUS_LABELS: Record<MaterialReturnStatus, string> = {
  submitted: "Mottatt",
  documents_received: "Dokumentasjon mottatt",
  supplier_notified: "Varslet leverandør",
  label_ready: "Returlapp klar",
  in_transit: "På vei",
  received: "Mottatt av leverandør",
  reviewing: "Til vurdering",
  resolved: "Løst",
  rejected: "Avvist",
};

export const SUPPLIER_RETURN_TERMS: Record<SupplierKey, SupplierReturnTerms> = {
  byggmakker: {
    supplierKey: "byggmakker",
    supplierLabel: "Byggmakker",
    angerrettDays: 14,
    openPurchaseDays: 30,
    complaintYears: 5,
    returnShipping: "kundebetalt",
    handlingFeeNok: 0,
    notes: [
      "Angrerett gjelder for privatkunde og ubrukt vare.",
      "Skadet vare meldes med bilder innen rimelig tid.",
    ],
  },
  monter_optimera: {
    supplierKey: "monter_optimera",
    supplierLabel: "Monter/Optimera",
    angerrettDays: 14,
    openPurchaseDays: 30,
    complaintYears: 5,
    returnShipping: "kundebetalt",
    handlingFeeNok: 0,
    notes: [
      "Retur må være forsvarlig emballert.",
      "For reklamasjon anbefales bilde av etikett og skade.",
    ],
  },
  byggmax: {
    supplierKey: "byggmax",
    supplierLabel: "Byggmax",
    angerrettDays: 14,
    openPurchaseDays: 30,
    complaintYears: 5,
    returnShipping: "kundebetalt",
    handlingFeeNok: 0,
    notes: [
      "Returfrist avhenger av varetype og spesialbestilling.",
      "Reklamasjon behandles etter forbrukerkjøpsloven.",
    ],
  },
  xl_bygg: {
    supplierKey: "xl_bygg",
    supplierLabel: "XL-Bygg",
    angerrettDays: 14,
    openPurchaseDays: 30,
    complaintYears: 5,
    returnShipping: "kundebetalt",
    handlingFeeNok: 0,
    notes: [
      "Angrerett gjelder for standardvarer og privatkunder.",
      "Bilder og ordrenummer kreves ved skade/feil.",
    ],
  },
};

export function getSupplierReturnTerms(supplierKey: SupplierKey) {
  return SUPPLIER_RETURN_TERMS[supplierKey];
}

export function inferLegalBasis(returnType: MaterialReturnType, customerType: "private" | "business") {
  if (returnType === "complaint") {
    return customerType === "private" ? "forbrukerkjopsloven" : "kjopsloven";
  }

  return customerType === "private" ? "angrerettloven" : "avtalevilkar";
}
