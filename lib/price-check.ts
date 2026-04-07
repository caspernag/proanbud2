import {
  MATERIAL_ORDER_SUPPLIERS,
  toVatInclusiveNok,
  type SupplierKey,
} from "@/lib/material-order";
import { applyMarkupForSupplierKey, getSupplierMarkups } from "@/lib/price-markup";
import { getPriceListProducts, type PriceListProduct } from "@/lib/price-lists";
import type { MaterialSection, ProjectView } from "@/lib/project-data";

export type SupplierQuote = {
  supplierId: SupplierKey;
  supplierName: string;
  totalNok: number;
  listTotalNok: number;
  deliveryDays: number;
  source: "prislister";
};

export type PriceCheckResult = {
  quotes: SupplierQuote[];
  cheapest: SupplierQuote | null;
  mostExpensive: SupplierQuote | null;
  potentialSavingsNok: number;
  comparedLineCount: number;
  totalLineCount: number;
  coverageRatio: number;
  basis: "prislister";
};

export async function calculatePriceCheck(
  project: Pick<ProjectView, "materialSections" | "budgetNok">,
  preloadedProducts?: PriceListProduct[],
): Promise<PriceCheckResult> {
  const products = preloadedProducts ?? (await getPriceListProducts());
  const supplierMarkups = await getSupplierMarkups();
  const supplierProducts = groupProductsBySupplier(products);
  const materialLines = flattenMaterialLines(project.materialSections);
  const totalLineCount = materialLines.length;

  if (materialLines.length === 0) {
    return {
      quotes: [],
      cheapest: null,
      mostExpensive: null,
      potentialSavingsNok: 0,
      comparedLineCount: 0,
      totalLineCount,
      coverageRatio: 0,
      basis: "prislister",
    };
  }

  const linePricesBySupplier = new Map<SupplierKey, Map<string, { unitPriceNok: number; listPriceNok: number }>>();

  for (const [supplierId, rows] of supplierProducts.entries()) {
    const linePrices = new Map<string, { unitPriceNok: number; listPriceNok: number }>();

    for (const line of materialLines) {
      const matchedProduct = findProductMatch(line.itemName, line.note, rows);

      if (!matchedProduct || matchedProduct.priceNok <= 0) {
        continue;
      }

      linePrices.set(line.id, {
        unitPriceNok: matchedProduct.priceNok,
        listPriceNok: matchedProduct.listPriceNok > 0 ? matchedProduct.listPriceNok : matchedProduct.priceNok,
      });
    }

    if (linePrices.size > 0) {
      linePricesBySupplier.set(supplierId, linePrices);
    }
  }

  const comparableLineIds = materialLines
    .map((line) => line.id)
    .filter((lineId) =>
      Array.from(linePricesBySupplier.values()).every((linePrices) => linePrices.has(lineId)),
    );

  if (comparableLineIds.length === 0 || linePricesBySupplier.size === 0) {
    return {
      quotes: [],
      cheapest: null,
      mostExpensive: null,
      potentialSavingsNok: 0,
      comparedLineCount: 0,
      totalLineCount,
      coverageRatio: 0,
      basis: "prislister",
    };
  }

  const lineById = new Map(materialLines.map((line) => [line.id, line]));

  const quotes = Array.from(linePricesBySupplier.entries())
    .map(([supplierId, linePrices]) => {
      const totals = comparableLineIds.reduce((subtotal, lineId) => {
        const line = lineById.get(lineId);
        const unitPrices = linePrices.get(lineId);

        if (!line || !unitPrices) {
          return subtotal;
        }

        const markedUnitPriceNok = Math.max(
          0,
          Math.round(
            applyMarkupForSupplierKey(unitPrices.unitPriceNok, supplierId, supplierMarkups, {
              maxPrice: unitPrices.listPriceNok,
            }),
          ),
        );
        const markedUnitPriceWithVatNok = toVatInclusiveNok(markedUnitPriceNok);
        const listUnitPriceWithVatNok = toVatInclusiveNok(unitPrices.listPriceNok);

        return {
          totalNok: subtotal.totalNok + line.quantity * markedUnitPriceWithVatNok,
          listTotalNok: subtotal.listTotalNok + line.quantity * listUnitPriceWithVatNok,
        };
      }, {
        totalNok: 0,
        listTotalNok: 0,
      });
      const supplier = MATERIAL_ORDER_SUPPLIERS[supplierId];
      const deliveryDays = Math.max(1, Math.round((supplier.leadTimeBusinessDays.min + supplier.leadTimeBusinessDays.max) / 2));

      return {
        supplierId,
        supplierName: supplier.label,
        totalNok: roundToNearestHundred(totals.totalNok),
        listTotalNok: roundToNearestHundred(totals.listTotalNok),
        deliveryDays,
        source: "prislister" as const,
      };
    })
    .sort((left, right) => left.totalNok - right.totalNok);

  const cheapest = quotes[0] ?? null;
  const mostExpensive = quotes.length > 0 ? quotes[quotes.length - 1] : null;
  const comparedLineCount = comparableLineIds.length;
  const coverageRatio = totalLineCount > 0 ? comparedLineCount / totalLineCount : 0;

  return {
    quotes,
    cheapest,
    mostExpensive,
    potentialSavingsNok: cheapest && mostExpensive ? Math.max(0, mostExpensive.totalNok - cheapest.totalNok) : 0,
    comparedLineCount,
    totalLineCount,
    coverageRatio,
    basis: "prislister",
  };
}

function flattenMaterialLines(materialSections: MaterialSection[]) {
  return materialSections.flatMap((section, sectionIndex) =>
    section.items.map((item, itemIndex) => ({
      id: `${sectionIndex}:${itemIndex}`,
      itemName: item.item,
      note: item.note,
      quantity: parseQuantity(item.quantity),
    })),
  );
}

function groupProductsBySupplier(products: PriceListProduct[]) {
  const grouped = new Map<SupplierKey, PriceListProduct[]>();

  for (const product of products) {
    const supplierId = supplierKeyFromName(product.supplierName);

    if (!supplierId) {
      continue;
    }

    const rows = grouped.get(supplierId) ?? [];
    rows.push(product);
    grouped.set(supplierId, rows);
  }

  return grouped;
}

function supplierKeyFromName(value: string): SupplierKey | null {
  const normalized = value.toLowerCase();

  if (normalized.includes("byggmakker")) {
    return "byggmakker";
  }

  if (normalized.includes("monter") || normalized.includes("optimera")) {
    return "monter_optimera";
  }

  if (normalized.includes("byggmax")) {
    return "byggmax";
  }

  if (normalized.includes("xl")) {
    return "xl_bygg";
  }

  return null;
}

function findProductMatch(itemName: string, note: string, products: PriceListProduct[]) {
  const nobb = extractNobb(itemName) || extractNobb(note);

  if (nobb) {
    const direct = products.find((product) => product.nobbNumber === nobb);

    if (direct) {
      return direct;
    }
  }

  const queryTokens = tokenize(itemName);

  if (queryTokens.length === 0) {
    return null;
  }

  let bestMatch: PriceListProduct | null = null;
  let bestScore = 0;

  for (const product of products) {
    const productTokens = tokenize(product.productName);

    if (productTokens.length === 0) {
      continue;
    }

    const overlap = queryTokens.filter((token) => productTokens.includes(token)).length;
    const score = overlap / Math.max(queryTokens.length, productTokens.length);

    if (score > bestScore) {
      bestScore = score;
      bestMatch = product;
    }

    if (product.productName.toLowerCase() === itemName.toLowerCase()) {
      return product;
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

function parseQuantity(raw: string) {
  const match = raw.replace(",", ".").match(/(\d+(\.\d+)?)/);
  const value = match ? Number(match[1]) : 1;
  return Number.isFinite(value) && value > 0 ? value : 1;
}

function roundToNearestHundred(value: number) {
  return Math.round(value / 100) * 100;
}